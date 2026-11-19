import { getMarketSnapshot, getRealisedAnalytics, exchangeReaction, exchangeFeePercent, exchangeSpreadBps, SYMBOL_PROFILES } from "./market";

export type PairAnalysis = {
  symbol: string;
  category: string;
  liquidityScore: number;
  price: number;
  // Step 1 — pair analysis (calm market, realised from live feed)
  realisedVolPercent: number;
  profileVolPercent: number;
  velocityPercent: number;
  currentSpreadPercent: number;
  avgSpreadPercent: number;
  p95SpreadPercent: number;
  maxSpreadPercent: number;
  wideFrequencyPercent: number;
  samples: number;
  // Step 2 — what a fast move does (scenario)
  scenario: {
    direction: "up" | "down";
    magnitudePercent: number;
    buyExchange: string;
    sellExchange: string;
    buyPrice: number;
    sellPrice: number;
    spreadPercent: number;
    grossProfit: number;
    totalCharges: number;
    netProfit: number;
    profitChargeRatio: number;
    leadingExchange: string;
    laggingExchange: string;
    strategy: string;
    profitWindowSeconds: number;
    passesRiskGuard: boolean;
    beta: number; // how much harder this pair moves vs BTC when the market moves
    effectiveMovePercent: number; // magnitude × beta — the pair's own jump
  };
  // Combined verdict
  volatilityProfitScore: number;
  verdict: string;
  history: { t: string; price: number; spread: number }[];
};

type ScenarioCfg = {
  tradeAmountUsd: number;
  lowFeeRouting: boolean;
  slippagePercent: number;
  minProfitChargeRatio: number;
  minProfitUsd: number;
  spreadThreshold: number;
};

function simulateFastMove(symbol: string, basePrice: number, exchanges: string[], direction: "up" | "down", magnitudePercent: number, cfg: ScenarioCfg) {
  const profile = SYMBOL_PROFILES[symbol];
  const liquidity = profile?.liquidityScore ?? 70;
  const category = profile?.category ?? "alt";
  // Beta: when the market moves X%, memes/volatile pairs move much harder than BTC.
  // This is the single biggest reason they pay more in fast moves.
  const beta = category === "meme" ? 2.2 : category === "volatile" ? 1.7 : category === "alt" ? 1.3 : 1.0;
  const effectiveMovePercent = parseFloat((magnitudePercent * beta).toFixed(3));
  const move = (direction === "up" ? 1 : -1) * (effectiveMovePercent / 100);
  const newBase = basePrice * (1 + move);
  const thinnessMul = category === "meme" ? 2.4 : category === "volatile" ? 1.7 : category === "alt" ? 1.2 : 1;

  // Each exchange reprices only part of the move in the first moments.
  // Thin pairs reprice even slower on small venues → bigger lag gap.
  const quotes = exchanges.map((exchange) => {
    let reaction = exchangeReaction(exchange);
    if (liquidity < 65 && reaction < 0.8) reaction *= 0.72 + liquidity / 500; // extra lag on thin pairs
    const reactedPrice = basePrice + (newBase - basePrice) * Math.min(0.99, reaction);
    const halfBps = (exchangeSpreadBps(exchange) * thinnessMul) / 10000 / 2;
    return {
      exchange,
      reactedPrice,
      reaction,
      bid: reactedPrice * (1 - halfBps),
      ask: reactedPrice * (1 + halfBps),
    };
  });

  const sortedByReaction = [...quotes].sort((a, b) => b.reaction - a.reaction);
  const leading = sortedByReaction[0];
  const lagging = sortedByReaction[sortedByReaction.length - 1];

  // Best net route over the lagged book (fee-aware, like the real bot)
  let best: PairAnalysis["scenario"] | null = null;
  for (const buy of quotes) {
    for (const sell of quotes) {
      if (buy.exchange === sell.exchange || sell.bid <= buy.ask) continue;
      const qty = cfg.tradeAmountUsd / buy.ask;
      const gross = (sell.bid - buy.ask) * qty;
      const fees = cfg.tradeAmountUsd * (exchangeFeePercent(buy.exchange, cfg.lowFeeRouting) / 100) + sell.bid * qty * (exchangeFeePercent(sell.exchange, cfg.lowFeeRouting) / 100);
      const charges = fees + cfg.tradeAmountUsd * (cfg.slippagePercent / 100);
      const net = gross - charges;
      const spreadPercent = ((sell.bid - buy.ask) / buy.ask) * 100;
      const candidate: PairAnalysis["scenario"] = {
        direction, magnitudePercent,
        buyExchange: buy.exchange, sellExchange: sell.exchange,
        buyPrice: parseFloat(buy.ask.toFixed(8)), sellPrice: parseFloat(sell.bid.toFixed(8)),
        spreadPercent: parseFloat(spreadPercent.toFixed(4)),
        grossProfit: parseFloat(gross.toFixed(4)), totalCharges: parseFloat(charges.toFixed(4)),
        netProfit: parseFloat(net.toFixed(4)),
        profitChargeRatio: charges > 0 ? parseFloat((net / charges).toFixed(3)) : 0,
        leadingExchange: leading.exchange, laggingExchange: lagging.exchange,
        strategy: direction === "up"
          ? `Price pumped: BUY ${lagging.exchange} (still cheap, only ${(lagging.reaction * 100).toFixed(0)}% repriced) → SELL ${leading.exchange} (already at the new high)`
          : `Price crashed: BUY ${leading.exchange} (already at the new low) → SELL ${lagging.exchange} (still bidding the old high price)`,
        // Thin books take longer to correct → wider window to capture
        profitWindowSeconds: Math.round(2 + (100 - liquidity) / 9 + effectiveMovePercent * 1.5),
        passesRiskGuard: net >= cfg.minProfitUsd && (charges <= 0 || net / charges >= cfg.minProfitChargeRatio) && spreadPercent >= cfg.spreadThreshold,
        beta, effectiveMovePercent,
      };
      if (!best || candidate.netProfit > best.netProfit) best = candidate;
    }
  }
  if (!best) {
    best = {
      direction, magnitudePercent, buyExchange: lagging.exchange, sellExchange: leading.exchange,
      buyPrice: 0, sellPrice: 0, spreadPercent: 0, grossProfit: 0, totalCharges: 0, netProfit: 0, profitChargeRatio: 0,
      leadingExchange: leading.exchange, laggingExchange: lagging.exchange,
      strategy: "No positive route in this scenario", profitWindowSeconds: 0, passesRiskGuard: false,
      beta, effectiveMovePercent,
    };
  }
  return best!;
}

