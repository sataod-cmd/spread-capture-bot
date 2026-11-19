import { db } from "../db";
import { trades } from "../db/schema";
import { desc } from "drizzle-orm";
import type { ExchangeQuote } from "./market";
import { exchangeFeePercent, TOKEN_FEE_DISCOUNT } from "./market";
import { scaleTradeAmount } from "./sizing";

export type RiskContext = {
  todayPnl: number;
  todayTrades: number;
  hourTrades: number;
  consecutiveLosses: number;
  peakBalance: number;
};

export type RiskAssessment = {
  pass: boolean;
  reasons: string[];
  warnings: string[];
  // Route
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  // Money (at suggestedTradeAmount)
  baseTradeAmount: number;
  suggestedTradeAmount: number;
  quantity: number;
  grossProfit: number;
  buyFee: number;
  sellFee: number;
  exchangeFees: number;
  slippageCost: number;
  totalCharges: number; // exchangeFees + slippageCost — ALL trading charges
  netProfit: number;
  // Ratios — the heart of "charges must not eat the profit"
  profitChargeRatio: number; // net ÷ totalCharges  (must be ≥ minProfitChargeRatio)
  chargesOfGrossPercent: number; // charges as % of gross (must be < 50% when ratio > 1)
  breakEvenSpreadPercent: number; // spread needed just to cover charges
  requiredSpreadPercent: number; // spread needed to satisfy the ratio rule
  maxPotentialLoss: number; // worst realistic loss, capped by config
  rewardRiskRatio: number; // expected net ÷ maxPotentialLoss
  qualityScore: number; // 0–100
  riskLevel: "low" | "medium" | "high" | "blocked";
  grade: "A+" | "A" | "B" | "C" | "SKIP";
  stopLossAmount: number; // STRICT stop: $ distance at which a losing trade is cut
  stopLossPercent: number;
};

type Cfg = {
  spreadThreshold: number;
  minProfitUsd: number;
  tradeAmountUsd: number;
  maxTradeAmountUsd: number;
  feePercent: number;
  slippagePercent: number;
  minProfitChargeRatio: number;
  maxLossPerTradeUsd: number;
  maxConsecutiveLosses: number;
  maxTradesPerDay: number;
  maxTradesPerHour: number;
  maxDrawdownPercent: number;
  maxDailyLossUsd: number;
  lowFeeRouting: boolean;
  dynamicSizing: boolean;
  makerOnlyEnabled?: boolean;
  maxMakerFeePercent?: number;
  tokenFeeDiscount?: boolean; // pay fees in BNB (Binance) / MNT (Bybit) = 25% off spot
  autoScalingEnabled?: boolean;
  baseCapital?: number;
  baseTradeAmount?: number;
  maxCapitalPercentPerTrade?: number;
  strictStopLossEnabled?: boolean;
  stopLossPercent?: number;
  balanceUsd: number;
  initialBalanceUsd: number;
};

export async function getRiskContext(balance: number, initialBalance: number): Promise<RiskContext & { circuitBreaker: string | null }> {
  const recent = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(300);
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  let todayPnl = 0, todayTrades = 0, hourTrades = 0, consecutiveLosses = 0;
  let streakAlive = true;
  for (const t of recent) {
    const ts = new Date(t.executedAt).getTime();
    if (ts >= startOfDay.getTime()) { todayTrades++; todayPnl += t.netProfit; }
    if (now - ts < 3600_000) hourTrades++;
    if (streakAlive) {
      if (t.netProfit < 0) consecutiveLosses++;
      else streakAlive = false;
    }
  }
  // Peak balance approximated from current balance vs starting capital
  const peakBalance = Math.max(balance, initialBalance);
  return { todayPnl: parseFloat(todayPnl.toFixed(4)), todayTrades, hourTrades, consecutiveLosses, peakBalance, circuitBreaker: null };
}

