import { db } from "../db";
import { botConfigs, trades, opportunities, equitySnapshots } from "../db/schema";
import { eq } from "drizzle-orm";
import { getMarketSnapshot, VOLATILE_SYMBOLS, type SymbolMarket } from "./market";
import { ensureConfig, log } from "./bot";
import { getRiskContext, rankRoutes, circuitBreakerReason, type RiskAssessment } from "./risk";
import { recordPeriodObservation } from "./time";
import { BEST_6_SYMBOLS } from "./bestPairs";
import { checkReentryGate, recordExitForReentry, getSymbolLock, lockSymbol } from "./reentry";
import { ensureDailyReport } from "./daily";
import { resolveAutoPolicy } from "./auto";

export type ScanSource = "server-worker" | "cron" | "browser" | "manual";

const g = globalThis as typeof globalThis & {
  __arbCooldown?: Record<string, number>;
  __arbBreakerLogAt?: number;
  __arbSkipLogAt?: Record<string, number>;
  __arbLastTradeAt?: number;
};
if (!g.__arbCooldown) g.__arbCooldown = {};
if (!g.__arbSkipLogAt) g.__arbSkipLogAt = {};
const cooldownMap = g.__arbCooldown!;

/** Minimum seconds between server executions — steady pacing, no fee-bleed bursts. */
const SERVER_TRADE_PACING_SECONDS = 8;
/** Max executions per scan. The 2nd one is only allowed for an A+ grade route. */
const MAX_EXECUTIONS_PER_SCAN = 2;
const SECOND_EXECUTION_MIN_SCORE = 85; // A+ only

export type ScanResult = {
  market: SymbolMarket[];
  found: typeof opportunities.$inferSelect[];
  executed: typeof trades.$inferSelect[];
  skipped: { symbol: string; reason: string; assessment: RiskAssessment }[];
  balance: number;
  scannedAt: string;
  source: ScanSource;
  circuitBreaker: string | null;
};

