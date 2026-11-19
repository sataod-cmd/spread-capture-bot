export type ExchangeQuote = {
  exchange: string;
  bid: number;
  ask: number;
  mid: number;
  spreadUsd: number;
  spreadPercent: number;
  volume24h: number;
  latencyMs: number;
  takerFeePercent: number;
  makerFeePercent: number;
};

export type SpreadTier = "normal" | "wide" | "mega" | "extreme";
export type SymbolCategory = "major" | "alt" | "volatile" | "meme";

export type SymbolMarket = {
  symbol: string;
  baseAsset: string;
  basePrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  category: SymbolCategory;
  liquidityScore: number; // 0-100, lower = thinner book = wider spreads
  quotes: ExchangeQuote[];
  bestBid: { exchange: string; price: number };
  bestAsk: { exchange: string; price: number };
  arbitrage: {
    buyExchange: string;
    sellExchange: string;
    buyAsk: number;
    sellBid: number;
    spreadUsd: number;
    spreadPercent: number;
    isOpportunity: boolean;
    tier: SpreadTier;
  };
  history: { t: string; price: number; spread: number }[];
};

export function spreadTier(spreadPercent: number, wideThreshold = 0.75): SpreadTier {
  if (spreadPercent >= wideThreshold * 2.4) return "extreme";
  if (spreadPercent >= wideThreshold * 1.6) return "mega";
  if (spreadPercent >= wideThreshold) return "wide";
  return "normal";
}

type SymbolProfile = {
  base: number;
  category: SymbolCategory;
  volatility: number; // random-walk step
  shockChance: number; // probability of a dislocation this tick
  shockMag: number; // max dislocation (fraction) — the source of WIDE spreads
  liquidityScore: number;
};

/**
 * Where wide spreads actually come from in real markets:
 *  - Majors (BTC/ETH) are hyper-liquid → spreads stay 0.05–0.4%
 *  - Alts are thinner → 0.3–1.0%
 *  - Volatile small caps & memes have thin, slow-updating books on smaller
 *    exchanges → dislocations of 1–3% are common. That's the hunting ground.
 */
const SYMBOL_PROFILE: Record<string, SymbolProfile> = {
  "BTC/USDT": { base: 97842, category: "major", volatility: 0.00045, shockChance: 0.2, shockMag: 0.0042, liquidityScore: 98 },
  "ETH/USDT": { base: 3418.5, category: "major", volatility: 0.0006, shockChance: 0.2, shockMag: 0.0048, liquidityScore: 95 },
  "SOL/USDT": { base: 212.84, category: "alt", volatility: 0.00095, shockChance: 0.24, shockMag: 0.007, liquidityScore: 84 },
  "XRP/USDT": { base: 2.42, category: "alt", volatility: 0.0009, shockChance: 0.24, shockMag: 0.007, liquidityScore: 82 },
  "DOGE/USDT": { base: 0.3184, category: "alt", volatility: 0.0011, shockChance: 0.26, shockMag: 0.0085, liquidityScore: 78 },
  "ADA/USDT": { base: 0.984, category: "alt", volatility: 0.001, shockChance: 0.24, shockMag: 0.0075, liquidityScore: 76 },
  "LINK/USDT": { base: 22.47, category: "alt", volatility: 0.00105, shockChance: 0.26, shockMag: 0.0085, liquidityScore: 74 },
  "AVAX/USDT": { base: 38.92, category: "alt", volatility: 0.0011, shockChance: 0.26, shockMag: 0.009, liquidityScore: 72 },
  "SUI/USDT": { base: 4.62, category: "volatile", volatility: 0.0016, shockChance: 0.32, shockMag: 0.013, liquidityScore: 58 },
  "NEAR/USDT": { base: 5.18, category: "volatile", volatility: 0.0015, shockChance: 0.32, shockMag: 0.012, liquidityScore: 60 },
  "ARB/USDT": { base: 0.842, category: "volatile", volatility: 0.0017, shockChance: 0.34, shockMag: 0.014, liquidityScore: 55 },
  "INJ/USDT": { base: 24.86, category: "volatile", volatility: 0.0017, shockChance: 0.34, shockMag: 0.014, liquidityScore: 54 },
  "OP/USDT": { base: 1.92, category: "volatile", volatility: 0.0016, shockChance: 0.33, shockMag: 0.013, liquidityScore: 56 },
  "APT/USDT": { base: 8.94, category: "volatile", volatility: 0.0016, shockChance: 0.33, shockMag: 0.013, liquidityScore: 57 },
  "WIF/USDT": { base: 2.18, category: "meme", volatility: 0.0024, shockChance: 0.4, shockMag: 0.02, liquidityScore: 42 },
  "PEPE/USDT": { base: 0.0000214, category: "meme", volatility: 0.0026, shockChance: 0.42, shockMag: 0.022, liquidityScore: 40 },
  "BONK/USDT": { base: 0.0000418, category: "meme", volatility: 0.0026, shockChance: 0.42, shockMag: 0.022, liquidityScore: 38 },
  "SHIB/USDT": { base: 0.0000262, category: "meme", volatility: 0.0022, shockChance: 0.38, shockMag: 0.018, liquidityScore: 45 },
};

