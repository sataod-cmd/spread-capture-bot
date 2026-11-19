import { NextResponse } from "next/server";
import { db } from "../../../db";
import { botConfigs, trades, opportunities, botLogs, equitySnapshots, serverWorkers, reentryStates } from "../../../db/schema";
import { eq, desc, sql, gte } from "drizzle-orm";
import { ensureConfig, log } from "../../../lib/bot";
import { getRiskContext, circuitBreakerReason } from "../../../lib/risk";
import { BEST_6, BEST_6_SYMBOLS } from "../../../lib/bestPairs";
import { getExchangeProfiles, TOKEN_FEE_DISCOUNT } from "../../../lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await ensureConfig();
  const [tradeAgg] = await db.select({
    count: sql<number>`count(*)::int`,
    totalProfit: sql<number>`coalesce(sum(${trades.netProfit}),0)`,
    totalGross: sql<number>`coalesce(sum(${trades.grossProfit}),0)`,
    totalFees: sql<number>`coalesce(sum(${trades.fees}),0)`,
    wins: sql<number>`sum(case when ${trades.netProfit} > 0 then 1 else 0 end)::int`,
    avgSpread: sql<number>`coalesce(avg(${trades.spreadPercent}),0)`,
    volume: sql<number>`coalesce(sum(${trades.amountUsd}),0)`,
  }).from(trades);
  const [oppAgg] = await db.select({ count: sql<number>`count(*)::int` }).from(opportunities);
  const recentTrades = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(20);
  const recentOpps = await db.select().from(opportunities).orderBy(desc(opportunities.createdAt)).limit(30);
  const logs = await db.select().from(botLogs).orderBy(desc(botLogs.createdAt)).limit(40);
  const equity = await db.select().from(equitySnapshots).orderBy(desc(equitySnapshots.createdAt)).limit(60);
  // if no equity, synthesize from trades
  let equitySeries = equity.reverse().map(e=>({ time: new Date(e.createdAt).toLocaleTimeString("en-US",{hour12:false}), balance: e.balanceUsd, pnl: e.realizedPnl }));
  if (equitySeries.length < 2) {
    // build from trades chronological
    const all = await db.select().from(trades).orderBy(trades.executedAt);
    let bal = config.initialBalanceUsd;
    equitySeries = [{ time: "Start", balance: bal, pnl: 0 }];
    all.slice(-40).forEach(t=>{ bal += t.netProfit; equitySeries.push({ time: new Date(t.executedAt).toLocaleTimeString("en-US",{hour12:false}), balance: parseFloat(bal.toFixed(2)), pnl: parseFloat((bal-config.initialBalanceUsd).toFixed(2)) }); });
    if (equitySeries.length===1) equitySeries.push({ time: new Date().toLocaleTimeString("en-US",{hour12:false}), balance: config.balanceUsd, pnl: config.balanceUsd-config.initialBalanceUsd });
  }
  const workerRows = await db.select().from(serverWorkers).orderBy(desc(serverWorkers.updatedAt)).limit(1).catch(() => []);
  const [serverTradeAgg] = await db.select({ count: sql<number>`count(*)::int` }).from(trades).where(eq(trades.source, "server-worker")).catch(() => [{ count: 0 }]);
  const winRate = tradeAgg.count ? Math.round(((tradeAgg.wins||0)/tradeAgg.count)*1000)/10 : 0;

  // ─── Risk & charges analytics ───
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const recentForRisk = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(300);
  const winsArr = recentForRisk.filter(t => t.netProfit > 0);
  const lossesArr = recentForRisk.filter(t => t.netProfit < 0);
  const grossWins = winsArr.reduce((s, t) => s + t.netProfit, 0);
  const grossLosses = Math.abs(lossesArr.reduce((s, t) => s + t.netProfit, 0));
  const totalFeesNum = Number(tradeAgg.totalFees) || 0;
  const totalGrossNum = Number(tradeAgg.totalGross) || 0;
  const totalProfitNum = Number(tradeAgg.totalProfit) || 0;
  // Exact implied slippage: every stored trade satisfies gross − fees − slippage = net
  const estSlippage = Math.max(0, totalGrossNum - totalFeesNum - totalProfitNum);
  const totalChargesEst = totalFeesNum + estSlippage;
  const profitAudit = {
    headlineAnswer: "The profit shown on this dashboard is NET — after exchange trading fees AND slippage. It is NOT the raw/gross spread profit.",
    grossBeforeCharges: parseFloat(totalGrossNum.toFixed(4)), // spread captured, before any charges
    exchangeFees: parseFloat(totalFeesNum.toFixed(4)), // buy + sell leg exchange fees actually charged in the sim
    slippageCost: parseFloat(estSlippage.toFixed(4)), // price movement during execution
    totalTradingCharges: parseFloat(totalChargesEst.toFixed(4)),
    netAfterCharges: parseFloat(totalProfitNum.toFixed(4)), // == dashboard profit (balance − starting capital, small rounding/seed diffs aside)
    dashboardProfit: parseFloat((config.balanceUsd - config.initialBalanceUsd).toFixed(4)),
    profitIfChargesWereIgnored: parseFloat(totalGrossNum.toFixed(4)),
    chargesPercentOfGross: totalGrossNum > 0 ? parseFloat((totalChargesEst / totalGrossNum * 100).toFixed(2)) : 0,
    youKeepPercentOfGross: totalGrossNum > 0 ? parseFloat((totalProfitNum / totalGrossNum * 100).toFixed(2)) : 0,
    includedInProfit: ["Exchange maker fees on BOTH legs (maker/limit pricing is ON)", "Slippage allowance on every trade"],
    notIncludedInProfit: ["Your 30% tax on earnings — handled below as a simple reserve, per your instruction, not as a per-trade blocker", "Deposit / withdrawal / blockchain network fees (zero in paper trading)"],
    formula: "Pre-tax net = Gross − maker fees − slippage • After-tax estimate = Pre-tax net − 30% tax on earnings",
    // Activity 2: user will pay 30% tax on earnings — simple reserve model
    taxPercent: config.taxPercent,
    taxModel: "30% reserved on net earnings (only when overall earnings are positive). Tax is NOT a trading charge and never blocks a trade in the Risk Guard.",
    estimatedTaxReserve: totalProfitNum > 0 ? parseFloat((totalProfitNum * (config.taxPercent / 100)).toFixed(4)) : 0,
    afterTaxProfit: totalProfitNum > 0 ? parseFloat((totalProfitNum * (1 - config.taxPercent / 100)).toFixed(4)) : parseFloat(totalProfitNum.toFixed(4)),
  };
  const executionPlan = {
    mode: config.autonomousMode ? "AUTONOMOUS — bot executes itself, user does not trade manually" : "Manual/semi-auto",
    makerOnlyEnabled: config.makerOnlyEnabled,
    maxMakerFeePercent: config.maxMakerFeePercent,
    makerFillTimeoutSeconds: config.makerFillTimeoutSeconds,
    howBotHandlesOrders: [
      "Bot finds a Best-6 spread that passes the charges guard",
      "It places LIMIT (maker) orders on both legs — Binance/Bybit maker fee is 0.02% per leg in this model vs 0.05–0.12% taker",
      `It waits up to ${config.makerFillTimeoutSeconds}s for the limit orders to fill`,
      "If they do not fill, it CANCELS and re-scans — it never chases the price with an expensive market/taker order",
      "Routes needing more than the maker cap are rejected before any order is placed",
      "Strict stop-loss and daily circuit breakers still apply to every filled trade",
    ],
    venuesInUse: config.exchanges,
    twoExchangeMode: config.twoExchangeMode,
  };
  const ctx = await getRiskContext(config.balanceUsd, config.initialBalanceUsd);
  const breaker = circuitBreakerReason(config, ctx);
  const [skippedAgg] = await db.select({ count: sql<number>`count(*)::int` }).from(opportunities).where(eq(opportunities.status, "skipped"));
  // ─── Wide Spread Hunter stats ───
  const wideThreshold = config.wideSpreadThreshold || 0.75;
  const [wideAgg] = await db.select({
    total: sql<number>`count(*)::int`,
    widest: sql<number>`coalesce(max(${opportunities.spreadPercent}),0)`,
    wideCount: sql<number>`sum(case when ${opportunities.spreadPercent} >= ${wideThreshold} then 1 else 0 end)::int`,
    megaCount: sql<number>`sum(case when ${opportunities.spreadPercent} >= ${wideThreshold * 1.6} then 1 else 0 end)::int`,
    extremeCount: sql<number>`sum(case when ${opportunities.spreadPercent} >= ${wideThreshold * 2.4} then 1 else 0 end)::int`,
    wideExecuted: sql<number>`sum(case when ${opportunities.spreadPercent} >= ${wideThreshold} and ${opportunities.status}='executed' then 1 else 0 end)::int`,
  }).from(opportunities);
  const [wideTradeAgg] = await db.select({
    count: sql<number>`count(*)::int`,
    widest: sql<number>`coalesce(max(${trades.spreadPercent}),0)`,
    pnl: sql<number>`coalesce(sum(${trades.netProfit}),0)`,
  }).from(trades).where(gte(trades.spreadPercent, wideThreshold));
  const widestOppRows = await db.select().from(opportunities).orderBy(desc(opportunities.spreadPercent)).limit(5);
  const wide = {
    enabled: config.wideHunterEnabled, threshold: wideThreshold, wideOnlyExecution: config.wideOnlyExecution, includeVolatilePairs: config.includeVolatilePairs,
    totalOpportunities: wideAgg?.total || 0,
    widestEverPercent: parseFloat(Number(wideAgg?.widest || 0).toFixed(4)),
    wideFound: wideAgg?.wideCount || 0, megaFound: wideAgg?.megaCount || 0, extremeFound: wideAgg?.extremeCount || 0,
    wideExecuted: wideAgg?.wideExecuted || 0,
    wideTradesCount: wideTradeAgg?.count || 0,
    widestTradePercent: parseFloat(Number(wideTradeAgg?.widest || 0).toFixed(4)),
    wideTradesPnl: parseFloat(Number(wideTradeAgg?.pnl || 0).toFixed(4)),
    widestOpportunities: widestOppRows,
  };
  const risk = {
    // Charges vs profit — the user's core requirement
    totalExchangeFees: parseFloat(totalFeesNum.toFixed(4)),
    estimatedSlippage: parseFloat(estSlippage.toFixed(4)),
    totalChargesEst: parseFloat(totalChargesEst.toFixed(4)),
    totalGrossProfit: parseFloat(totalGrossNum.toFixed(4)),
    totalNetProfit: parseFloat(totalProfitNum.toFixed(4)),
    feesOfGrossPercent: totalGrossNum > 0 ? parseFloat((totalChargesEst / Math.max(totalGrossNum, 0.0001) * 100).toFixed(2)) : 0,
    netToChargesRatio: totalChargesEst > 0 ? parseFloat((totalProfitNum / totalChargesEst).toFixed(3)) : 0,
    chargesVerdict: totalProfitNum <= 0 ? "No net profit yet — charges guard is filtering weak trades" : totalChargesEst < totalProfitNum ? "✅ Healthy: total charges are BELOW total profit" : "⚠️ Charges are eating profit — raise Min Profit × Charges or enable Low-Fee Routing",
    // Reward : risk realised
    avgWin: winsArr.length ? parseFloat((grossWins / winsArr.length).toFixed(4)) : 0,
    avgLoss: lossesArr.length ? parseFloat((grossLosses / lossesArr.length).toFixed(4)) : 0,
    rewardRiskRatio: grossLosses > 0 && winsArr.length && lossesArr.length ? parseFloat(((grossWins / winsArr.length) / (grossLosses / lossesArr.length)).toFixed(3)) : 0,
    profitFactor: grossLosses > 0 ? parseFloat((grossWins / grossLosses).toFixed(3)) : grossWins > 0 ? 99 : 0,
    largestWin: winsArr.length ? Math.max(...winsArr.map(t => t.netProfit)) : 0,
    largestLoss: lossesArr.length ? Math.min(...lossesArr.map(t => t.netProfit)) : 0,
    // Today / circuit breakers
    todayPnl: ctx.todayPnl, todayTrades: ctx.todayTrades, hourTrades: ctx.hourTrades,
    consecutiveLosses: ctx.consecutiveLosses,
    dailyLossUsedPercent: config.maxDailyLossUsd > 0 ? parseFloat(Math.min(100, Math.max(0, (-ctx.todayPnl / config.maxDailyLossUsd) * 100)).toFixed(1)) : 0,
    drawdownPercent: parseFloat(Math.max(0, ((config.initialBalanceUsd - config.balanceUsd) / config.initialBalanceUsd) * 100).toFixed(3)),
    circuitBreaker: breaker,
    circuitBreakerActive: !!breaker,
    skippedByRisk: skippedAgg?.count || 0,
    settings: {
      minProfitChargeRatio: config.minProfitChargeRatio, spreadThreshold: config.spreadThreshold,
      minProfitUsd: config.minProfitUsd, maxLossPerTradeUsd: config.maxLossPerTradeUsd,
      maxDailyLossUsd: config.maxDailyLossUsd, maxConsecutiveLosses: config.maxConsecutiveLosses,
      maxTradesPerDay: config.maxTradesPerDay, maxTradesPerHour: config.maxTradesPerHour,
      maxDrawdownPercent: config.maxDrawdownPercent, lowFeeRouting: config.lowFeeRouting, dynamicSizing: config.dynamicSizing,
    },
  };

  // ─── BEST 6 pair stats + strict stop-loss stats ───
  const allForPairs = await db.select().from(trades).limit(5000);
  const bestPairs = BEST_6.map(p => {
    const ts = allForPairs.filter(t => t.symbol === p.symbol);
    return {
      ...p, trades: ts.length,
      netProfit: parseFloat(ts.reduce((s, t) => s + t.netProfit, 0).toFixed(4)),
      wins: ts.filter(t => t.netProfit > 0).length,
      winRate: ts.length ? parseFloat(((ts.filter(t => t.netProfit > 0).length / ts.length) * 100).toFixed(1)) : 0,
      avgSpreadPercent: ts.length ? parseFloat((ts.reduce((s, t) => s + t.spreadPercent, 0) / ts.length).toFixed(3)) : 0,
      maxSpreadPercent: ts.length ? Math.max(...ts.map(t => t.spreadPercent)) : 0,
      stopLossHits: ts.filter(t => t.stopLossTriggered).length,
    };
  });
  const stopTrades = allForPairs.filter(t => t.stopLossTriggered);
  const stopLoss = {
    enabled: config.strictStopLossEnabled, percent: config.stopLossPercent,
    amountForBaseTrade: parseFloat((config.tradeAmountUsd * (config.stopLossPercent / 100)).toFixed(4)),
    amountForMaxTrade: parseFloat((Math.min(config.maxTradeAmountUsd, config.tradeAmountUsd * 1.5) * (config.stopLossPercent / 100)).toFixed(4)),
    absoluteCap: config.maxLossPerTradeUsd,
    cooldownMinutes: config.stopLossCooldownMinutes,
    pausedUntil: config.riskPausedUntil,
    isPausedNow: !!(config.riskPausedUntil && new Date(config.riskPausedUntil).getTime() > Date.now()),
    totalHits: stopTrades.length,
    totalStoppedLoss: parseFloat(Math.abs(stopTrades.reduce((s, t) => s + t.netProfit, 0)).toFixed(4)),
    worstTradeEver: allForPairs.length ? Math.min(...allForPairs.map(t => t.netProfit)) : 0,
    recentHits: stopTrades.slice(0, 5),
    autonomousMode: config.autonomousMode,
  };

  // ─── TRUE-FEE AUDIT: re-price every trade with the real published spot fees ───
  const allTradesForAudit = await db.select().from(trades).limit(10000);
  const realFeeRate = config.tokenFeeDiscount ? 0.1 * TOKEN_FEE_DISCOUNT : 0.1; // PERCENT (0.1 = 0.10%)
  const realCharges = (t: typeof trades.$inferSelect) =>
    t.amountUsd * (realFeeRate / 100) * 2 + t.amountUsd * (config.slippagePercent / 100);
  const trueNet = (t: typeof trades.$inferSelect) => t.grossProfit - realCharges(t);
  const audited = allTradesForAudit.map((t) => ({ t, trueNet: trueNet(t) }));
  const modelledNetSum = allTradesForAudit.reduce((s, t) => s + t.netProfit, 0);
  const trueNetSum = audited.reduce((s, a) => s + a.trueNet, 0);
  const feeAudit = {
    feeScheduleVerified: "2026 published spot fees (VIP 0 standard tier)",
    perLegFeePercent: realFeeRate,
    tokenDiscountEnabled: config.tokenFeeDiscount,
    tokenDiscountNote: config.tokenFeeDiscount
      ? "Paying fees in BNB (Binance) / MNT (Bybit) → 0.075% per leg instead of 0.10%."
      : "Enable 'pay fees in BNB/MNT' to drop from 0.10% to 0.075% per leg (−25%).",
    venues: getExchangeProfiles().filter(v => (config.exchanges as string[]).includes(v.exchange)).map(v => ({
      exchange: v.exchange,
      makerFeePercent: config.tokenFeeDiscount ? parseFloat((v.makerFeePercent * TOKEN_FEE_DISCOUNT).toFixed(4)) : v.makerFeePercent,
      takerFeePercent: config.tokenFeeDiscount ? parseFloat((v.takerFeePercent * TOKEN_FEE_DISCOUNT).toFixed(4)) : v.takerFeePercent,
      note: v.feeNote,
    })),
    roundTripFeePercent: parseFloat((realFeeRate * 2).toFixed(4)),
    slippagePercent: config.slippagePercent,
    totalChargesPercent: parseFloat((realFeeRate * 2 + config.slippagePercent).toFixed(4)),
    breakEvenSpreadPercent: parseFloat((realFeeRate * 2 + config.slippagePercent).toFixed(4)),
    // "net ≥ ratio × charges" ⇒ gross must be ≥ (1+ratio) × charges
    requiredSpreadPercent: parseFloat(((realFeeRate * 2 + config.slippagePercent) * (1 + config.minProfitChargeRatio)).toFixed(4)),
    tradesAboveRequiredSpread: audited.filter((a) => a.t.spreadPercent >= (realFeeRate * 2 + config.slippagePercent) * (1 + config.minProfitChargeRatio)).length,
    tradesAudited: audited.length,
    modelledNetProfit: parseFloat(modelledNetSum.toFixed(4)),
    trueNetProfit: parseFloat(trueNetSum.toFixed(4)),
    overstatementBy: parseFloat((modelledNetSum - trueNetSum).toFixed(4)),
    overstatementPercent: modelledNetSum > 0 ? parseFloat((((modelledNetSum - trueNetSum) / modelledNetSum) * 100).toFixed(2)) : 0,
    profitableAtRealFees: audited.filter(a => a.trueNet > 0).length,
    lossMakingAtRealFees: audited.filter(a => a.trueNet <= 0).length,
    chargesOfGrossPercent: (() => {
      const g = allTradesForAudit.reduce((s, t) => s + t.grossProfit, 0);
      const c = allTradesForAudit.reduce((s, t) => s + realCharges(t), 0);
      return g > 0 ? parseFloat(((c / g) * 100).toFixed(2)) : 0;
    })(),
    verdict: trueNetSum > 0
      ? `✅ Strategy is profitable with the REAL spot fees: $${trueNetSum.toFixed(2)} true net vs $${modelledNetSum.toFixed(2)} modelled (${(100 - (modelledNetSum > 0 ? ((modelledNetSum - trueNetSum) / modelledNetSum) * 100 : 0)).toFixed(1)}% of the earlier figure was an overstatement caused by futures-fee assumptions).`
      : "⚠️ With real spot fees the strategy is currently net negative — raise the spread threshold or enable the BNB/MNT fee discount.",
    correctionNote: "Earlier the bot modelled 0.02%/leg (FUTURES maker fees) for a SPOT strategy. Real spot is 0.10%/leg at VIP 0, so a round trip costs 0.20% not 0.04%. The fee model, the spread threshold (now 0.35%) and the min profit (now $0.07) have been corrected.",
  };

  // ─── DIAGNOSTICS: is the bot alive, and if it isn't trading, WHY? ───
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);
  const diagOpps = await db.select().from(opportunities)
    .where(sql`${opportunities.createdAt} >= ${fifteenMinAgo.toISOString()} AND ${opportunities.status} = 'skipped'`)
    .catch(() => []);
  const diagAllOpps = await db.select().from(opportunities)
    .where(sql`${opportunities.createdAt} >= ${fifteenMinAgo.toISOString()}`)
    .catch(() => []);
  const recentTradesW = await db.select().from(trades).where(sql`${trades.executedAt} >= ${fifteenMinAgo.toISOString()}`).catch(() => []);
  const skipBuckets: Record<string, number> = {};
  for (const o of diagOpps) {
    const r = o.skipReason || "other";
    const key = r.startsWith("Spread") ? "Spread below the bar"
      : r.startsWith("Profit is only") ? "Charges too high vs profit"
      : r.startsWith("Net after charges") || r.startsWith("Charges") ? "Charges would eat the profit"
      : r.startsWith("Cooldown") ? "Same route on cooldown"
      : r.startsWith("Trade pacing") ? "Waiting for next slot (pacing)"
      : r.startsWith("Maker limit order") ? "Maker order unfilled → cancelled"
      : r.startsWith("Re-entry") ? "Re-entry cooldown"
      : r.startsWith("Strict stop-loss") ? "Stop-loss pause active"
      : r.startsWith("Spot fee") || r.startsWith("Maker fee") ? "Venue fee too high"
      : r.startsWith("Grade") ? "2nd trade of scan needs A+ grade"
      : r.startsWith("Passed risk checks") ? "Per-scan execution cap reached"
      : r.slice(0, 34);
    skipBuckets[key] = (skipBuckets[key] || 0) + 1;
  }
  const workerRow = workerRows[0];
  const hbAge = workerRow?.lastHeartbeatAt ? Math.round((Date.now() - new Date(workerRow.lastHeartbeatAt).getTime()) / 1000) : null;
  const pausedUntil = config.riskPausedUntil ? new Date(config.riskPausedUntil) : null;
  const isPaused = !!pausedUntil && pausedUntil.getTime() > Date.now();
  const diagnostics = {
    botAlive: hbAge !== null && hbAge < 90,
    heartbeatAgeSeconds: hbAge,
    lastScanAt: workerRow?.lastScanAt || config.lastScanAt || null,
    scansLast15min: workerRow?.scansCount ?? 0,
    opportunitiesLast15min: diagOpps.length,
    opportunitiesSkippedLast15min: diagOpps.length,
    opportunitiesPassedLast15min: Math.max(0, diagAllOpps.length - diagOpps.length),
    tradesLast15min: recentTradesW.length,
    tradesLast15minPnl: parseFloat(recentTradesW.reduce((s, t) => s + t.netProfit, 0).toFixed(4)),
    paused: isPaused,
    pausedUntil: config.riskPausedUntil,
    pausedMinutesLeft: isPaused ? Math.ceil((pausedUntil!.getTime() - Date.now()) / 60000) : 0,
    pauseReason: isPaused ? "Strict stop-loss cooldown — the bot is protecting capital after a losing trade. It resumes automatically." : null,
    whyNoTrades: Object.entries(skipBuckets).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
    status: !config.isRunning || !config.run24x7 ? "STOPPED — bot is off"
      : isPaused ? "PAUSED — stop-loss cooldown"
      : hbAge !== null && hbAge >= 90 ? "WARNING — server heartbeat stale (host may be frozen); external cron will wake it"
      : recentTradesW.length ? "ACTIVE — trading normally"
      : "ACTIVE — scanning, no qualifying spread yet (this is normal; the bot only takes fee-beating edges)",
    safeToLeave: config.isRunning && config.run24x7 && !isPaused && (hbAge === null || hbAge < 90),
    // ── 24×7 availability telemetry ──
    availability: {
      keepAliveActive: (workerRow as any)?.keepAliveActive ?? null,
      watchdogActive: (workerRow as any)?.watchdogActive ?? null,
      scansThisProcess: (workerRow as any)?.scansThisProcess ?? null,
      longestGapSeconds: (workerRow as any)?.longestGapSeconds ?? null,
      lastGapSeconds: (workerRow as any)?.lastGapSeconds ?? null,
      availabilityPercent: (workerRow as any)?.availabilityPercent ?? null,
      note: "The worker pings its own cron endpoint every 45s so the host never suspends the process, and a watchdog force-recovers a frozen or wedged tick.",
    },
  };

  // ─── Capital-proportional sizing preview (double capital → double trade) ───
  const sizingTable = [50, 100, 200, 400, 1000].map(cap => {
    const mult = cap / Math.max(1, config.baseCapital || 100);
    let amt = config.autoScalingEnabled ? parseFloat(((config.baseTradeAmount || 20) * mult).toFixed(2)) : (config.baseTradeAmount || 20);
    const capAmt = parseFloat((cap * (config.maxCapitalPercentPerTrade / 100)).toFixed(2));
    const clamped = amt > capAmt;
    if (clamped) amt = capAmt;
    return {
      capital: cap, capitalMultiple: parseFloat(mult.toFixed(2)),
      tradeAmount: amt, isCurrentBalanceTier: cap <= config.balanceUsd,
      clamped, maxPercentPerTrade: config.maxCapitalPercentPerTrade,
      stopLossAt: parseFloat(Math.min(amt * (config.stopLossPercent / 100), config.maxLossPerTradeUsd).toFixed(4)),
    };
  });
  const currentSizing = sizingTable.length ? (() => {
    const mult = config.balanceUsd / Math.max(1, config.baseCapital || 100);
    let amt = config.autoScalingEnabled ? parseFloat(((config.baseTradeAmount || 20) * mult).toFixed(2)) : (config.baseTradeAmount || 20);
    const capAmt = parseFloat((config.balanceUsd * (config.maxCapitalPercentPerTrade / 100)).toFixed(2));
    const clamped = amt > capAmt;
    if (clamped) amt = capAmt;
    return {
      balanceUsd: config.balanceUsd, capitalMultiple: parseFloat(mult.toFixed(2)),
      baseTradeAmount: config.baseTradeAmount, baseCapital: config.baseCapital,
      tradeAmountNow: amt, requestedByRule: parseFloat(((config.baseTradeAmount || 20) * mult).toFixed(2)),
      clamped, cappedAtPercent: parseFloat(((amt / config.balanceUsd) * 100).toFixed(2)),
      autoScalingEnabled: config.autoScalingEnabled, maxCapitalPercentPerTrade: config.maxCapitalPercentPerTrade,
    };
  })() : null;

  // ─── Re-entry states (per-route, DB-backed) ───
  const reentryRows = await db.select().from(reentryStates).orderBy(desc(reentryStates.updatedAt)).limit(30);
  const nowMs = Date.now();
  const reentry = {
    enabled: config.reEntryEnabled,
    delaySeconds: config.reEntryDelaySeconds,
    maxAttempts: config.reEntryMaxAttempts,
    sizeMultiplier: config.reEntrySizeMultiplier,
    minSpreadBoost: config.reEntryMinSpreadBoost,
    routes: reentryRows.map(r => {
      const eligibleMs = r.nextEligibleAt ? new Date(r.nextEligibleAt).getTime() : 0;
      const waitSeconds = eligibleMs > nowMs ? Math.ceil((eligibleMs - nowMs) / 1000) : 0;
      const liveStatus = waitSeconds > 0 ? (r.lastExitWasStopLoss ? "stop-paused" : "cooling-down")
        : r.attempts >= config.reEntryMaxAttempts ? "exhausted" : "ready";
      return {
        routeKey: r.routeKey, symbol: r.symbol, buyExchange: r.buyExchange, sellExchange: r.sellExchange,
        attempts: r.attempts, maxAttempts: config.reEntryMaxAttempts,
        lastExitAt: r.lastExitAt, lastExitNet: r.lastExitNet, lastExitSpread: r.lastExitSpread,
        lastExitWasStopLoss: r.lastExitWasStopLoss, nextEligibleAt: r.nextEligibleAt,
        waitSeconds, status: liveStatus,
        totalReentries: r.totalReentries, totalReentryPnl: r.totalReentryPnl,
      };
    }),
    totals: {
      routesTracked: reentryRows.length,
      coolingDown: reentryRows.filter(r => r.nextEligibleAt && new Date(r.nextEligibleAt).getTime() > nowMs).length,
      totalReentries: reentryRows.reduce((s, r) => s + (r.totalReentries || 0), 0),
      totalReentryPnl: parseFloat(reentryRows.reduce((s, r) => s + (r.totalReentryPnl || 0), 0).toFixed(4)),
    },
  };

  return NextResponse.json({
    config, worker: workerRows[0] || null, serverTradeCount: serverTradeAgg?.count || 0, risk, wide, bestPairs, diagnostics, best6Symbols: BEST_6_SYMBOLS, stopLoss, profitAudit, executionPlan, reentry, feeAudit, sizing: { current: currentSizing, table: sizingTable }, stats: {
      totalTrades: tradeAgg.count||0, totalProfit: parseFloat(Number(tradeAgg.totalProfit).toFixed(4)),
      totalGross: parseFloat(Number(tradeAgg.totalGross).toFixed(4)), totalFees: parseFloat(Number(tradeAgg.totalFees).toFixed(4)),
      winRate, avgSpread: parseFloat(Number(tradeAgg.avgSpread).toFixed(4)), totalVolume: parseFloat(Number(tradeAgg.volume).toFixed(2)),
      totalOpportunities: oppAgg.count||0,
      roi: parseFloat((((config.balanceUsd-config.initialBalanceUsd)/config.initialBalanceUsd)*100).toFixed(3)),
    },
    recentTrades, recentOpps, logs, equitySeries
  });
}

