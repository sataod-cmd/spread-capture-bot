import { NextResponse } from "next/server";
import { db } from "../../../db";
import { botConfigs, serverWorkers, trades } from "../../../db/schema";
import { desc, gte, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [config] = await db.select().from(botConfigs).limit(1);
    if (!config) return NextResponse.json({ status: "unconfigured", reason: "Database has no bot config" }, { status: 503 });
    const [worker] = await db.select().from(serverWorkers).limit(1);
    const [last] = await db.select({ executedAt: trades.executedAt, source: trades.source }).from(trades).orderBy(desc(trades.executedAt)).limit(1);
    const since = new Date(Date.now() - 60 * 60_000);
    const [counts] = await db.select({ count: sql<number>`count(*)::int` }).from(trades).where(gte(trades.executedAt, since));
    const heartbeatAgeSeconds = worker?.lastHeartbeatAt ? Math.round((Date.now() - new Date(worker.lastHeartbeatAt).getTime()) / 1000) : null;
    const paused = !!config.riskPausedUntil && new Date(config.riskPausedUntil).getTime() > Date.now();
    const live = config.liveEnabled && !config.liveDryRun;
    const status = !config.isRunning || !config.run24x7 ? "stopped"
      : config.emergencyStop ? "emergency-stopped"
      : paused ? "risk-cooldown"
      : heartbeatAgeSeconds == null || heartbeatAgeSeconds > 90 ? "worker-heartbeat-stale"
      : "scanning";
    return NextResponse.json({
      serverTimeUtc: new Date().toISOString(),
      mode: live ? "live" : "paper",
      status,
      reason: status === "scanning" ? "Worker is scanning. A trade is not guaranteed; fee, spread, inventory and risk checks may reject opportunities."
        : status === "risk-cooldown" ? `Risk pause until ${new Date(config.riskPausedUntil!).toISOString()}`
        : status === "worker-heartbeat-stale" ? "No recent worker heartbeat. Check Render logs and instance plan."
        : status === "emergency-stopped" ? "Emergency stop is on."
        : "Trading or 24x7 mode is turned off.",
      heartbeatAgeSeconds,
      lastScanAt: worker?.lastScanAt ?? null,
      lastTradeAt: last?.executedAt ?? null,
      lastTradeSource: last?.source ?? null,
      tradesLastHour: counts?.count ?? 0,
      autoTimeWindowBlocksTrading: false,
      liveEnabled: config.liveEnabled,
      liveDryRun: config.liveDryRun,
    });
  } catch (error) {
    console.error("[trading-status] failed", error);
    return NextResponse.json({ status: "error", reason: "Unable to read bot state; check Render logs and database connection" }, { status: 503 });
  }
}