export const VOLATILE_SYMBOLS = Object.entries(SYMBOL_PROFILE).filter(([, p]) => p.category === "volatile" || p.category === "meme").map(([s]) => s);

const BASE_PRICES: Record<string, number> = Object.fromEntries(Object.entries(SYMBOL_PROFILE).map(([s, p]) => [s, p.base]));

const EXCHANGES = ["Binance", "Coinbase", "Kraken", "Bybit", "KuCoin", "OKX", "Gate.io", "Bitget"] as const;

/**
 * REAL SPOT FEES (VIP 0 / standard retail tier) — verified against the
 * exchanges' published fee schedules:
 *
 *   Binance spot (VIP 0): 0.10% maker / 0.10% taker  (0.075% with BNB fee payment)
 *   Bybit   spot (VIP 0): 0.10% maker / 0.10% taker  (0.075% with MNT fee payment)
 *   OKX     spot (VIP 0): 0.10% / 0.10%
 *   Gate.io spot (VIP 0): 0.10% / 0.10%
 *   Bitget  spot (VIP 0): 0.10% / 0.10%
 *   Kraken  Pro spot:     0.16% maker / 0.26% taker
 *   Coinbase Advanced:    0.40% maker / 0.60% taker
 *
 * IMPORTANT: a round trip is TWO fills, so total spot commission is 2 × the
 * per-leg rate (0.20% at 0.10%). The earlier model wrongly used FUTURES
 * maker fees (0.02%) for a spot strategy — that understated charges ~3x.
 */
const EXCHANGE_PROFILE: Record<string, { bias: number; biasRange: number; spreadBps: number; volumeMul: number; latency: number; takerFeePercent: number; makerFeePercent: number; feeNote: string }> = {
  Binance: { bias: 0.0001, biasRange: 0.0007, spreadBps: 2.2, volumeMul: 1.8, latency: 18, takerFeePercent: 0.10, makerFeePercent: 0.10, feeNote: "Spot VIP 0: 0.10%/leg. 0.075% with 'pay in BNB'." },
  Bybit: { bias: -0.0005, biasRange: 0.0008, spreadBps: 3.0, volumeMul: 1.3, latency: 24, takerFeePercent: 0.10, makerFeePercent: 0.10, feeNote: "Spot VIP 0: 0.10%/leg (maker = taker). 0.075% with 'pay in MNT'." },
  OKX: { bias: -0.0008, biasRange: 0.0012, spreadBps: 4.2, volumeMul: 1.0, latency: 32, takerFeePercent: 0.10, makerFeePercent: 0.10, feeNote: "Spot VIP 0: 0.10%/leg" },
  "Gate.io": { bias: 0.0014, biasRange: 0.0022, spreadBps: 9.5, volumeMul: 0.4, latency: 88, takerFeePercent: 0.10, makerFeePercent: 0.10, feeNote: "Spot VIP 0: 0.10%/leg" },
  Bitget: { bias: -0.0012, biasRange: 0.0019, spreadBps: 8.2, volumeMul: 0.45, latency: 76, takerFeePercent: 0.10, makerFeePercent: 0.10, feeNote: "Spot VIP 0: 0.10%/leg" },
  Kraken: { bias: -0.0003, biasRange: 0.001, spreadBps: 5.1, volumeMul: 0.7, latency: 55, takerFeePercent: 0.26, makerFeePercent: 0.16, feeNote: "Pro spot: 0.16% maker / 0.26% taker" },
  Coinbase: { bias: 0.0006, biasRange: 0.0009, spreadBps: 4.5, volumeMul: 1.1, latency: 42, takerFeePercent: 0.60, makerFeePercent: 0.40, feeNote: "Advanced trade: 0.40% maker / 0.60% taker — too costly for this bot" },
};

/** Token-fee discount: Binance "pay in BNB" / Bybit "pay in MNT" = 25% off spot. */
export const TOKEN_FEE_DISCOUNT = 0.75;

