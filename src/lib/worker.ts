import { db, recyclePool } from "../db";
import { botConfigs, serverWorkers } from "../db/schema";
import { eq } from "drizzle-orm";
import { ensureConfig, log } from "./bot";
import { performScan } from "./scan";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 24×7 SERVER WORKER
 * ─────────────────────────────────────────────────────────────────────────
 * This runs INSIDE the Next.js server process (started from
 * src/instrumentation.ts when the server boots). It does NOT run in the
 * browser. Closing the tab, closing the laptop, or turning the user's
 * computer OFF has no effect on it — the server keeps ticking.
 *
 * Lifecycle:
 *  - Server boots → instrumentation register() → startBotWorker()
 *  - Worker heartbeats every 2s and scans every `workerIntervalSeconds`
 *    (default 5s) IF bot_configs.isRunning = true AND run24x7 = true.
 *    Both flags live in PostgreSQL, so they survive restarts.
 *  - Server restarts / redeploys → worker starts again and, because
 *    autoResume = true, automatically resumes trading — no human needed.
 *  - If the hosting platform sleeps the process, the external cron
 *    endpoint (/api/cron/tick) is the backup that wakes & scans.
 * ─────────────────────────────────────────────────────────────────────────
 */

type WorkerGlobal = {
  __arbWorker?: {
    interval: ReturnType<typeof setInterval> | null;
    startedAt: Date;
    ticking: boolean;
    tickStartedAt: number | null; // when the current tick began (stale-lock detection)
    lastTickAt: Date | null;
    lastScanAt: Date | null;
    workerId: string;
    watchdog: ReturnType<typeof setInterval> | null;
    keepAlive: ReturnType<typeof setInterval> | null;
    // ── Availability telemetry ──
    scans: number;
    uptimeSeconds: number;
    longestGapSeconds: number;
    lastGapSeconds: number;
    lastAvailabilityCheck: number;
    unavailableSince: number | null;
  };
};

const wg = globalThis as typeof globalThis & WorkerGlobal;
const HEARTBEAT_MS = 2000;
/**
 * Some hosts (serverless / free-tier sandboxes) FREEZE the Node process when
 * there is no traffic. A tick that is mid-await when the freeze happens never
 * reaches its `finally`, leaving `ticking = true` forever — and every later
 * tick would silently return early, stopping the bot until a restart.
 * If a tick has been "in progress" longer than this, we assume it was frozen
 * mid-flight and forcibly recover.
 */
const STALE_TICK_MS = 30_000;

async function ensureWorkerRow(workerId: string) {
  const existing = await db.select().from(serverWorkers).limit(1);
  if (existing.length) return existing[0];
  const [row] = await db
    .insert(serverWorkers)
    .values({
      workerId,
      status: "online",
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      hostInfo: `${process.platform}-${process.arch} node-${process.version}`,
    })
    .returning();
  return row;
}