export function circuitBreakerReason(cfg: Cfg, ctx: RiskContext): string | null {
  if (ctx.todayPnl <= -Math.abs(cfg.maxDailyLossUsd))
    return `Daily loss limit hit: today ${ctx.todayPnl >= 0 ? "+" : ""}$${ctx.todayPnl.toFixed(4)} ≤ -$${cfg.maxDailyLossUsd} — trading paused until tomorrow`;
  if (ctx.consecutiveLosses >= cfg.maxConsecutiveLosses)
    return `${ctx.consecutiveLosses} consecutive losses (limit ${cfg.maxConsecutiveLosses}) — circuit breaker paused trading to protect capital`;
  if (ctx.todayTrades >= cfg.maxTradesPerDay)
    return `Daily trade cap reached (${ctx.todayTrades}/${cfg.maxTradesPerDay}) — no more trades today`;
  if (ctx.hourTrades >= cfg.maxTradesPerHour)
    return `Hourly trade cap reached (${ctx.hourTrades}/${cfg.maxTradesPerHour}) — slowing down to avoid over-trading & fee bleed`;
  const drawdownPct = cfg.initialBalanceUsd > 0 ? ((cfg.initialBalanceUsd - cfg.balanceUsd) / cfg.initialBalanceUsd) * 100 : 0;
  if (drawdownPct >= cfg.maxDrawdownPercent)
    return `Drawdown ${drawdownPct.toFixed(2)}% ≥ ${cfg.maxDrawdownPercent}% of starting capital — capital protection pause`;
  return null;
}

function assessAtAmount(
  buy: ExchangeQuote, sell: ExchangeQuote, amount: number, cfg: Cfg,
): Omit<RiskAssessment, "suggestedTradeAmount" | "qualityScore" | "riskLevel" | "grade" | "pass" | "reasons" | "warnings"> & { feeRateBuy: number; feeRateSell: number } {
  const buyPrice = buy.ask;
  const sellPrice = sell.bid;
  const qty = amount / buyPrice;
  const grossProfit = (sellPrice - buyPrice) * qty;
  const spreadPercent = buyPrice ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
  // Maker/limit pricing: when maker-only is on (the default), fees are ALWAYS
  // priced at maker rates — the bot places limit orders and never pays taker.
  // REAL spot rates (0.10%/leg at VIP 0), reduced to 0.075% when the user
  // pays fees in BNB/MNT.
  const useMakerPricing = cfg.makerOnlyEnabled !== false || cfg.lowFeeRouting;
  const tokenDiscount = cfg.tokenFeeDiscount === true;
  const feeRateBuy = exchangeFeePercent(buy.exchange, useMakerPricing, tokenDiscount);
  const feeRateSell = exchangeFeePercent(sell.exchange, useMakerPricing, tokenDiscount);
  const buyFee = amount * (feeRateBuy / 100);
  const sellFee = sellPrice * qty * (feeRateSell / 100);
  const exchangeFees = buyFee + sellFee;
  const slippageCost = amount * (cfg.slippagePercent / 100);
  const totalCharges = exchangeFees + slippageCost;
  const netProfit = grossProfit - totalCharges;
  const profitChargeRatio = totalCharges > 0 ? netProfit / totalCharges : netProfit > 0 ? 99 : 0;
  const chargesOfGrossPercent = grossProfit > 0 ? (totalCharges / grossProfit) * 100 : 999;
  const breakEvenSpreadPercent = amount > 0 ? (totalCharges / amount) * 100 : 999;
  const requiredSpreadPercent = breakEvenSpreadPercent * (1 + Math.max(0, cfg.minProfitChargeRatio));
  // STRICT stop loss: a losing trade is cut at exactly this $ distance.
  const stopLossPercent = cfg.strictStopLossEnabled === false ? 0 : (cfg.stopLossPercent ?? 0.5);
  const stopLossAmount = parseFloat((amount * (stopLossPercent / 100)).toFixed(4));
  // Worst realistic outcome can never exceed the strict stop (or the absolute cap).
  const hardCap = cfg.strictStopLossEnabled === false ? cfg.maxLossPerTradeUsd : Math.min(cfg.maxLossPerTradeUsd, stopLossAmount || cfg.maxLossPerTradeUsd);
  const maxPotentialLoss = Math.min(hardCap, totalCharges + amount * 0.0008);
  const rewardRiskRatio = maxPotentialLoss > 0 ? netProfit / maxPotentialLoss : 0;
  return {
    buyExchange: buy.exchange, sellExchange: sell.exchange, buyPrice, sellPrice,
    spreadPercent: parseFloat(spreadPercent.toFixed(4)),
    baseTradeAmount: amount, quantity: qty, grossProfit, buyFee, sellFee, exchangeFees,
    slippageCost, totalCharges, netProfit, profitChargeRatio,
    chargesOfGrossPercent, breakEvenSpreadPercent, requiredSpreadPercent,
    maxPotentialLoss, rewardRiskRatio, feeRateBuy, feeRateSell,
    stopLossAmount, stopLossPercent,
  };
}