export function exchangeFeePercent(exchange: string, lowFeeRouting: boolean, tokenDiscount = false) {
  const p = EXCHANGE_PROFILE[exchange];
  if (!p) return lowFeeRouting ? 0.10 : 0.10;
  const base = lowFeeRouting ? p.makerFeePercent : p.takerFeePercent;
  return tokenDiscount ? parseFloat((base * TOKEN_FEE_DISCOUNT).toFixed(4)) : base;
}

/**
 * How fast each exchange reprices when the market jumps.
 * 1.0 = instant, 0.4 = it has only reflected 40% of the move in the first
 * moments. This lag gap is EXACTLY what a fast move turns into arbitrage:
 *   Price jumps UP  → fast exchange is already expensive, slow is still cheap
 *                     → BUY the slow exchange, SELL the fast one.
 *   Price crashes DOWN → fast exchange is already cheap, slow still bids high
 *                     → BUY the fast exchange, SELL the slow one.
 */
export const EXCHANGE_REACTION: Record<string, number> = {
  Binance: 0.96, Bybit: 0.93, OKX: 0.89, KuCoin: 0.76, Bitget: 0.66, Kraken: 0.61, Coinbase: 0.56, "Gate.io": 0.45,
};
export function exchangeReaction(exchange: string) { return EXCHANGE_REACTION[exchange] ?? 0.7; }
export function getExchangeProfiles() {
  return [...EXCHANGES].map((exchange) => {
    const p = EXCHANGE_PROFILE[exchange];
    return {
      exchange,
      makerFeePercent: p?.makerFeePercent ?? 0.10,
      takerFeePercent: p?.takerFeePercent ?? 0.10,
      feeNote: p?.feeNote ?? "Spot fee — check the exchange's live fee page",
      reactionSpeed: exchangeReaction(exchange),
      latencyMs: p?.latency ?? 50,
      internalSpreadBps: p?.spreadBps ?? 5,
      volumeMultiplier: p?.volumeMul ?? 0.8,
    };
  });
}
/** Internal bid-ask width (bps) per exchange, before thinness multiplier. */
export function exchangeSpreadBps(exchange: string) { return EXCHANGE_PROFILE[exchange]?.spreadBps ?? 5; }

export const SYMBOL_PROFILES = SYMBOL_PROFILE;

/** Realised stats from the rolling in-memory history (no DB, no extra calls). */
export function getRealisedAnalytics(symbol: string) {
  const h = state.history[symbol] || [];
  const prices = h.map(x => x.price).filter(x => x > 0);
  const spreads = h.map(x => x.spread);
  let realisedVolPercent = SYMBOL_PROFILE[symbol] ? SYMBOL_PROFILE[symbol].volatility * 100 : 0;
  if (prices.length > 3) {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) returns.push(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100);
    const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
    const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length;
    realisedVolPercent = Math.sqrt(variance);
  }
  const velocityPercent = prices.length > 5 ? ((prices[prices.length - 1] - prices[prices.length - 6]) / prices[prices.length - 6]) * 100 : 0;
  const avgSpread = spreads.length ? spreads.reduce((s, x) => s + x, 0) / spreads.length : 0;
  const maxSpread = spreads.length ? Math.max(...spreads) : 0;
  const sortedSpreads = [...spreads].sort((a, b) => a - b);
  const p95Spread = sortedSpreads.length ? sortedSpreads[Math.min(sortedSpreads.length - 1, Math.floor(sortedSpreads.length * 0.95))] : 0;
  const wideFreq = spreads.length ? (spreads.filter(s => s >= 0.75).length / spreads.length) * 100 : 0;
  return {
    samples: h.length,
    realisedVolPercent: parseFloat(realisedVolPercent.toFixed(4)),
    velocityPercent: parseFloat(velocityPercent.toFixed(4)),
    avgSpreadPercent: parseFloat(avgSpread.toFixed(4)),
    maxSpreadPercent: parseFloat(maxSpread.toFixed(4)),
    p95SpreadPercent: parseFloat(p95Spread.toFixed(4)),
    wideFrequencyPercent: parseFloat(wideFreq.toFixed(1)),
    history: h.slice(-40),
  };
}

/**
 * Inject a genuine fast move into the paper market (used by the Stress Test).
 * The base price jumps instantly; the slowest exchange is left lagging behind
 * for the next few ticks — exactly what happens in a real crash/pump.
 */