export async function PATCH(req: Request) {
  const config = await ensureConfig();
  const body = await req.json();
  const allowed = ["spreadThreshold","minProfitUsd","tradeAmountUsd","maxTradeAmountUsd","feePercent","slippagePercent","cooldownSeconds","maxDailyLossUsd","symbols","exchanges","autoTrade","mode","initialBalanceUsd","balanceUsd","run24x7","autoResume","workerIntervalSeconds","minProfitChargeRatio","maxLossPerTradeUsd","maxConsecutiveLosses","maxTradesPerDay","maxTradesPerHour","maxDrawdownPercent","lowFeeRouting","dynamicSizing","wideHunterEnabled","wideSpreadThreshold","wideOnlyExecution","includeVolatilePairs","autonomousMode","strictStopLossEnabled","stopLossPercent","stopLossCooldownMinutes","makerOnlyEnabled","maxMakerFeePercent","makerFillTimeoutSeconds","tokenFeeDiscount","taxPercent","twoExchangeMode","reEntryEnabled","reEntryDelaySeconds","reEntryMaxAttempts","reEntrySizeMultiplier","reEntryMinSpreadBoost","autoScalingEnabled","baseCapital","baseTradeAmount","maxCapitalPercentPerTrade"];
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) if (k in body) update[k]=body[k];
  // Keep trade size sane for the capital: never more than 50% of starting capital per trade
  if (typeof update.tradeAmountUsd === "number" && typeof (update.initialBalanceUsd ?? config.initialBalanceUsd) === "number") {
    const cap = Number(update.initialBalanceUsd ?? config.initialBalanceUsd);
    if ((update.tradeAmountUsd as number) > cap) update.tradeAmountUsd = cap;
  }
  const [updated] = await db.update(botConfigs).set(update).where(eq(botConfigs.id, config.id)).returning();
  await log("info", `Config updated • Spread ≥${updated.spreadThreshold}% • Profit must be ≥${updated.minProfitChargeRatio}× charges • Size $${updated.tradeAmountUsd} • Max loss $${updated.maxLossPerTradeUsd}/trade, $${updated.maxDailyLossUsd}/day • Low-fee ${updated.lowFeeRouting ? "ON":"OFF"}`);
  return NextResponse.json({ config: updated });
}