export function analyzePairs(opts: {
  symbols: string[]; exchanges: string[]; direction: "up" | "down" | "both"; magnitudePercent: number; cfg: ScenarioCfg;
}): { up: PairAnalysis[]; down: PairAnalysis[]; pairs: PairAnalysis[] } {
  const market = getMarketSnapshot(opts.symbols, opts.exchanges);
  const build = (direction: "up" | "down"): PairAnalysis[] => {
    const rows: PairAnalysis[] = market.map((m) => {
      const realised = getRealisedAnalytics(m.symbol);
      const profile = SYMBOL_PROFILES[m.symbol];
      const scenario = simulateFastMove(m.symbol, m.basePrice, opts.exchanges, direction, opts.magnitudePercent, opts.cfg);
      // Volatility-Profit Score: scenario money (dominant), realised spread behaviour, volatility
      const moneyScore = Math.min(42, Math.max(0, scenario.netProfit) * 55);
      const spreadScore = Math.min(24, (realised.maxSpreadPercent * 7) + (realised.avgSpreadPercent * 10));
      const volScore = Math.min(20, realised.realisedVolPercent * 260 + (profile?.volatility ?? 0.001) * 4200);
      const wideScore = Math.min(14, realised.wideFrequencyPercent * 0.28 + (scenario.spreadPercent > 0.75 ? 6 : 0));
      const score = Math.round(Math.min(100, moneyScore + spreadScore + volScore + wideScore));
      const verdict =
        score >= 78 ? "⭐ Immediate-profit pair in fast moves — thin book + slow venues = fat, slow-closing gap"
        : score >= 62 ? "Strong in volatility — spreads widen fast and stay open long enough to capture"
        : score >= 45 ? "Moderate — needs a bigger move (3%+) to clear fees comfortably"
        : "Calm pair — even fast moves only create small gaps; fees eat most of it";
      return {
        symbol: m.symbol, category: m.category, liquidityScore: m.liquidityScore, price: m.basePrice,
        realisedVolPercent: realised.realisedVolPercent,
        profileVolPercent: parseFloat(((profile?.volatility ?? 0) * 100).toFixed(4)),
        velocityPercent: realised.velocityPercent,
        currentSpreadPercent: m.arbitrage.spreadPercent,
        avgSpreadPercent: realised.avgSpreadPercent,
        p95SpreadPercent: realised.p95SpreadPercent,
        maxSpreadPercent: Math.max(realised.maxSpreadPercent, m.arbitrage.spreadPercent),
        wideFrequencyPercent: realised.wideFrequencyPercent,
        samples: realised.samples,
        scenario, volatilityProfitScore: score, verdict,
        history: realised.history,
      };
    });
    return rows.sort((a, b) => b.volatilityProfitScore - a.volatilityProfitScore || b.scenario.netProfit - a.scenario.netProfit);
  };
  const up = build("up");
  const down = build("down");
  // "pairs" = ranked by the requested direction (or the better of both)
  const pairs = opts.direction === "down" ? down : up;
  return { up, down, pairs };
}