export function injectFastMove(symbol: string, direction: "up" | "down", magnitudePercent: number) {
  const profile = SYMBOL_PROFILE[symbol];
  if (!profile) return { ok: false as const, error: `Unknown symbol ${symbol}` };
  if (state.prices[symbol] == null) state.prices[symbol] = profile.base;
  const move = (direction === "up" ? 1 : -1) * (Math.min(10, Math.max(0.1, magnitudePercent)) / 100);
  const before = state.prices[symbol];
  state.prices[symbol] = Math.max(before * (1 + move), profile.base * 0.02);
  // Slowest venue lags: it only reflects ~45% of the move at first
  state.lastShock[symbol] = {
    exchange: "Gate.io",
    magnitude: parseFloat((-move * 0.55).toFixed(5)),
    expiresTick: state.tick + 9,
  };
  return {
    ok: true as const, symbol, direction, magnitudePercent,
    priceBefore: parseFloat(before.toFixed(priceDecimals(before) + 2)),
    priceAfter: parseFloat(state.prices[symbol].toFixed(priceDecimals(state.prices[symbol]) + 2)),
    laggingExchange: "Gate.io",
    message: direction === "up"
      ? `${symbol} pumped ${magnitudePercent}% instantly • Gate.io is lagging at the OLD CHEAP price — watch the bot BUY Gate.io (lagging) and SELL a fast exchange that already pumped`
      : `${symbol} crashed ${magnitudePercent}% instantly • Gate.io is still bidding the OLD HIGH price — watch the bot BUY a fast exchange that already crashed and SELL into Gate.io's lagging high bid`,
  };
}

export function priceDecimals(price: number) {
  if (price < 0.0001) return 8;
  if (price < 0.01) return 6;
  if (price < 5) return 5;
  if (price < 100) return 3;
  return 2;
}
function roundPrice(price: number) { return parseFloat(price.toFixed(priceDecimals(price))); }

type GlobalState = {
  prices: Record<string, number>;
  tick: number;
  history: Record<string, { t: string; price: number; spread: number }[]>;
  lastShock: Record<string, { exchange: string; magnitude: number; expiresTick: number } | null>;
};

const g = globalThis as typeof globalThis & { __arbMarket?: GlobalState };

function initState(): GlobalState {
  const prices = { ...BASE_PRICES };
  const history: GlobalState["history"] = {};
  Object.keys(BASE_PRICES).forEach((s) => (history[s] = []));
  return { prices, tick: 0, history, lastShock: {} };
}

if (!g.__arbMarket) g.__arbMarket = initState();
// If new symbols were added after the process started, initialise them too
for (const s of Object.keys(BASE_PRICES)) {
  if (g.__arbMarket.prices[s] == null) g.__arbMarket.prices[s] = BASE_PRICES[s];
  if (!g.__arbMarket.history[s]) g.__arbMarket.history[s] = [];
}
const state = g.__arbMarket!;

function rand(min: number, max: number) { return min + Math.random() * (max - min); }