export function evaluateRoute(buy: ExchangeQuote, sell: ExchangeQuote, cfg: Cfg, ctx: RiskContext): RiskAssessment {
  // ── Capital-proportional sizing: double the capital → double the trade ──
  const sizing = scaleTradeAmount(cfg.balanceUsd, {
    autoScalingEnabled: cfg.autoScalingEnabled !== false,
    baseCapital: cfg.baseCapital ?? 100,
    baseTradeAmount: cfg.baseTradeAmount ?? 20,
    maxCapitalPercentPerTrade: cfg.maxCapitalPercentPerTrade ?? 30,
  });
  const baseAmount = Math.max(1, Math.min(sizing.amount, cfg.maxTradeAmountUsd, cfg.balanceUsd));
  const raw = assessAtAmount(buy, sell, baseAmount, cfg);
  const reasons: string[] = [];
  const warnings: string[] = [];

  // ── HARD RULES — a trade failing any of these is NEVER executed ──
  const breaker = circuitBreakerReason(cfg, ctx);
  if (breaker) reasons.push(breaker);
  if (raw.spreadPercent < cfg.spreadThreshold)
    reasons.push(`Spread ${raw.spreadPercent.toFixed(3)}% < minimum ${cfg.spreadThreshold}%`);
  if (raw.grossProfit <= 0)
    reasons.push(`No gross edge ($${raw.grossProfit.toFixed(4)})`);
  if (raw.totalCharges >= raw.grossProfit && raw.grossProfit > 0)
    reasons.push(`Charges $${raw.totalCharges.toFixed(4)} would eat ALL gross profit $${raw.grossProfit.toFixed(4)}`);
  if (raw.netProfit <= 0)
    reasons.push(`Net after charges $${raw.netProfit.toFixed(4)} ≤ $0 — charges exceed profit`);
  if (raw.profitChargeRatio < cfg.minProfitChargeRatio)
    reasons.push(`Profit is only ${raw.profitChargeRatio.toFixed(2)}× charges (need ≥ ${cfg.minProfitChargeRatio}×) — charges $${raw.totalCharges.toFixed(4)} vs profit $${raw.netProfit.toFixed(4)}`);
  if (raw.netProfit < cfg.minProfitUsd)
    reasons.push(`Net $${raw.netProfit.toFixed(4)} < minimum $${cfg.minProfitUsd}`);
  if (raw.maxPotentialLoss > cfg.maxLossPerTradeUsd)
    reasons.push(`Potential loss $${raw.maxPotentialLoss.toFixed(4)} > max per trade $${cfg.maxLossPerTradeUsd}`);
  if (raw.feeRateBuy > cfg.feePercent || raw.feeRateSell > cfg.feePercent)
    reasons.push(`Exchange fee (${Math.max(raw.feeRateBuy, raw.feeRateSell).toFixed(3)}%/leg) above your cap ${cfg.feePercent}% — route via a cheaper exchange or enable Low-Fee Routing`);
  if (cfg.makerOnlyEnabled !== false && (raw.feeRateBuy > (cfg.maxMakerFeePercent ?? 0.11) || raw.feeRateSell > (cfg.maxMakerFeePercent ?? 0.11)))
    reasons.push(`Spot fee (${Math.max(raw.feeRateBuy, raw.feeRateSell).toFixed(3)}%/leg) above your cap ${cfg.maxMakerFeePercent ?? 0.11}% — enable "pay fees in BNB/MNT" (0.075%) or use a cheaper venue`);
  if (cfg.balanceUsd < 5)
    reasons.push(`Wallet too low ($${cfg.balanceUsd.toFixed(2)})`);

  // ── Quality score (only meaningful if it passes) ──
  let score = 0;
  score += Math.min(40, Math.max(0, (raw.profitChargeRatio / Math.max(0.1, cfg.minProfitChargeRatio)) * 22));
  score += Math.min(30, Math.max(0, (raw.spreadPercent / Math.max(0.01, raw.requiredSpreadPercent)) * 18));
  score += Math.min(20, Math.max(0, raw.spreadPercent * 22));
  score += raw.buyExchange === "Binance" || raw.sellExchange === "Binance" || raw.buyExchange === "Bybit" || raw.sellExchange === "Bybit" ? 10 : 6;
  const qualityScore = Math.round(Math.min(100, score));

  // ── Dynamic sizing: minimum risk on marginal edges, full size only on A-grade ──
  // baseAmount already reflects capital-proportional scaling (double capital → double trade),
  // so the quality multipliers scale on top of it.
  let suggested = baseAmount;
  if (cfg.dynamicSizing && reasons.length === 0) {
    if (qualityScore >= 85) suggested = Math.min(cfg.maxTradeAmountUsd, baseAmount * 1.5, cfg.balanceUsd * 0.5);
    else if (qualityScore >= 70) suggested = baseAmount;
    else if (qualityScore >= 55) suggested = baseAmount * 0.75;
    else suggested = baseAmount * 0.5;
    suggested = parseFloat(Math.max(5, suggested).toFixed(2));
  }
  // Re-price at the suggested size (ratios are %-based so they don't change,
  // but absolute $ profit/charges the user sees must match the actual trade)
  const final = suggested !== baseAmount ? assessAtAmount(buy, sell, suggested, cfg) : raw;

  const pass = reasons.length === 0;
  if (pass && final.profitChargeRatio < cfg.minProfitChargeRatio * 1.4) warnings.push("Close to the charges limit — sized down for safety");
  if (pass && ctx.consecutiveLosses > 0) warnings.push(`${ctx.consecutiveLosses} recent loss(es) — position kept conservative`);

  const grade: RiskAssessment["grade"] = !pass ? "SKIP" : qualityScore >= 85 ? "A+" : qualityScore >= 70 ? "A" : qualityScore >= 55 ? "B" : "C";
  const riskLevel: RiskAssessment["riskLevel"] = !pass ? "blocked" : qualityScore >= 70 ? "low" : qualityScore >= 55 ? "medium" : "high";

  return {
    pass, reasons, warnings,
    buyExchange: final.buyExchange, sellExchange: final.sellExchange, buyPrice: final.buyPrice, sellPrice: final.sellPrice,
    spreadPercent: final.spreadPercent, baseTradeAmount: baseAmount, suggestedTradeAmount: suggested,
    quantity: final.quantity, grossProfit: parseFloat(final.grossProfit.toFixed(4)),
    buyFee: parseFloat(final.buyFee.toFixed(4)), sellFee: parseFloat(final.sellFee.toFixed(4)),
    exchangeFees: parseFloat(final.exchangeFees.toFixed(4)), slippageCost: parseFloat(final.slippageCost.toFixed(4)),
    totalCharges: parseFloat(final.totalCharges.toFixed(4)), netProfit: parseFloat(final.netProfit.toFixed(4)),
    profitChargeRatio: parseFloat(final.profitChargeRatio.toFixed(3)),
    chargesOfGrossPercent: parseFloat(final.chargesOfGrossPercent.toFixed(2)),
    breakEvenSpreadPercent: parseFloat(final.breakEvenSpreadPercent.toFixed(4)),
    requiredSpreadPercent: parseFloat(final.requiredSpreadPercent.toFixed(4)),
    maxPotentialLoss: parseFloat(final.maxPotentialLoss.toFixed(4)),
    rewardRiskRatio: parseFloat(final.rewardRiskRatio.toFixed(3)),
    qualityScore, riskLevel, grade,
    stopLossAmount: final.stopLossAmount, stopLossPercent: final.stopLossPercent,
  };
}

/** Evaluate every buy→sell exchange pair and return them best-net first. */
export function rankRoutes(quotes: ExchangeQuote[], cfg: Cfg, ctx: RiskContext): RiskAssessment[] {
  const out: RiskAssessment[] = [];
  for (const buy of quotes) {
    for (const sell of quotes) {
      if (buy.exchange === sell.exchange) continue;
      if (sell.bid <= buy.ask) continue; // no gross edge at all
      out.push(evaluateRoute(buy, sell, cfg, ctx));
    }
  }
  return out.sort((a, b) => b.netProfit - a.netProfit || b.profitChargeRatio - a.profitChargeRatio);
}
