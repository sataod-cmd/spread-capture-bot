/**
 * Capital-proportional sizing.
 * Rule: when capital doubles, the trade amount doubles (linear scaling),
 * anchored to a base pair so the behaviour is predictable and reversible.
 *
 * Example with baseCapital=100, baseTradeAmount=20:
 *   capital 50  →  $10
 *   capital 100 →  $20   (base)
 *   capital 200 →  $40   (doubled capital → doubled trade)
 *   capital 400 →  $80
 *   capital 1000 → $200
 *
 * Safety: the result is clamped to (a) available balance and (b) a max % of
 * capital per trade, so a big balance can never be committed to one spread.
 */
export type SizingCfg = {
  autoScalingEnabled: boolean;
  baseCapital: number;
  baseTradeAmount: number;
  maxCapitalPercentPerTrade: number;
};

export type SizingResult = {
  amount: number;
  capitalMultiple: number; // capital ÷ baseCapital
  requestedByRule: number; // raw linear result before clamps
  clampedBy: "none" | "max-capital-percent" | "balance" | "floor";
  cappedAtPercent: number | null; // actual % of capital used
};

export function scaleTradeAmount(capital: number, cfg: SizingCfg): SizingResult {
  const cap = Math.max(1, capital);
  const multiple = cap / Math.max(1, cfg.baseCapital || 100);

  if (!cfg.autoScalingEnabled) {
    return { amount: cfg.baseTradeAmount, capitalMultiple: multiple, requestedByRule: cfg.baseTradeAmount, clampedBy: "none", cappedAtPercent: parseFloat(((cfg.baseTradeAmount / cap) * 100).toFixed(2)) };
  }

  const requestedByRule = parseFloat((cfg.baseTradeAmount * multiple).toFixed(2));
  let amount = requestedByRule;
  let clampedBy: SizingResult["clampedBy"] = "none";

  // Floor so tiny balances can still trade
  const floor = 5;
  if (amount < floor) { amount = floor; clampedBy = "floor"; }

  // Ceiling: never more than maxCapitalPercentPerTrade% of capital in one spread
  const maxByPercent = parseFloat((cap * (cfg.maxCapitalPercentPerTrade / 100)).toFixed(2));
  if (amount > maxByPercent) { amount = maxByPercent; clampedBy = "max-capital-percent"; }

  const cappedAtPercent = parseFloat(((amount / cap) * 100).toFixed(2));
  return { amount, capitalMultiple: parseFloat(multiple.toFixed(4)), requestedByRule, clampedBy, cappedAtPercent };
}