export function getMarketSnapshot(symbolsFilter?: string[], exchangesFilter?: string[]): SymbolMarket[] {
  state.tick += 1;
  const activeSymbols = symbolsFilter && symbolsFilter.length ? symbolsFilter : Object.keys(BASE_PRICES);
  const activeExchanges = exchangesFilter && exchangesFilter.length ? exchangesFilter : [...EXCHANGES];
  const result: SymbolMarket[] = [];

  for (const symbol of activeSymbols) {
    const profile = SYMBOL_PROFILE[symbol];
    if (!profile) continue;
    if (state.prices[symbol] == null) state.prices[symbol] = profile.base;

    // Random walk — volatile/meme pairs move much more
    const drift = (Math.random() - 0.498) * profile.volatility * 2;
    const shockDrift = Math.random() < 0.08 ? (Math.random() - 0.5) * profile.volatility * 3 : 0;
    state.prices[symbol] = Math.max(state.prices[symbol] * (1 + drift + shockDrift * 0.3), profile.base * 0.05);

    // Dislocation shock: one (usually smaller/slower) exchange lags the move.
    // This is what creates the WIDE cross-exchange spreads the hunter wants.
    if (Math.random() < profile.shockChance || !state.lastShock[symbol]) {
      // Bias the shocked venue towards the thinner exchanges, where real dislocations live
      const thin = activeExchanges.filter(e => ["Gate.io", "Bitget", "KuCoin", "Kraken"].includes(e));
      const pool = thin.length && Math.random() < 0.65 ? thin : activeExchanges;
      const ex = pool[Math.floor(Math.random() * pool.length)];
      state.lastShock[symbol] = {
        exchange: ex,
        magnitude: rand(-profile.shockMag, profile.shockMag),
        expiresTick: state.tick + Math.floor(rand(3, 10)),
      };
    }
    if (state.lastShock[symbol] && state.tick > state.lastShock[symbol]!.expiresTick) state.lastShock[symbol] = null;

    const basePrice = state.prices[symbol];
    // Thin pairs also get wider internal bid-ask on every venue
    const thinnessMul = profile.category === "meme" ? 2.4 : profile.category === "volatile" ? 1.7 : profile.category === "alt" ? 1.2 : 1;

    const quotes: ExchangeQuote[] = activeExchanges.map((exchange) => {
      const ep = EXCHANGE_PROFILE[exchange] || { bias: 0, biasRange: 0.001, spreadBps: 5, volumeMul: 0.8, latency: 50, takerFeePercent: 0.08, makerFeePercent: 0.04 };
      let exchangePrice = basePrice * (1 + ep.bias + rand(-ep.biasRange, ep.biasRange));
      if (state.lastShock[symbol]?.exchange === exchange) exchangePrice *= 1 + state.lastShock[symbol]!.magnitude;
      const spreadBps = (ep.spreadBps * thinnessMul) + rand(-0.8, 1.8) + (Math.random() < 0.1 ? rand(2, 6) : 0);
      const half = exchangePrice * (spreadBps / 10000) / 2;
      const bid = exchangePrice - half;
      const ask = exchangePrice + half;
      return {
        exchange,
        bid: roundPrice(bid),
        ask: roundPrice(ask),
        mid: parseFloat(exchangePrice.toFixed(priceDecimals(exchangePrice) + 2)),
        spreadUsd: parseFloat((ask - bid).toFixed(priceDecimals(exchangePrice) + 2)),
        spreadPercent: parseFloat(((ask - bid) / exchangePrice * 100).toFixed(4)),
        volume24h: Math.round((Math.min(basePrice, 5000) * rand(800, 5200) * ep.volumeMul * (profile.liquidityScore / 80)) / 10) * 10,
        latencyMs: Math.round(ep.latency + rand(-6, 14)),
        takerFeePercent: ep.takerFeePercent,
        makerFeePercent: ep.makerFeePercent,
      };
    });

    const bestBid = quotes.reduce((a, b) => (b.bid > a.price ? { exchange: b.exchange, price: b.bid } : a), { exchange: quotes[0].exchange, price: quotes[0].bid });
    const bestAsk = quotes.reduce((a, b) => (b.ask < a.price ? { exchange: b.exchange, price: b.ask } : a), { exchange: quotes[0].exchange, price: quotes[0].ask });
    const spreadUsd = bestBid.price - bestAsk.price;
    const spreadPercent = bestAsk.price ? (spreadUsd / bestAsk.price) * 100 : 0;

    const now = new Date();
    const label = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (!state.history[symbol]) state.history[symbol] = [];
    state.history[symbol].push({ t: label, price: roundPrice(basePrice), spread: parseFloat(spreadPercent.toFixed(4)) });
    if (state.history[symbol].length > 120) state.history[symbol].shift();

    result.push({
      symbol,
      baseAsset: symbol.split("/")[0],
      basePrice: roundPrice(basePrice),
      change24h: parseFloat(((basePrice - profile.base) / profile.base * 100 + rand(-0.4, 0.4)).toFixed(2)),
      high24h: roundPrice(profile.base * 1.028),
      low24h: roundPrice(profile.base * 0.971),
      category: profile.category,
      liquidityScore: profile.liquidityScore,
      quotes,
      bestBid,
      bestAsk,
      arbitrage: {
        buyExchange: bestAsk.exchange,
        sellExchange: bestBid.exchange,
        buyAsk: bestAsk.price,
        sellBid: bestBid.price,
        spreadUsd: parseFloat(spreadUsd.toFixed(priceDecimals(bestAsk.price) + 2)),
        spreadPercent: parseFloat(spreadPercent.toFixed(4)),
        isOpportunity: spreadUsd > 0 && bestAsk.exchange !== bestBid.exchange,
        tier: spreadTier(spreadPercent),
      },
      history: [...state.history[symbol]],
    });
  }
  // Widest first — the hunter always sees the biggest dislocation at the top
  return result.sort((a, b) => b.arbitrage.spreadPercent - a.arbitrage.spreadPercent);
}

export const ALL_SYMBOLS = Object.keys(SYMBOL_PROFILE);
export const ALL_EXCHANGES = [...EXCHANGES];
export const SYMBOL_CATEGORY: Record<string, SymbolCategory> = Object.fromEntries(Object.entries(SYMBOL_PROFILE).map(([s, p]) => [s, p.category]));
