import { NextResponse } from "next/server";
import { db } from "../../../db";
import { botConfigs, serverWorkers, trades, opportunities } from "../../../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { ensureConfig, log } from "../../../lib/bot";
import { getInMemoryWorker, startBotWorker, restartBotWorker, forceWorkerTick } from "../../../lib/worker";

export const dynamic = "force-dynamic";

async function statusPayload() {
  const config = await ensureConfig();
  // Make sure the in-process worker exists (also self-heals if it ever died)
  const mem = getInMemoryWorker();
  if (!mem.runningInProcess) {
    try { startBotWorker("api-status-self-heal"); } catch {}
  } else if ((mem as any).stuckForMs > 30_000) {
    // The tick lock is stuck (frozen host) — release it so the bot recovers
    try { restartBotWorker(); } catch {}
  }
  const workers = await db.select().from(serverWorkers).orderBy(desc(serverWorkers.updatedAt)).limit(1);
  const worker = workers[0] || null;
  const memNow = getInMemoryWorker();

  const [serverAgg] = await db.select({
    count: sql<number>`count(*)::int`,
    lastAt: sql<string | null>`max(${trades.executedAt})`,
  }).from(trades).where(eq(trades.source, "server-worker"));
  const [cronAgg] = await db.select({
    count: sql<number>`count(*)::int`,
    lastAt: sql<string | null>`max(${trades.executedAt})`,
  }).from(trades).where(eq(trades.source, "cron"));

  // ── BOTH BOTS 24×7 CHECK: per-exchange leg health ──
  const nowTs = Date.now();
  const exchanges = (config.exchanges as string[]) || ["Binance", "Bybit"];
  const oneHourAgo = new Date(nowTs - 3600_000);
  const legs = [];
  for (const ex of exchanges) {
    const [tAgg] = await db.select({
      total: sql<number>`count(*)::int`,
      pnl: sql<number>`coalesce(sum(${trades.netProfit}),0)`,
      lastAt: sql<string | null>`max(${trades.executedAt})`,
    }).from(trades).where(sql`(${trades.buyExchange} = ${ex} OR ${trades.sellExchange} = ${ex})`);
    const [tHour] = await db.select({
      count: sql<number>`count(*)::int`,
      pnl: sql<number>`coalesce(sum(${trades.netProfit}),0)`,
    }).from(trades).where(sql`(${trades.buyExchange} = ${ex} OR ${trades.sellExchange} = ${ex}) AND ${trades.executedAt} >= ${oneHourAgo.toISOString()}`);
    const [oHour] = await db.select({ count: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(sql`(${opportunities.buyExchange} = ${ex} OR ${opportunities.sellExchange} = ${ex}) AND ${opportunities.createdAt} >= ${oneHourAgo.toISOString()}`);
    const lastAtMs = tAgg?.lastAt ? new Date(tAgg.lastAt).getTime() : null;
    const scanning = (oHour?.count || 0) > 0;
    const status = !config.isRunning || !config.run24x7 ? "paused" : (tHour?.count || 0) > 0 ? "trading" : scanning ? "scanning" : "idle";
    legs.push({
      exchange: ex, status, online: config.isRunning && config.run24x7 && scanning,
      tradesTotal: tAgg?.total || 0, pnlTotal: parseFloat(Number(tAgg?.pnl || 0).toFixed(4)),
      tradesLastHour: tHour?.count || 0, pnlLastHour: parseFloat(Number(tHour?.pnl || 0).toFixed(4)),
      oppsLastHour: oHour?.count || 0, lastTradeAt: tAgg?.lastAt || null,
    });
  }
  const bothOnline = legs.length > 0 && legs.every(l => l.online);
  const anyTrading = legs.some(l => l.status === "trading");

  const now = nowTs;
  const heartbeatAt = worker?.lastHeartbeatAt ? new Date(worker.lastHeartbeatAt).getTime() : null;
  const heartbeatAgeSeconds = heartbeatAt ? Math.max(0, Math.round((now - heartbeatAt) / 1000)) : null;
  const workerOnline = memNow.runningInProcess && heartbeatAgeSeconds !== null && heartbeatAgeSeconds < 15;
  const intervalSec = config.workerIntervalSeconds || 5;
  const lastScanAt = worker?.lastScanAt || config.lastScanAt || null;
  const nextScanInSeconds = lastScanAt
    ? Math.max(0, intervalSec - Math.floor((now - new Date(lastScanAt).getTime()) / 1000) % (intervalSec + 1))
    : 0;

  return {
    ok: true,
    serverTime: new Date().toISOString(),
    mode: "24x7-server-worker",
    browserRequired: false,
    explanation: "The bot runs in the server process + PostgreSQL. Your browser is only a dashboard. Close the tab or turn off your computer — the server keeps scanning and trading. On server restart it auto-resumes because isRunning/run24x7 are stored in the database.",
    worker: worker
      ? { ...worker, online: workerOnline, heartbeatAgeSeconds }
      : null,
    inProcess: memNow,
    availability: memNow.runningInProcess ? {
      keepAliveActive: (memNow as any).keepAliveActive,
      watchdogActive: (memNow as any).watchdogActive,
      scansThisProcess: (memNow as any).scansThisProcess,
      longestGapSeconds: (memNow as any).longestGapSeconds,
      lastGapSeconds: (memNow as any).lastGapSeconds,
      availabilityPercent: (memNow as any).availabilityPercent,
      uptimeSeconds: memNow.uptimeSeconds,
    } : null,
    config: {
      isRunning: config.isRunning,
      run24x7: config.run24x7,
      autoResume: config.autoResume,
      autoTrade: config.autoTrade,
      workerIntervalSeconds: intervalSec,
      balanceUsd: config.balanceUsd,
      initialBalanceUsd: config.initialBalanceUsd,
      lastScanAt: config.lastScanAt,
      lastHeartbeatAt: config.lastHeartbeatAt,
    },
    nextScanInSeconds: config.isRunning && config.run24x7 ? nextScanInSeconds : null,
    legs,
    bothBots: {
      bothOnline,
      anyTrading,
      verdict: !config.isRunning || !config.run24x7
        ? "PAUSED — enable 24×7 to run both legs"
        : bothOnline && anyTrading ? `BOTH BOTS LIVE — ${legs.map(l => l.exchange).join(" + ")} trading 24×7`
        : bothOnline ? `BOTH BOTS ONLINE — ${legs.map(l => l.exchange).join(" + ")} scanning 24×7`
        : "DEGRADED — a leg has no recent scan activity",
    },
    serverTrades: { count: serverAgg?.count || 0, lastAt: serverAgg?.lastAt || null },
    cronTrades: { count: cronAgg?.count || 0, lastAt: cronAgg?.lastAt || null },
    hostFreeze: {
      detected: heartbeatAgeSeconds !== null && heartbeatAgeSeconds > 90,
      heartbeatAgeSeconds,
      note: "Some hosts freeze the server process when there is no traffic. When that happens the in-process timer pauses — the /api/cron/tick endpoint (external cron every minute) wakes it and forces a scan. A 'Connection: keep-alive' ping from outside is the other half of the fix.",
      fix: "Point an external scheduler (cron-job.org, Vercel Cron, GitHub Actions, UptimeRobot) at /api/cron/tick once a minute.",
    },
    cronBackup: {
      urlPath: "/api/cron/tick",
      method: "GET or POST",
      auth: process.env.CRON_SECRET ? "Bearer CRON_SECRET required" : "Open (set CRON_SECRET env to protect it)",
      purpose: "External pinger (cron-job.org / Vercel Cron / GitHub Actions) that wakes the app and runs one scan if your host ever sleeps the worker process.",
    },
  };
}

export async function GET() {
  return NextResponse.json(await statusPayload());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const config = await ensureConfig();

  if (body.action === "enable-24x7") {
    const { BEST_6_SYMBOLS } = await import("../../../lib/bestPairs");
    const [updated] = await db.update(botConfigs).set({ isRunning: true, run24x7: true, autoResume: true, autoTrade: true, autonomousMode: true, makerOnlyEnabled: true, twoExchangeMode: true, exchanges: ["Binance","Bybit"], symbols: BEST_6_SYMBOLS, updatedAt: new Date() }).where(eq(botConfigs.id, config.id)).returning();
    startBotWorker("user-enable-24x7");
    await log("success", "🤖 AUTONOMOUS MODE ON • Bot executes ITSELF on the server 24×7, Best 6 pairs only, strict stop-loss armed — you can close this tab and turn off your computer");
    void forceWorkerTick().catch(() => {});
    const payload = await statusPayload();
    return NextResponse.json({ ...payload, fullConfig: updated });
  }
  if (body.action === "disable-24x7") {
    const [updated] = await db.update(botConfigs).set({ isRunning: false, run24x7: false, updatedAt: new Date() }).where(eq(botConfigs.id, config.id)).returning();
    const w = await db.select().from(serverWorkers).limit(1);
    if (w.length) await db.update(serverWorkers).set({ status: "paused", updatedAt: new Date() }).where(eq(serverWorkers.id, w[0].id));
    await log("warn", "⏸ 24×7 MODE DISABLED • Server worker will heartbeat but will NOT trade until re-enabled");
    const payload = await statusPayload();
    return NextResponse.json({ ...payload, fullConfig: updated });
  }
  if (body.action === "restart-worker") {
    restartBotWorker();
    await log("info", "🔄 Server worker restarted from dashboard • It will auto-resume trading if the bot is ON");
    return NextResponse.json(await statusPayload());
  }
  if (body.action === "force-tick") {
    await forceWorkerTick();
    await log("info", "⚡ Forced a server-side tick from the dashboard (same code path the 24×7 worker uses on its own)");
    return NextResponse.json(await statusPayload());
  }
  if (body.action === "start-worker") {
    startBotWorker("user-start-worker");
    return NextResponse.json(await statusPayload());
  }
  return NextResponse.json(await statusPayload());
}
