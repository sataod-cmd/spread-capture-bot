import { db } from "../db";
import { botConfigs, botLogs } from "../db/schema";
import { eq } from "drizzle-orm";

export const STARTING_CAPITAL = 100;

export async function ensureConfig() {
  const existing = await db.select().from(botConfigs).limit(1);
  if (existing.length) return existing[0];
  const [created] = await db.insert(botConfigs).values({
    isRunning: false,
    autoTrade: true,
    mode: "paper",
    spreadThreshold: 0.6,
    minProfitUsd: 0.07,
    tradeAmountUsd: 20,
    maxTradeAmountUsd: 50,
    feePercent: 0.11,
    slippagePercent: 0.03,
    cooldownSeconds: 20,
    maxDailyLossUsd: 3,
    maxMakerFeePercent: 0.11,
    tokenFeeDiscount: false,
    minProfitChargeRatio: 1.5,
    maxLossPerTradeUsd: 0.15,
    maxConsecutiveLosses: 3,
    maxTradesPerDay: 1000,
    maxTradesPerHour: 200,
    maxDrawdownPercent: 5,
    lowFeeRouting: true,
    dynamicSizing: true,
    autonomousMode: true,
    makerOnlyEnabled: true,
    makerFillTimeoutSeconds: 5,
    taxPercent: 30,
    twoExchangeMode: true,
    liveEnabled: false,
    liveMaxTradeUsd: 20,
    liveDryRun: true,
    liveExecutionMode: "taker",
    strictStopLossEnabled: true,
    stopLossPercent: 0.5,
    stopLossCooldownMinutes: 15,
    reEntryEnabled: true,
    reEntryDelaySeconds: 60,
    reEntryMaxAttempts: 2,
    reEntrySizeMultiplier: 0.5,
    reEntryMinSpreadBoost: 0,
    autoScalingEnabled: true,
    baseCapital: 100,
    baseTradeAmount: 20,
    maxCapitalPercentPerTrade: 30,
    wideHunterEnabled: true,
    wideSpreadThreshold: 0.75,
    wideOnlyExecution: false,
    includeVolatilePairs: true,
    symbols: ["PEPE/USDT","BONK/USDT","WIF/USDT","SHIB/USDT","INJ/USDT","ARB/USDT"],
    exchanges: ["Binance","Bybit"],
    balanceUsd: STARTING_CAPITAL,
    initialBalanceUsd: STARTING_CAPITAL,
    run24x7: true,
    autoResume: true,
    workerIntervalSeconds: 5,
  }).returning();
  await db.insert(botLogs).values({ level: "info", message: "ArbBot initialized • $100 capital • Risk-first (profit ≥1.5× charges) • Wide Spread Hunter ON across 8 exchanges & volatile pairs" });
  return created;
}

export async function log(level: string, message: string) {
  try { await db.insert(botLogs).values({ level, message }); } catch {}
}
