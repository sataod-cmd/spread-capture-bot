import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { serverWorkers } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { ensureConfig } from "../../../../lib/bot";
import { performScan } from "../../../../lib/scan";
import { startBotWorker, forceWorkerTick } from "../../../../lib/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BACKUP WAKE-UP ENDPOINT for 24×7 operation.
 * Point any external scheduler at this URL and the bot stays alive even if
 * the hosting platform sleeps the server process between requests:
 *   - cron-job.org  → GET https://<your-domain>/api/cron/tick  every 1 min
 *   - Vercel Cron   → see vercel.json (already included in this project)
 *   - GitHub Actions→ curl on a schedule
 * If CRON_SECRET is set in env, callers must send: Authorization: Bearer <secret>
 * (Vercel automatically sends this header for its cron jobs.)
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized — send Authorization: Bearer CRON_SECRET" }, { status: 401 });
    }
  }
  // Wake the in-process worker too (self-healing if the process restarted or was frozen)
  try { startBotWorker("cron-wakeup"); } catch {}
  // Force the in-process worker to scan right now (its timers can be skipped
  // on hosts that freeze the process when idle) — this call alone guarantees
  // the bot scans at least once per cron ping, no matter what.
  try { await forceWorkerTick(); } catch {}

  const config = await ensureConfig();
  if (!config.isRunning || !config.run24x7) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Bot is OFF or 24×7 is disabled in the dashboard — cron will not trade", isRunning: config.isRunning, run24x7: config.run24x7, serverTime: new Date().toISOString() });
  }
  const result = await performScan({ source: "cron" });
  // Count this as a worker scan in the status table
  try {
    const rows = await db.select().from(serverWorkers).limit(1);
    if (rows.length) {
      await db.update(serverWorkers).set({
        lastHeartbeatAt: new Date(), lastScanAt: new Date(), lastSource: "cron",
        lastTradeAt: result.executed.length ? new Date() : rows[0].lastTradeAt,
        scansCount: (rows[0].scansCount || 0) + 1,
        tradesCount: (rows[0].tradesCount || 0) + result.executed.length,
        opportunitiesCount: (rows[0].opportunitiesCount || 0) + result.found.length,
        updatedAt: new Date(),
      }).where(eq(serverWorkers.id, rows[0].id));
    }
  } catch {}
  return NextResponse.json({
    ok: true, source: "cron", scannedAt: result.scannedAt,
    opportunitiesFound: result.found.length, tradesExecuted: result.executed.length,
    balance: result.balance,
    trades: result.executed.map(t => ({ symbol: t.symbol, netProfit: t.netProfit, spreadPercent: t.spreadPercent })),
  });
}

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }
