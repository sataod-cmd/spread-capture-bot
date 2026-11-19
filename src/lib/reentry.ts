import { db } from "../db";
import { reentryStates } from "../db/schema";
import { eq } from "drizzle-orm";

export const routeKeyFor = (symbol: string, buy: string, sell: string) => `${symbol}|${buy}|${sell}`;

type ReentryCfg = {
  reEntryEnabled: boolean;
  reEntryDelaySeconds: number;
  reEntryMaxAttempts: number;
  reEntrySizeMultiplier: number;
  reEntryMinSpreadBoost: number;
  stopLossCooldownMinutes: number;
};

export type ReentryGate = {
  allowed: boolean;
  reason: string | null;
  isReentry: boolean;
  attemptNumber: number;
  sizeMultiplier: number;
  waitSeconds: number;
};

const CYCLE_RESET_MS = 30 * 60 * 1000;

export async function getReentryState(routeKey: string) {
  const rows = await db.select().from(reentryStates).where(eq(reentryStates.routeKey, routeKey)).limit(1);
  return rows[0] || null;
}

export async function listReentryStates() {
  return db.select().from(reentryStates);
}

export async function checkReentryGate(
  symbol: string, buy: string, sell: string,
  currentSpread: number, cfg: ReentryCfg,
): Promise<ReentryGate> {
  if (!cfg.reEntryEnabled) {
    return { allowed: true, reason: null, isReentry: false, attemptNumber: 0, sizeMultiplier: 1, waitSeconds: 0 };
  }
  const routeKey = routeKeyFor(symbol, buy, sell);
  const st = await getReentryState(routeKey);
  const now = Date.now();
  if (!st || !st.lastExitAt) {
    return { allowed: true, reason: null, isReentry: false, attemptNumber: 0, sizeMultiplier: 1, waitSeconds: 0 };
  }
  if (now - new Date(st.lastExitAt).getTime() > CYCLE_RESET_MS) {
    return { allowed: true, reason: null, isReentry: false, attemptNumber: 0, sizeMultiplier: 1, waitSeconds: 0 };
  }
  const eligibleAt = st.nextEligibleAt ? new Date(st.nextEligibleAt).getTime() : 0;
  if (now < eligibleAt) {
    const waitSeconds = Math.ceil((eligibleAt - now) / 1000);
    const why = st.lastExitWasStopLoss
      ? `Re-entry cooling down after STOP-LOSS on ${symbol} ${buy}→${sell} — eligible in ${waitSeconds}s (strict ${cfg.stopLossCooldownMinutes} min pause)`
      : `Re-entry cooling down on ${symbol} ${buy}→${sell} — eligible in ${waitSeconds}s (waits ${cfg.reEntryDelaySeconds}s after each exit)`;
    return { allowed: false, reason: why, isReentry: true, attemptNumber: st.attempts + 1, sizeMultiplier: cfg.reEntrySizeMultiplier, waitSeconds };
  }
  if (st.attempts >= cfg.reEntryMaxAttempts) {
    return {
      allowed: false,
      reason: `Re-entry limit reached on ${symbol} ${buy}→${sell} (${st.attempts}/${cfg.reEntryMaxAttempts} used this cycle)`,
      isReentry: true, attemptNumber: st.attempts + 1, sizeMultiplier: cfg.reEntrySizeMultiplier, waitSeconds: 0,
    };
  }
  const required = st.lastExitSpread + (cfg.reEntryMinSpreadBoost || 0);
  if (currentSpread + 1e-9 < required) {
    return {
      allowed: false,
      reason: `Re-entry needs spread ≥ ${required.toFixed(3)}% on ${symbol} ${buy}→${sell} (last exit ${st.lastExitSpread.toFixed(3)}%) — now ${currentSpread.toFixed(3)}%`,
      isReentry: true, attemptNumber: st.attempts + 1, sizeMultiplier: cfg.reEntrySizeMultiplier, waitSeconds: 0,
    };
  }
  return {
    allowed: true, reason: null, isReentry: true,
    attemptNumber: st.attempts + 1, sizeMultiplier: cfg.reEntrySizeMultiplier, waitSeconds: 0,
  };
}

export async function recordExitForReentry(opts: {
  symbol: string; buy: string; sell: string;
  net: number; spread: number; wasStopLoss: boolean; wasReentry: boolean;
  cfg: ReentryCfg;
}) {
  const { symbol, buy, sell, net, spread, wasStopLoss, wasReentry, cfg } = opts;
  const routeKey = routeKeyFor(symbol, buy, sell);
  const now = new Date();
  const delayMs = wasStopLoss ? (cfg.stopLossCooldownMinutes || 30) * 60_000 : (cfg.reEntryDelaySeconds || 60) * 1000;
  const nextEligibleAt = new Date(now.getTime() + delayMs);
  const existing = await getReentryState(routeKey);
  const cycleExpired = existing?.lastExitAt ? now.getTime() - new Date(existing.lastExitAt).getTime() > CYCLE_RESET_MS : true;
  const status = wasStopLoss ? "stop-paused" : "cooling-down";
  if (!existing) {
    await db.insert(reentryStates).values({
      routeKey, symbol, buyExchange: buy, sellExchange: sell,
      attempts: 0, lastExitAt: now, lastExitNet: net, lastExitSpread: spread,
      lastExitWasStopLoss: wasStopLoss, nextEligibleAt, status,
      totalReentries: wasReentry ? 1 : 0, totalReentryPnl: wasReentry ? net : 0,
    });
  } else {
    await db.update(reentryStates).set({
      attempts: cycleExpired ? 0 : (existing.attempts || 0) + (wasReentry ? 1 : 0),
      lastExitAt: now, lastExitNet: net, lastExitSpread: spread,
      lastExitWasStopLoss: wasStopLoss, nextEligibleAt, status,
      totalReentries: (existing.totalReentries || 0) + (wasReentry ? 1 : 0),
      totalReentryPnl: parseFloat(((existing.totalReentryPnl || 0) + (wasReentry ? net : 0)).toFixed(4)),
      updatedAt: now,
    }).where(eq(reentryStates.routeKey, routeKey));
  }
  return { nextEligibleAt };
}

/**
 * Symbol-level lock — used after a stop-loss so the pair that failed is
 * sidelined for the full cooldown while the other pairs keep trading.
 */
export const symbolLockKey = (symbol: string) => `SYMBOL|${symbol}`;

export async function lockSymbol(symbol: string, minutes: number) {
  const routeKey = symbolLockKey(symbol);
  const nextEligibleAt = new Date(Date.now() + minutes * 60_000);
  const existing = await getReentryState(routeKey);
  if (existing) {
    await db.update(reentryStates).set({
      nextEligibleAt, status: "stop-paused", lastExitWasStopLoss: true,
      updatedAt: new Date(),
    }).where(eq(reentryStates.routeKey, routeKey));
  } else {
    await db.insert(reentryStates).values({
      routeKey, symbol, buyExchange: "(symbol lock)", sellExchange: "(symbol lock)",
      attempts: 0, lastExitAt: new Date(), lastExitWasStopLoss: true,
      nextEligibleAt, status: "stop-paused",
    });
  }
  return nextEligibleAt;
}

export async function getSymbolLock(symbol: string): Promise<{ locked: boolean; until: Date | null; minutesLeft: number }> {
  const st = await getReentryState(symbolLockKey(symbol));
  if (!st?.nextEligibleAt) return { locked: false, until: null, minutesLeft: 0 };
  const until = new Date(st.nextEligibleAt);
  const ms = until.getTime() - Date.now();
  return { locked: ms > 0, until: ms > 0 ? until : null, minutesLeft: ms > 0 ? Math.ceil(ms / 60000) : 0 };
}

export async function resetReentryStates() {
  const rows = await db.select().from(reentryStates);
  for (const r of rows) {
    await db.update(reentryStates).set({
      attempts: 0, status: "ready", nextEligibleAt: null,
      lastExitWasStopLoss: false, updatedAt: new Date(),
    }).where(eq(reentryStates.id, r.id));
  }
  return rows.length;
}
