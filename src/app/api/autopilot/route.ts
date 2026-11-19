import { NextResponse } from "next/server";
import { db } from "../../../db";
import { botConfigs } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { ensureConfig, log } from "../../../lib/bot";
import { getHourPerformance, resolveAutoPolicy, learnProfitableHours } from "../../../lib/auto";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await ensureConfig();
  const hourStats = await getHourPerformance();
  const decision = await resolveAutoPolicy({
    emergencyStop: config.emergencyStop,
    autoTimeWindow: config.autoTimeWindow,
    activeHours: (config.activeHours as number[]) || [],
    autoThresholdTuning: config.autoThresholdTuning,
    thresholdBoostLosingHours: config.thresholdBoostLosingHours,
    sizeBoostWinningHours: config.sizeBoostWinningHours,
    disabledPairs: (config.disabledPairs as string[]) || [],
    spreadThreshold: config.spreadThreshold,
    minProfitChargeRatio: config.minProfitChargeRatio,
    maxTradeAmountUsd: config.maxTradeAmountUsd,
  });

  const profitableHours = hourStats.filter((h) => h.profitable).map((h) => h.hour);
  const bestHours = [...hourStats].filter((h) => h.trades > 0).sort((a, b) => b.netProfit - a.netProfit).slice(0, 5);

  return NextResponse.json({
    fullyAutomatic: config.autonomousMode && config.autoTrade && config.run24x7 && config.autoResume,
    capital: config.balanceUsd,
    tradeAmount: config.tradeAmountUsd,
    settings: {
      autonomousMode: config.autonomousMode,
      autoTrade: config.autoTrade,
      run24x7: config.run24x7,
      autoResume: config.autoResume,
      makerOnlyEnabled: config.makerOnlyEnabled,
      emergencyStop: config.emergencyStop,
      autoTimeWindow: config.autoTimeWindow,
      activeHours: config.activeHours,
      autoThresholdTuning: config.autoThresholdTuning,
      thresholdBoostLosingHours: config.thresholdBoostLosingHours,
      sizeBoostWinningHours: config.sizeBoostWinningHours,
      disabledPairs: config.disabledPairs,
      spreadThreshold: config.spreadThreshold,
      minProfitChargeRatio: config.minProfitChargeRatio,
      minProfitUsd: config.minProfitUsd,
      maxLossPerTradeUsd: config.maxLossPerTradeUsd,
      maxDailyLossUsd: config.maxDailyLossUsd,
      maxConsecutiveLosses: config.maxConsecutiveLosses,
      workerIntervalSeconds: config.workerIntervalSeconds,
      cooldownSeconds: config.cooldownSeconds,
      taxPercent: config.taxPercent,
    },
    decision,
    hourStats,
    profitableHours,
    bestHours: bestHours.map((h) => ({ hour: h.hour, label: h.label, netProfit: h.netProfit, trades: h.trades })),
    whatItDoesOnItsOwn: [
      "Decides which pair to trade, when to trade it and how big to go — no input needed",
      "Scans all 8 exchanges every few seconds for a bid/ask gap",
      "Only takes a trade when profit ≥ 1.5× every charge (fees + slippage)",
      "Evaluates opportunities 24 hours a day; hourly history informs the spread requirement but never blocks trading", 
      "Demands a wider spread in hours that have been losing",
      "Sizes up in proven-good hours, sizes down in bad ones",
      "Places maker limit orders, cancels them if they don't fill, never chases with taker",
      "Cuts any loser at the strict stop-loss and pauses everything afterwards",
      "Rebalances its own trade size as the capital grows (double capital → double trade)",
      "Saves a daily Excel report of your profitable timings",
    ],
  });
}

export async function PATCH(req: Request) {
  const config = await ensureConfig();
  const body = await req.json().catch(() => ({}));
  const allowed = [
    "emergencyStop", "autoTimeWindow", "activeHours", "autoThresholdTuning",
    "thresholdBoostLosingHours", "sizeBoostWinningHours", "disabledPairs",
    "autonomousMode", "autoTrade", "run24x7", "autoResume", "makerOnlyEnabled",
    "spreadThreshold", "minProfitChargeRatio", "minProfitUsd", "maxLossPerTradeUsd",
    "maxDailyLossUsd", "maxConsecutiveLosses", "workerIntervalSeconds", "cooldownSeconds",
  ];
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) if (k in body) update[k] = body[k];
  const [updated] = await db.update(botConfigs).set(update).where(eq(botConfigs.id, config.id)).returning();
  await log("info", `🤖 Auto-pilot updated • window ${updated.autoTimeWindow ? "on" : "off"} (${(updated.activeHours as number[]).length}h) • auto-threshold ${updated.autoThresholdTuning ? "on" : "off"} • emergency-stop ${updated.emergencyStop ? "ON" : "off"}`);
  return NextResponse.json({ config: updated });
}

export async function POST(req: Request) {
  const config = await ensureConfig();
  const body = await req.json().catch(() => ({}));
  if (body.action === "learn-hours") {
    const learned = await learnProfitableHours();
    const [updated] = await db.update(botConfigs).set({
      autoTimeWindow: false,
      activeHours: Array.from({ length: 24 }, (_, i) => i),
      updatedAt: new Date(),
    }).where(eq(botConfigs.id, config.id)).returning();
    return NextResponse.json({
      ok: true, config: updated, learned: learned.profitable, applied: false,
      reason: "Best hours recorded for analysis; trading remains eligible 24 hours a day when the risk and fee checks pass.",
    });
  }
  if (body.action === "emergency-stop") {
    const on = !config.emergencyStop;
    const [updated] = await db.update(botConfigs).set({ emergencyStop: on, updatedAt: new Date() }).where(eq(botConfigs.id, config.id)).returning();
    await log(on ? "warn" : "success", on ? "🛑 EMERGENCY STOP ENGAGED — all trading halted immediately" : "▶ Emergency stop released — trading resumes");
    return NextResponse.json({ ok: true, config: updated, emergencyStop: on });
  }
  if (body.action === "go-full-auto") {
    // One switch: everything the bot needs to run untouched, forever.
    const [updated] = await db.update(botConfigs).set({
      isRunning: true, run24x7: true, autoResume: true, autoTrade: true, autonomousMode: true,
      makerOnlyEnabled: true, emergencyStop: false, autoTimeWindow: false,
      activeHours: Array.from({ length: 24 }, (_, i) => i), autoThresholdTuning: true,
      dynamicSizing: true, lowFeeRouting: true, tokenFeeDiscount: config.tokenFeeDiscount,
      updatedAt: new Date(),
    }).where(eq(botConfigs.id, config.id)).returning();
    const { startBotWorker } = await import("../../../lib/worker");
    startBotWorker("go-full-auto");
    await log("success", "🤖🤖 FULLY AUTOMATIC ENABLED — the bot now decides everything on its own: pairs, timing, size, fees and risk. No input needed from you.");
    const { forceWorkerTick } = await import("../../../lib/worker");
    void forceWorkerTick().catch(() => {});
    return NextResponse.json({ ok: true, config: updated });
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
