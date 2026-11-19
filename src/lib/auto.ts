import { db } from "../db";
import { trades } from "../db/schema";
import { desc } from "drizzle-orm";

/**
 * AUTO-PILOT — the bot's always-on intelligence. There is no "mode" to turn on:
 * these behaviours run by default so the bot can be left completely alone.
 *
 *  - Trades only during the hours that have historically been profitable
 *  - Requires a wider spread in hours that have been losing
 *  - Sizes up in proven-good hours, sizes down in bad ones
 *  - Can skip individual pairs
 *  - Emergency stop halts everything instantly
 *
 * The rails that protect capital (charges ≤ profit, strict stop-loss, daily
 * circuit breaker, maker-only, one trade per scan) are NEVER affected here.
 */

export type AutoCfg = {
  emergencyStop: boolean;
  autoTimeWindow: boolean;
  activeHours: number[];
  autoThresholdTuning: boolean;
  thresholdBoostLosingHours: number;
  sizeBoostWinningHours: number;
  disabledPairs: string[];
  spreadThreshold: number;
  minProfitChargeRatio: number;
  maxTradeAmountUsd: number;
};

export type HourStats = {
  hour: number;
  trades: number;
  netProfit: number;
  winRate: number;
  label: string;
  profitable: boolean;
};

/** Learn which UTC hours have historically been profitable (all-time trades). */
export async function getHourPerformance(): Promise<HourStats[]> {
  const all = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(10000);
  const map = new Map<number, { trades: number; wins: number; net: number }>();
  for (const t of all) {
    const h = new Date(t.executedAt).getUTCHours();
    if (!map.has(h)) map.set(h, { trades: 0, wins: 0, net: 0 });
    const v = map.get(h)!;
    v.trades++; if (t.netProfit > 0) v.wins++; v.net += t.netProfit;
  }
  return Array.from({ length: 24 }, (_, h) => {
    const v = map.get(h) || { trades: 0, wins: 0, net: 0 };
    return {
      hour: h, trades: v.trades, netProfit: parseFloat(v.net.toFixed(4)),
      winRate: v.trades ? parseFloat(((v.wins / v.trades) * 100).toFixed(1)) : 0,
      label: `${String(h).padStart(2, "0")}:00 UTC`,
      profitable: v.net > 0,
    };
  });
}

export type AutoDecision = {
  blocked: boolean;
  blockReason: string | null;
  effectiveSpreadThreshold: number;
  sizeMultiplier: number;
  hourLabel: string;
  hourNetProfit: number;
  hourTrades: number;
  isWinningHour: boolean;
  notes: string[];
};

/**
 * Self-learning hours: the bot refreshes its own trading window from its own
 * results — but ONLY with real evidence, and never at the cost of sleeping
 * through the market.
 *
 * Rules (learned the hard way):
 *  - An hour must have MIN_TRADES_PER_HOUR trades before it can be judged.
 *    One lucky trade is not evidence.
 *  - The window may never shrink below MIN_ACTIVE_HOURS (half the day).
 *    Otherwise a quiet learning period can lock the bot out of 20 hours —
 *    exactly what happened before this fix.
 *  - If the evidence isn't strong enough, the bot keeps all 24 hours and
 *    continues exploring.
 */
export const MIN_TRADES_PER_HOUR = 10;
export const MIN_ACTIVE_HOURS = 12;

export async function learnProfitableHours(): Promise<{ hours: number[]; profitable: number[]; applied: boolean; reason: string }> {
  const stats = await getHourPerformance();
  const all = Array.from({ length: 24 }, (_, i) => i);
  // Only hours with enough trades count as evidence
  const evidenced = stats.filter((h) => h.trades >= MIN_TRADES_PER_HOUR);
  const profitable = evidenced.filter((h) => h.netProfit > 0).map((h) => h.hour);
  if (profitable.length >= MIN_ACTIVE_HOURS) {
    return { hours: profitable, profitable, applied: true, reason: `narrowed to ${profitable.length} proven hours` };
  }
  return {
    hours: all, profitable, applied: false,
    reason: `keeping all 24 hours — only ${profitable.length} hour(s) have ${MIN_TRADES_PER_HOUR}+ trades AND a profit (need ${MIN_ACTIVE_HOURS} to narrow)`,
  };
}

/** Resolve the effective trade policy for right now. */
export async function resolveAutoPolicy(cfg: AutoCfg): Promise<AutoDecision> {
  const notes: string[] = [];
  const hourStats = await getHourPerformance();
  const nowHour = new Date().getUTCHours();
  const today = hourStats[nowHour];
  const hasData = today.trades > 0;
  const isWinningHour = hasData && today.netProfit > 0;

  if (cfg.emergencyStop) {
    return {
      blocked: true,
      blockReason: "🛑 EMERGENCY STOP is ON — all trading is blocked (the bot still scans and tracks, it just never executes).",
      effectiveSpreadThreshold: cfg.spreadThreshold, sizeMultiplier: 0, hourLabel: today.label,
      hourNetProfit: today.netProfit, hourTrades: today.trades, isWinningHour, notes: ["Emergency stop engaged"],
    };
  }

  // Hourly history is a signal, never a hard scheduling gate. Excluding an
  // unobserved hour prevents the bot from ever collecting evidence for it.
  // The risk engine still rejects spreads that do not cover fees and slippage.
  if (cfg.autoTimeWindow) {
    notes.push(`Monitoring all 24 hours; ${nowHour}:00 UTC is evaluated with fee-aware spread rules`);
  }

  // ── Auto threshold tuning from learned hourly performance ──
  let threshold = cfg.spreadThreshold;
  let sizeMul = 1;
  if (cfg.autoThresholdTuning && hasData) {
    if (isWinningHour) {
      threshold = threshold * 0.9;
      sizeMul = cfg.sizeBoostWinningHours || 1.25;
      notes.push(`Winning hour (${today.label}, +$${today.netProfit.toFixed(4)}) → spread bar lowered to ${threshold.toFixed(3)}%, size ×${sizeMul.toFixed(2)}`);
    } else {
      threshold = threshold + (cfg.thresholdBoostLosingHours || 0.15);
      notes.push(`Losing/no-edge hour (${today.label}) → spread bar raised to ${threshold.toFixed(3)}%`);
    }
  }

  return {
    blocked: false,
    blockReason: null,
    effectiveSpreadThreshold: parseFloat(Math.max(0.05, threshold).toFixed(4)),
    sizeMultiplier: parseFloat(sizeMul.toFixed(3)),
    hourLabel: today.label,
    hourNetProfit: today.netProfit,
    hourTrades: today.trades,
    isWinningHour,
    notes,
  };
}