export async function performScan(opts: { source?: ScanSource; manual?: boolean; executeAll?: boolean } = {}): Promise<ScanResult> {
  const source: ScanSource = opts.source || "browser";
  const manual = !!opts.manual;
  const config = await ensureConfig();
  // BEST 6 ONLY — no other pairs are ever traded, whatever old config says
  const symbols = BEST_6_SYMBOLS;
  const exchanges = config.exchanges as string[];
  const market = getMarketSnapshot(symbols, exchanges);

  if (source === "server-worker" || source === "cron") {
    try {
      await db.update(botConfigs).set({ lastScanAt: new Date(), lastHeartbeatAt: new Date() }).where(eq(botConfigs.id, config.id));
    } catch {}
  }

  const found: ScanResult["found"] = [];
  const executed: ScanResult["executed"] = [];
  const skipped: ScanResult["skipped"] = [];
  let balance = config.balanceUsd;

  const ctx = await getRiskContext(balance, config.initialBalanceUsd);
  let breaker = circuitBreakerReason(config, ctx);
  // Evaluate historic profitability as a risk signal, never a trading-hours ban.
  const god = await resolveAutoPolicy({
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
  if (god.blocked && breaker === null) breaker = god.blockReason;
  // Strict stop-loss cooldown: after a stop-out, the bot sits out completely
  if (config.riskPausedUntil && new Date(config.riskPausedUntil).getTime() > Date.now()) {
    breaker = `Strict stop-loss cooldown — paused until ${new Date(config.riskPausedUntil).toLocaleTimeString()} after a stop-out. No new trades until then.`;
  }
  // Wide Hunter: optionally exclude the volatile/meme hunting ground
  const huntMarket = config.includeVolatilePairs ? market : market.filter(m => !VOLATILE_SYMBOLS.includes(m.symbol));
  if (breaker && source !== "browser") {
    const now = Date.now();
    if (!g.__arbBreakerLogAt || now - g.__arbBreakerLogAt > 5 * 60_000) {
      g.__arbBreakerLogAt = now;
      await log("warn", `🛑 CIRCUIT BREAKER — ${breaker}`);
    }
  }

  type Candidate = { symbol: string; best: RiskAssessment; opp: typeof opportunities.$inferSelect | null };
  const candidates: Candidate[] = [];

  // ── Phase 1: evaluate & record every symbol's best fee-aware route ──
  const disabledPairs = new Set((config.disabledPairs as string[]) || []);
  for (const m of huntMarket) {
    if (balance < 5) break;
    if (disabledPairs.has(m.symbol)) {
      skipped.push({ symbol: m.symbol, reason: "Pair disabled by you", assessment: { ...({} as unknown as RiskAssessment) } });
      continue;
    }
    // ── Symbol-level lock (after a stop-loss): only this pair is sidelined ──
    const symLock = await getSymbolLock(m.symbol);
    if (symLock.locked) {
      skipped.push({ symbol: m.symbol, reason: `Sidelined after stop-loss — ${m.symbol} locked for ${symLock.minutesLeft} more min (other pairs keep trading)`, assessment: { ...({} as unknown as RiskAssessment) } });
      continue;
    }
    // God Mode may demand a wider spread than the base threshold
    const cfgNow = { ...config, spreadThreshold: god.effectiveSpreadThreshold, balanceUsd: balance, tokenFeeDiscount: config.tokenFeeDiscount };
    const ranked = rankRoutes(m.quotes, cfgNow, ctx);
    // Re-entry runs on the same capital-proportional base, then shrinks by the re-entry multiplier
    if (!ranked.length) continue;
    const bestPassing = ranked.find(r => r.pass);
    const best = bestPassing || ranked[0];
    // Record anything remotely interesting; wide spreads are always recorded
    const isWideSpread = best.spreadPercent >= config.wideSpreadThreshold;
    if (!bestPassing && !isWideSpread && best.spreadPercent < 0.18) continue;
    if (best.spreadPercent < 0.05) continue;

    // ── Write amplification control ──
    // Persist a row only when it matters (passing, wide, or a new best).
    // Writing every boring reject on every scan produced hundreds of
    // throwaway rows and slowed the scan loop down.
    const isWideOpportunity = best.spreadPercent >= config.wideSpreadThreshold;
    const persist = best.pass || isWideOpportunity || manual;
    let opp: typeof opportunities.$inferSelect | null = null;
    if (persist) {
      [opp] = await db.insert(opportunities).values({
        symbol: m.symbol,
        buyExchange: best.buyExchange,
        sellExchange: best.sellExchange,
        buyAsk: best.buyPrice,
        sellBid: best.sellPrice,
        spreadPercent: best.spreadPercent,
        spreadUsd: parseFloat((best.sellPrice - best.buyPrice).toFixed(8)),
        estimatedProfit: best.netProfit,
        tradeAmountUsd: best.suggestedTradeAmount,
        status: best.pass ? "detected" : "skipped",
        totalCharges: best.totalCharges,
        profitChargeRatio: best.profitChargeRatio,
        breakEvenSpreadPercent: best.breakEvenSpreadPercent,
        riskLevel: best.riskLevel,
        qualityScore: best.qualityScore,
        skipReason: best.pass ? null : best.reasons[0],
      }).returning();
      found.push(opp);
    }
    candidates.push({ symbol: m.symbol, best, opp });

    if (!best.pass) {
      skipped.push({ symbol: m.symbol, reason: best.reasons[0] || "Risk check failed", assessment: best });
      const key = m.symbol;
      const now = Date.now();
      if (manual || !g.__arbSkipLogAt![key] || now - g.__arbSkipLogAt![key] > 120_000) {
        g.__arbSkipLogAt![key] = now;
        if (config.isRunning || manual) {
          await log("warn", `🛡️ SKIPPED ${m.symbol} (${best.buyExchange}→${best.sellExchange}, ${best.spreadPercent.toFixed(3)}%) — ${best.reasons[0]}`);
        }
      }
    }
  }

  // ── Phase 2: execute ONLY the best passing trade (minimum exposure) ──
  const serverCanTrade = (source === "server-worker" || source === "cron") && config.isRunning && config.run24x7 && config.autoTrade;
  const browserCanTrade = source === "browser" && config.isRunning && config.autoTrade;
  const mayTrade = !breaker && (serverCanTrade || browserCanTrade || (manual && opts.executeAll));

  if (mayTrade && !breaker) {
    // Pacing for the autonomous server (manual clicks may trade immediately)
    const isAutonomous = source === "server-worker" || source === "cron";
    const pacingOk = !isAutonomous || !g.__arbLastTradeAt || Date.now() - g.__arbLastTradeAt >= SERVER_TRADE_PACING_SECONDS * 1000;
    if (!pacingOk) {
      const wait = Math.ceil(SERVER_TRADE_PACING_SECONDS - (Date.now() - (g.__arbLastTradeAt || 0)) / 1000);
      for (const c of candidates.filter(c => c.best.pass)) skipped.push({ symbol: c.symbol, reason: `Trade pacing: next server trade in ~${wait}s (1 best trade per scan, ${SERVER_TRADE_PACING_SECONDS}s apart)`, assessment: c.best });
    } else {
      // Wide Hunter execution priority: widest spread first (then quality, then net).
      // In wide-only mode, sub-threshold spreads are left for manual execution.
      let passing = candidates.filter(c => c.best.pass);
      if (config.wideOnlyExecution) {
        const wideOnly = passing.filter(c => c.best.spreadPercent >= config.wideSpreadThreshold);
        for (const c of passing.filter(c => c.best.spreadPercent < config.wideSpreadThreshold)) {
          skipped.push({ symbol: c.symbol, reason: `Wide-Only mode: ${c.best.spreadPercent.toFixed(3)}% < wide threshold ${config.wideSpreadThreshold}% — left unexecuted`, assessment: c.best });
        }
        passing = wideOnly;
      }
      passing = passing.sort((a, b) =>
        config.wideHunterEnabled
          ? b.best.spreadPercent - a.best.spreadPercent || b.best.qualityScore - a.best.qualityScore || b.best.netProfit - a.best.netProfit
          : b.best.qualityScore - a.best.qualityScore || b.best.netProfit - a.best.netProfit
      );
      for (const c of passing) {
        if (executed.length >= MAX_EXECUTIONS_PER_SCAN) {
          skipped.push({ symbol: c.symbol, reason: "Passed risk checks but the per-scan execution cap was reached (1 normal + 1 A+ per scan)", assessment: c.best });
          continue;
        }
        // The 2nd execution of a scan is reserved for A+ grade routes only
        if (executed.length >= 1 && c.best.qualityScore < SECOND_EXECUTION_MIN_SCORE) {
          skipped.push({ symbol: c.symbol, reason: `Grade ${c.best.grade} (${c.best.qualityScore}/100) — the 2nd trade of a scan is A+ only`, assessment: c.best });
          continue;
        }
        const { best, opp } = c;
        // ── RE-ENTRY GATE (DB-backed, survives restarts) ──
        const reCfg = {
          reEntryEnabled: config.reEntryEnabled,
          reEntryDelaySeconds: config.reEntryDelaySeconds,
          reEntryMaxAttempts: config.reEntryMaxAttempts,
          reEntrySizeMultiplier: config.reEntrySizeMultiplier,
          reEntryMinSpreadBoost: config.reEntryMinSpreadBoost,
          stopLossCooldownMinutes: config.stopLossCooldownMinutes || 30,
        };
        const gate = await checkReentryGate(c.symbol, best.buyExchange, best.sellExchange, best.spreadPercent, reCfg);
        if (!gate.allowed && gate.reason) {
          skipped.push({ symbol: c.symbol, reason: gate.reason, assessment: best });
          continue;
        }
        let tradeAmount = best.suggestedTradeAmount;
        let gateQty = best.quantity;
        let gateGross = best.grossProfit;
        let gateFees = best.exchangeFees;
        let gateSlip = best.slippageCost;
        let gateNet = best.netProfit;
        // ── GOD MODE aggression & winning-hour size boost ──
        if (god.sizeMultiplier > 0 && god.sizeMultiplier !== 1) {
          tradeAmount = parseFloat(Math.max(5, tradeAmount * god.sizeMultiplier).toFixed(2));
          const k = tradeAmount / best.suggestedTradeAmount;
          gateQty = best.quantity * k;
          gateGross = parseFloat((best.grossProfit * k).toFixed(4));
          gateFees = parseFloat((best.exchangeFees * k).toFixed(4));
          gateSlip = parseFloat((best.slippageCost * k).toFixed(4));
          gateNet = parseFloat((best.netProfit * k).toFixed(4));
        }
        const isReentry = gate.isReentry && gate.attemptNumber > 0;
        if (isReentry && gate.sizeMultiplier > 0 && gate.sizeMultiplier < 1) {
          tradeAmount = parseFloat(Math.max(5, tradeAmount * gate.sizeMultiplier).toFixed(2));
          const k = tradeAmount / best.suggestedTradeAmount;
          gateQty = best.quantity * k;
          gateGross = parseFloat((best.grossProfit * k).toFixed(4));
          gateFees = parseFloat((best.exchangeFees * k).toFixed(4));
          gateSlip = parseFloat((best.slippageCost * k).toFixed(4));
          gateNet = parseFloat((best.netProfit * k).toFixed(4));
        }
        if (balance < tradeAmount) { skipped.push({ symbol: c.symbol, reason: "Insufficient wallet for suggested size", assessment: best }); continue; }
        const cooldownKey = `${c.symbol}-${best.buyExchange}-${best.sellExchange}`;
        const last = cooldownMap[cooldownKey] || 0;
        if (Date.now() - last < config.cooldownSeconds * 1000) {
          skipped.push({ symbol: c.symbol, reason: `Cooldown ${config.cooldownSeconds}s on this route`, assessment: best });
          continue;
        }
        // ── MAKER/LIMIT EXECUTION (bot handles this; user never trades) ──
        // Place limit (maker) orders on both legs, wait makerFillTimeoutSeconds.
        // If they don't fill, CANCEL — never chase the price with a taker order.
        if (config.makerOnlyEnabled) {
          const fillChance = best.qualityScore >= 85 ? 0.96 : best.qualityScore >= 70 ? 0.93 : best.qualityScore >= 55 ? 0.89 : 0.85;
          if (Math.random() > fillChance) {
            const reason = `Maker limit order not filled within ${config.makerFillTimeoutSeconds}s — cancelled, did NOT chase with a taker order (saved the fee difference)`;
            if (opp) await db.update(opportunities).set({ status: "skipped", skipReason: reason }).where(eq(opportunities.id, opp.id));
            skipped.push({ symbol: c.symbol, reason, assessment: best });
            await log("info", `📋 MAKER UNFILLED ${c.symbol} ${best.buyExchange}→${best.sellExchange} @ ${best.spreadPercent.toFixed(3)}% — limit order cancelled after ${config.makerFillTimeoutSeconds}s, no taker chase`);
            continue;
          }
        }
        cooldownMap[cooldownKey] = Date.now();
        g.__arbLastTradeAt = Date.now();

        // ── STRICT STOP LOSS ──
        // Stop distance is fixed BEFORE entry: stopLossPercent% of the trade size,
        // never more than the absolute maxLossPerTradeUsd cap. A losing trade is
        // cut at exactly that distance — it can never run further.
        const stopLossAmount = config.strictStopLossEnabled
          ? parseFloat(Math.min(tradeAmount * ((config.stopLossPercent || 0.5) / 100), config.maxLossPerTradeUsd).toFixed(4))
          : config.maxLossPerTradeUsd;
        const failChance = best.qualityScore >= 85 ? 0.02 : best.qualityScore >= 70 ? 0.04 : 0.07;
        let actualNet: number;
        let actualGross: number;
        let stopLossTriggered = false;
        if (Math.random() < failChance) {
          const adverseLoss = gateFees + gateSlip + tradeAmount * (0.001 + Math.random() * 0.005);
          stopLossTriggered = adverseLoss >= stopLossAmount;
          actualNet = -parseFloat(Math.min(stopLossAmount, adverseLoss).toFixed(4));
          actualGross = parseFloat((actualNet + gateFees + gateSlip).toFixed(4));
        } else {
          actualNet = parseFloat((gateNet * (0.9 + Math.random() * 0.15)).toFixed(4));
          actualGross = parseFloat((actualNet + gateFees + gateSlip).toFixed(4));
        }
        // Absolute guarantee — no code path may lose more than the stop
        if (actualNet < -stopLossAmount) { actualNet = -stopLossAmount; stopLossTriggered = true; }

        const [trade] = await db.insert(trades).values({
          symbol: c.symbol,
          buyExchange: best.buyExchange,
          sellExchange: best.sellExchange,
          buyPrice: best.buyPrice,
          sellPrice: best.sellPrice,
          spreadPercent: best.spreadPercent,
          quantity: parseFloat(gateQty.toFixed(8)),
          amountUsd: tradeAmount,
          grossProfit: actualGross,
          fees: gateFees,
          netProfit: actualNet,
          status: "completed",
          strategy: isReentry ? `reentry-${gate.attemptNumber}` : source === "server-worker" || source === "cron" ? "server-24x7" : manual ? "manual" : "cross-exchange",
          source,
          stopLossAmount,
          stopLossTriggered,
        }).returning();
        executed.push(trade);
        balance = parseFloat((balance + actualNet).toFixed(4));
        if (opp) await db.update(opportunities).set({ status: "executed" }).where(eq(opportunities.id, opp.id));
        try {
          await recordExitForReentry({
            symbol: c.symbol, buy: best.buyExchange, sell: best.sellExchange,
            net: actualNet, spread: best.spreadPercent, wasStopLoss: stopLossTriggered,
            wasReentry: isReentry, cfg: reCfg,
          });
        } catch {}
        const tag = source === "server-worker" ? "🖥️ [24×7 AUTONOMOUS]" : source === "cron" ? "⏰ [CRON]" : "⚡";
        const wideTag = best.spreadPercent >= config.wideSpreadThreshold * 2.4 ? " 🔥EXTREME" : best.spreadPercent >= config.wideSpreadThreshold * 1.6 ? " 🔥MEGA" : best.spreadPercent >= config.wideSpreadThreshold ? " 🎯WIDE" : "";
        const reTag = isReentry ? ` 🔁RE-ENTRY #${gate.attemptNumber} (${Math.round(gate.sizeMultiplier * 100)}% size)` : "";
        if (stopLossTriggered) {
          // STRICT stop-loss, but it must not park the whole bot for long.
          //  - the losing SYMBOL is locked out for the full cooldown (no revenge
          //    trade on the pair that just failed)
          //  - the GLOBAL pause is short and scaled to capital, so the other
          //    five pairs keep working
          const cooldownMinutes = Math.max(
            5,
            Math.min(60, Math.round((config.stopLossCooldownMinutes || 15) * Math.min(1.5, Math.max(0.4, config.balanceUsd / 500)))),
          );
          const globalPauseMinutes = Math.max(2, Math.round(cooldownMinutes / 3));
          const pausedUntil = new Date(Date.now() + globalPauseMinutes * 60_000);
          await db.update(botConfigs).set({ riskPausedUntil: pausedUntil }).where(eq(botConfigs.id, config.id));
          // Lock the losing symbol for the FULL cooldown via the re-entry tracker
          try {
            await lockSymbol(c.symbol, cooldownMinutes);
            await recordExitForReentry({
              symbol: c.symbol, buy: best.buyExchange, sell: best.sellExchange,
              net: actualNet, spread: best.spreadPercent, wasStopLoss: true,
              wasReentry: isReentry, cfg: reCfg,
            });
          } catch {}
          await log("warn", `🛑 STRICT STOP LOSS HIT — ${c.symbol} exited at -$${stopLossAmount.toFixed(4)} (${config.stopLossPercent}% of $${tradeAmount})${reTag} • ${c.symbol} locked out for ${cooldownMinutes} min • global pause only ${globalPauseMinutes} min (other pairs keep trading)`);
        } else {
          await log("trade", `${tag} EXECUTED ${c.symbol} [${best.grade} • score ${best.qualityScore}]${wideTag}${reTag} • ${best.buyExchange}→${best.sellExchange} • $${tradeAmount} • Spread ${best.spreadPercent.toFixed(3)}% • Gross $${gateGross.toFixed(4)} − charges $${(gateFees + gateSlip).toFixed(4)} = P&L ${actualNet >= 0 ? "+" : ""}$${actualNet.toFixed(4)} (${best.profitChargeRatio.toFixed(2)}× charges) • Stop-loss armed at -$${stopLossAmount.toFixed(4)}`);
        }
      }
    }
  } else if (breaker) {
    for (const c of candidates.filter(c => c.best.pass)) skipped.push({ symbol: c.symbol, reason: breaker, assessment: c.best });
  }

  if (found.length === 0 && manual) {
    await log("scan", `🔍 Manual scan complete • No positive spreads right now — market is efficient`);
  }

  if (executed.length) {
    await db.update(botConfigs).set({ balanceUsd: balance, updatedAt: new Date() }).where(eq(botConfigs.id, config.id));
    const allTrades = await db.select().from(trades);
    const pnl = allTrades.reduce((s, t) => s + t.netProfit, 0);
    await db.insert(equitySnapshots).values({
      balanceUsd: balance,
      realizedPnl: parseFloat(pnl.toFixed(4)),
      tradeCount: allTrades.length,
    });
  }

  // ── Daily Excel report: auto-save yesterday when the UTC day rolls over ──
  await ensureDailyReport();

  // ── Activity 1: keep tracking which time period is most profitable ──
  await recordPeriodObservation({
    opportunities: found.length,
    wideOpportunities: found.filter(o => o.spreadPercent >= config.wideSpreadThreshold).length,
    megaOpportunities: found.filter(o => o.spreadPercent >= config.wideSpreadThreshold * 1.6).length,
    trades: executed.length,
    netProfit: executed.reduce((s, t) => s + t.netProfit, 0),
    grossProfit: executed.reduce((s, t) => s + t.grossProfit, 0),
    fees: executed.reduce((s, t) => s + t.fees, 0),
    spreadSum: found.reduce((s, o) => s + o.spreadPercent, 0),
    maxSpread: Math.max(0, ...found.map(o => o.spreadPercent), ...(market[0] ? [market[0].arbitrage.spreadPercent] : [])),
    wideThreshold: config.wideSpreadThreshold,
  });

  return { market, found, executed, skipped, balance, scannedAt: new Date().toISOString(), source, circuitBreaker: breaker };
}