async function tick() {
  const state = wg.__arbWorker;
  if (!state) return;
  // Stale-lock recovery: a frozen process can leave `ticking` stuck true.
  if (state.ticking) {
    const inFlightFor = state.tickStartedAt ? Date.now() - state.tickStartedAt : 0;
    if (inFlightFor < STALE_TICK_MS) return; // genuinely still running
    console.warn(`[arb-worker] stale tick detected (${inFlightFor}ms) — recovering from a frozen host`);
    state.ticking = false;
  }
  state.ticking = true;
  state.tickStartedAt = Date.now();
  state.lastTickAt = new Date();
  try {
    const config = await ensureConfig();
    const row = await ensureWorkerRow(state.workerId);
    const now = new Date();

    const shouldRun = config.isRunning && config.run24x7;
    const intervalMs = Math.max(15, config.workerIntervalSeconds || 15) * 1000;
    const sinceLastScan = state.lastScanAt ? now.getTime() - state.lastScanAt.getTime() : Infinity;
    const scanDue = sinceLastScan >= intervalMs;
    // Live scans hit the exchanges directly. Binance bans an IP if its request
    // weight budget is exceeded, so cap live scanning at once per 30s regardless
    // of the configured interval — this is the single biggest rate-limit lever.
    const liveIntervalMs = 30_000;
    const liveScanDue = sinceLastScan >= liveIntervalMs;

    // Heartbeat on every tick — this is the proof-of-life the UI shows.
    await db
      .update(serverWorkers)
      .set({
        status: shouldRun ? "online" : "paused",
        lastHeartbeatAt: now,
        tickCount: (row.tickCount || 0) + 1,
        updatedAt: now,
      })
      .where(eq(serverWorkers.id, row.id));
    try {
      await db.update(botConfigs).set({ lastHeartbeatAt: now }).where(eq(botConfigs.id, config.id));
    } catch {}

    if (shouldRun && scanDue) {
      // ── Availability telemetry: how long since the last scan really ran? ──
      if (state.lastScanAt) {
        const gap = Math.round((now.getTime() - state.lastScanAt.getTime()) / 1000);
        state.lastGapSeconds = gap;
        if (gap > state.longestGapSeconds) state.longestGapSeconds = gap;
      }
      state.lastScanAt = now;
      state.scans += 1;

      // ── LIVE MODE: scan the REAL order books and place real orders ──
      // Capped at one live scan per 30s so Binance never sees a request burst.
      if (config.liveEnabled && !config.liveDryRun) {
        if (liveScanDue) {
          try {
            const { liveScan } = await import("./live");
            await liveScan({ execute: true });
          } catch (e) {
            console.error("[arb-worker] live scan failed", e instanceof Error ? e.message : e);
          }
          const freshRows = await db.select().from(serverWorkers).limit(1);
          if (freshRows.length) {
            await db.update(serverWorkers).set({ lastScanAt: now, updatedAt: new Date() }).where(eq(serverWorkers.id, freshRows[0].id));
          }
        }
        return;
      }

      const result = await performScan({ source: "server-worker" });
      const fresh = await db.select().from(serverWorkers).limit(1);
      if (fresh.length) {
        await db
          .update(serverWorkers)
          .set({
            lastScanAt: now,
            lastTradeAt: result.executed.length ? now : fresh[0].lastTradeAt,
            lastSource: "server-worker",
            scansCount: (fresh[0].scansCount || 0) + 1,
            tradesCount: (fresh[0].tradesCount || 0) + result.executed.length,
            opportunitiesCount: (fresh[0].opportunitiesCount || 0) + result.found.length,
            updatedAt: new Date(),
          })
          .where(eq(serverWorkers.id, fresh[0].id));
      }
    }
  } catch (err) {
    console.error("[arb-worker] tick error", err);
    try {
      const rows = await db.select().from(serverWorkers).limit(1);
      if (rows.length) {
        await db
          .update(serverWorkers)
          .set({
            status: "error",
            errorsCount: (rows[0].errorsCount || 0) + 1,
            lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
            updatedAt: new Date(),
          })
          .where(eq(serverWorkers.id, rows[0].id));
      }
    } catch {}
  } finally {
    state.ticking = false;
    state.tickStartedAt = null;
  }
}

/**
 * Watchdog — recovers the worker when the host freezes the process.
 *
 * 1. If the DB heartbeat is older than 90s, the worker is not ticking
 *    (frozen host, wedged DB call, or a stuck lock) → force a tick.
 * 2. If the in-memory tick lock has been held too long, release it.
 * 3. If the database connection is broken, recycle the pool so the next
 *    request reconnects instead of hanging forever.
 */
async function watchdog() {
  const state = wg.__arbWorker;
  if (!state) return;
  try {
    const rows = await db.select().from(serverWorkers).limit(1);
    const last = rows[0]?.lastHeartbeatAt ? new Date(rows[0].lastHeartbeatAt).getTime() : 0;
    const age = last ? Date.now() - last : Infinity;
    if (age > 60_000) {
      console.warn(`[arb-worker] heartbeat stale (${Math.round(age / 1000)}s) — recycling DB pool + forcing recovery tick`);
      // A stale heartbeat usually means the DB connection died with the frozen
      // process — recycle the pool so the next query reconnects cleanly.
      recyclePool();
      state.ticking = false;
      state.tickStartedAt = null;
      state.lastScanAt = null; // allow an immediate scan
      state.unavailableSince = state.unavailableSince ?? Date.now();
      await tick();
    } else {
      state.unavailableSince = null;
    }
  } catch (err) {
    // DB unreachable (frozen pool) — release the lock so a later tick can retry
    state.ticking = false;
    state.tickStartedAt = null;
    console.error("[arb-worker] watchdog error", err instanceof Error ? err.message : err);
  }
}

/**
 * KEEP-ALIVE — the single most important 24×7 fix.
 *
 * Some hosts (serverless sandboxes, free-tier dynos) suspend a server process
 * that has had no HTTP traffic. When that happens every in-process timer
 * pauses and the bot stops scanning — which looks exactly like "the bot
 * doesn't trade while I'm offline".
 *
 * This pings the app's own cron endpoint over HTTP every 45 seconds:
 *   - the request keeps the host's activity counter alive (no suspension)
 *   - the endpoint forces a real scan, so trading continues either way
 * If the process is already frozen, this timer is frozen too — the next
 * external request (your browser or an external cron) thaws it and the
 * keep-alive resumes automatically.
 */
async function keepAlive() {
  const port = process.env.PORT || "3000";
  const url = `http://127.0.0.1:${port}/api/cron/tick`;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(url, { method: "GET", signal: controller.signal }).finally(() => clearTimeout(t));
    if (!res.ok) throw new Error(`keep-alive HTTP ${res.status}`);
  } catch (err) {
    // Never let a keep-alive failure kill the worker
    const state = wg.__arbWorker;
    if (state) state.lastGapSeconds = Math.round((Date.now() - (state.lastScanAt?.getTime() ?? Date.now())) / 1000);
  }
}

