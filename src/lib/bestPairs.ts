/**
 * The researched BEST 6 — and the ONLY pairs the bot trades.
 * Ranked from the bot's own live data (profit, widest spreads, win rate,
 * volatility score). Deliberately no other choices: fewer, better pairs.
 */
export const BEST_6 = [
  { rank: 1, symbol: "PEPE/USDT", category: "meme", accent: "#4ade80", thesis: "Widest spreads found (up to 2.31%) and the #1 profit earner. Thin books on Gate.io/KuCoin lag hardest when price moves fast.", riskNote: "Highest slippage risk of the six — smallest dynamic size, strictest stop." },
  { rank: 2, symbol: "BONK/USDT", category: "meme", accent: "#fb923c", thesis: "#2 profit earner with 2.16% max spread. Solana-meme volatility creates frequent, slow-closing dislocations.", riskNote: "Fast reversals — profit window is short, bot must be first." },
  { rank: 3, symbol: "WIF/USDT", category: "meme", accent: "#f472b6", thesis: "Top Volatility-Profit Score in fast-move analysis (β2.2 — moves 2.2× harder than BTC). Best immediate profit in pumps and crashes.", riskNote: "Lower trade count so far — bot sizes it conservatively." },
  { rank: 4, symbol: "SHIB/USDT", category: "meme", accent: "#facc15", thesis: "100% win rate so far, 1.62% max spread. Deep community liquidity on big venues, stale prices on small ones.", riskNote: "Spreads appear less often — patience pair." },
  { rank: 5, symbol: "INJ/USDT", category: "volatile", accent: "#38bdf8", thesis: "Best non-meme: 100% win rate, 1.57% max spread. Adds diversification away from pure meme correlation.", riskNote: "Thinner book — limit/maker routing matters." },
  { rank: 6, symbol: "ARB/USDT", category: "volatile", accent: "#a78bfa", thesis: "L2 token with strong fast-move beta (β1.7) and 1.53% max spread. Reacts violently to ETH/BTC moves while small venues lag.", riskNote: "Moves with the whole market — watch during BTC dumps." },
] as const;

export const BEST_6_SYMBOLS: string[] = BEST_6.map(p => p.symbol);