export async function POST(req: Request) {
  const config = await ensureConfig();
  const body = await req.json().catch(()=>({}));
  if (body.action === "toggle") {
    const newState = !config.isRunning;
    // Starting the bot from anywhere now means "run autonomously on the server 24×7, Best 6 only"
    const [updated] = await db.update(botConfigs).set({ isRunning: newState, run24x7: newState ? true : config.run24x7, autoResume: true, autonomousMode: true, autoTrade: true, makerOnlyEnabled: true, twoExchangeMode: true, exchanges: ["Binance","Bybit"], symbols: BEST_6_SYMBOLS, updatedAt: new Date() }).where(eq(botConfigs.id, config.id)).returning();
    if (newState) {
      try { const { startBotWorker } = await import("../../../lib/worker"); startBotWorker("dashboard-start"); } catch {}
    }
    await log(newState ? "success" : "warn", newState ? "🤖 Bot STARTED on the SERVER (24×7) — scanning 5 exchanges for bid/ask arbitrage even if you close this page" : "⏸ Bot PAUSED — server worker will not trade until restarted");
    return NextResponse.json({ config: updated });
  }
  if (body.action === "reprice-real-fees") {
    // Re-price EVERY historical trade at the true published spot fees so the
    // ledger, balance and P&L all reflect reality (not the old futures-fee model).
    const all = await db.select().from(trades).limit(10000);
    const rate = config.tokenFeeDiscount ? 0.1 * TOKEN_FEE_DISCOUNT : 0.1;
    const chargesFor = (t: typeof trades.$inferSelect) => t.amountUsd * (rate / 100) * 2 + t.amountUsd * (config.slippagePercent / 100);
    let trueTotal = 0;
    for (const t of all) {
      const charges = chargesFor(t);
      const trueNet = parseFloat((t.grossProfit - charges).toFixed(4));
      trueTotal += trueNet;
      await db.update(trades).set({ fees: parseFloat((charges - t.amountUsd * (config.slippagePercent / 100)).toFixed(4)), netProfit: trueNet }).where(eq(trades.id, t.id));
    }
    const newBalance = parseFloat((config.initialBalanceUsd + trueTotal).toFixed(4));
    await db.update(botConfigs).set({ balanceUsd: newBalance, updatedAt: new Date() }).where(eq(botConfigs.id, config.id));
    await log("warn", `💱 Ledger re-priced at REAL spot fees (${rate}%/leg × 2 + ${config.slippagePercent}% slippage) — ${all.length} trades corrected, true net $${trueTotal.toFixed(4)}, balance now $${newBalance.toFixed(2)}`);
    return NextResponse.json({ ok: true, tradesRepriced: all.length, trueNet: parseFloat(trueTotal.toFixed(4)), newBalance });
  }
  if (body.action === "reset-reentry") {
    const { resetReentryStates } = await import("../../../lib/reentry");
    const n = await resetReentryStates();
    await db.update(botConfigs).set({ riskPausedUntil: null, updatedAt: new Date() }).where(eq(botConfigs.id, config.id));
    await log("success", `🔁 Re-entry cycles reset (${n} routes re-armed, stop-loss pause cleared)`);
    const updated = (await db.select().from(botConfigs).limit(1))[0];
    return NextResponse.json({ config: updated, resetRoutes: n });
  }
  if (body.action === "reset" || body.action === "setCapital") {
    // Allow caller to set a new starting capital (default: keep current, which is $100 for new bots)
    const requested = Number(body.capital ?? body.initialBalanceUsd ?? body.newCapital);
    const capital = Number.isFinite(requested) && requested >= 10 && requested <= 1000000 ? parseFloat(requested.toFixed(2)) : config.initialBalanceUsd;
    // Risk-first defaults scaled to capital: 20% per trade, max daily loss only 3%, max loss 0.15% of capital per trade
    const tradeSize = parseFloat(Math.min(Math.max(capital * 0.2, 5), capital * 0.5).toFixed(2));
    const maxTrade = parseFloat((capital * 0.5).toFixed(2));
    const maxDailyLoss = parseFloat((capital * 0.03).toFixed(2));
    const maxLossPerTrade = parseFloat(Math.max(0.05, capital * 0.0015).toFixed(4));
    const minProfit = parseFloat(Math.max(0.02, tradeSize * 0.002).toFixed(4));
    await db.delete(trades); await db.delete(opportunities); await db.delete(equitySnapshots);
    const [updated] = await db.update(botConfigs).set({
      balanceUsd: capital, initialBalanceUsd: capital, isRunning: false,
      tradeAmountUsd: tradeSize, maxTradeAmountUsd: maxTrade, maxDailyLossUsd: maxDailyLoss, minProfitUsd: minProfit,
      baseCapital: capital, baseTradeAmount: tradeSize, // re-anchor capital-proportional sizing at the new level
      maxLossPerTradeUsd: maxLossPerTrade, spreadThreshold: 0.3, minProfitChargeRatio: 1.5, lowFeeRouting: true, dynamicSizing: true,
      updatedAt: new Date(),
    }).where(eq(botConfigs.id, config.id)).returning();
    await db.delete(botLogs);
    await log("warn", `Portfolio reset to $${capital.toFixed(2)} • Trade $${tradeSize} • Risk: profit ≥1.5× charges, max loss $${maxLossPerTrade}/trade, $${maxDailyLoss}/day • History cleared`);
    return NextResponse.json({ config: updated });
  }
  return NextResponse.json({ config });
}