export function startBotWorker(reason = "server-boot") {
  if (wg.__arbWorker?.interval) return wg.__arbWorker; // already running — never start twice
  const workerId = `worker-${Math.random().toString(36).slice(2, 8)}`;
  const worker: NonNullable<typeof wg.__arbWorker> = {
    interval: null,
    startedAt: new Date(),
    ticking: false,
    tickStartedAt: null,
    lastTickAt: null,
    lastScanAt: null,
    workerId,
    watchdog: null,
    keepAlive: null,
    scans: 0,
    uptimeSeconds: 0,
    longestGapSeconds: 0,
    lastGapSeconds: 0,
    lastAvailabilityCheck: Date.now(),
    unavailableSince: null,
  };
  wg.__arbWorker = worker;
  worker.interval = setInterval(() => {
    void tick();
  }, HEARTBEAT_MS);
  // Watchdog: on hosts that freeze the process, timers can be skipped for long
  // stretches. This checks the DB heartbeat and force-recovers if it went stale.
  worker.watchdog = setInterval(() => {
    void watchdog();
  }, 20_000);
  // ── KEEP-ALIVE ─────────────────────────────────────────────────────
  // Many hosts suspend an idle server process. A self-ping every 45s keeps
  // the platform's activity counter alive AND forces a real scan, so the bot
  // is never parked waiting for a human to open the page.
  worker.keepAlive = setInterval(() => {
    void keepAlive();
  }, 45_000);
  setTimeout(() => void keepAlive(), 5_000);
  // First tick almost immediately so the UI shows ONLINE within seconds.
  setTimeout(() => void tick(), 800);

  // Boot work is async & must never block server startup.
  void (async () => {
    try {
      const config = await ensureConfig();
      await ensureWorkerRow(workerId);
      await db
        .update(serverWorkers)
        .set({ status: config.isRunning && config.run24x7 ? "online" : "paused", startedAt: new Date(), lastHeartbeatAt: new Date(), workerId, updatedAt: new Date() })
        .where(eq(serverWorkers.workerId, workerId));
      if (config.isRunning && config.run24x7 && config.autoResume) {
        await log("success", `🖥️ 24×7 SERVER WORKER ONLINE (${reason}) • Auto-resumed — bot was ON before restart • Scanning every ${config.workerIntervalSeconds}s from the server, no browser needed`);
      } else if (config.isRunning && config.run24x7) {
        await log("success", `🖥️ 24×7 SERVER WORKER ONLINE (${reason}) • Bot is ON • Scanning every ${config.workerIntervalSeconds}s from the server`);
      } else {
        await log("info", `🖥️ Server worker online (${reason}) • Bot is ${config.isRunning ? "ON but 24×7 OFF" : "OFF"} — press START 24×7 to trade around the clock`);
      }
      console.log(`[arb-worker] started ${workerId} reason=${reason} running=${config.isRunning} 24x7=${config.run24x7}`);
    } catch (e) {
      console.error("[arb-worker] boot error", e);
    }
  })();

  return wg.__arbWorker;
}

export function restartBotWorker() {
  if (wg.__arbWorker?.interval) clearInterval(wg.__arbWorker.interval);
  if (wg.__arbWorker?.watchdog) clearInterval(wg.__arbWorker.watchdog);
  if (wg.__arbWorker?.keepAlive) clearInterval(wg.__arbWorker.keepAlive);
  wg.__arbWorker = undefined;
  return startBotWorker("manual-restart");
}

export async function forceWorkerTick() {
  if (!wg.__arbWorker) startBotWorker("force-tick");
  // Bypass the scan-interval gate for a manual force-tick
  if (wg.__arbWorker) wg.__arbWorker.lastScanAt = null;
  await tick();
}

export function getInMemoryWorker() {
  const w = wg.__arbWorker;
  if (!w) return { runningInProcess: false as const };
  const uptime = Math.floor((Date.now() - w.startedAt.getTime()) / 1000);
  return {
    runningInProcess: true as const,
    workerId: w.workerId,
    startedAt: w.startedAt.toISOString(),
    uptimeSeconds: uptime,
    lastTickAt: w.lastTickAt?.toISOString() || null,
    lastScanAt: w.lastScanAt?.toISOString() || null,
    ticking: w.ticking,
    stuckForMs: w.ticking && w.tickStartedAt ? Date.now() - w.tickStartedAt : 0,
    scansThisProcess: w.scans,
    longestGapSeconds: w.longestGapSeconds,
    lastGapSeconds: w.lastGapSeconds,
    keepAliveActive: !!w.keepAlive,
    watchdogActive: !!w.watchdog,
    availabilityPercent: w.lastAvailabilityCheck > w.startedAt.getTime()
      ? parseFloat(Math.min(100, ((uptime - w.longestGapSeconds) / uptime) * 100).toFixed(3))
      : 100,
  };
}
