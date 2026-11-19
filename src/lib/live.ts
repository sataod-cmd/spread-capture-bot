import { db } from "../db";
import { botConfigs, trades, opportunities } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { ensureConfig, log } from "./bot";
import { BEST_6 } from "./bestPairs";
import { binanceBook, binancePlaceOrder, binanceGetOrder, binanceCancelOrder, binanceExchangeInfo, binanceCommission, binanceAccount, binanceBooksBatch, type InstInfo } from "./exchanges/binance";
import { bybitBook, bybitPlaceOrder, bybitGetOrder, bybitCancelOrder, bybitInstruments, bybitFeeRate, bybitAccount, bybitBooksBatch } from "./exchanges/bybit";
import { newClientOrderId, type Venue, type Book } from "./exchanges/types";
import { getStreamBooks } from "./exchanges/binanceStream";

/**
 * LIVE execution engine — real order books, real fees, real orders.
 *
 * Every rule below is enforced BEFORE an order is sent:
 *  1. Symbol must be TRADING on both venues (no orders on unlisted pairs).
 *  2. Fees are read from the account and priced at the TAKER rate, because
 *     both legs are IOC (they take liquidity). If a fee cannot be read, the
 *     route is skipped — the bot never trades blind on a guessed fee.
 *  3. Quantity is rounded DOWN to the venue lot step; prices are rounded to
 *     the venue tick (buy up, sell down). Values are sent as plain decimals.
 *  4. Size is capped by the USD limit AND by top-of-book depth (half of it),
 *     so an order can never be larger than the market can absorb.
 *  5. Minimum quantity and minimum notional of both venues must be met.
 *  6. Inventory must exist: USDT on the buy venue, the coin on the sell venue.
 *  7. Profit must beat charges by the configured ratio AND clear the minimum.
 *
 * After placement, if the two legs did not fill equally, the excess is
 * immediately closed on the venue where it sits. If it cannot be closed, live
 * trading halts itself and the exposure is logged for manual handling.
 *
 * P&L is computed from REAL fill prices and REAL fee rates — nothing hard-coded.
 */

export const HARD_MAX_TRADE_USD = 50;          // absolute ceiling regardless of settings
const MIN_SECONDS_BETWEEN_LIVE_EXEC = 10;
const CACHE_MS = 10 * 60_000;
const TERMINAL = new Set(["filled", "cancelled", "canceled", "expired", "rejected", "partiallyfilledcanceled", "deactivated"]);

export const SYMBOL_MAP: Record<string, string> = {
  "PEPE/USDT": "PEPEUSDT", "BONK/USDT": "BONKUSDT", "WIF/USDT": "WIFUSDT",
  "SHIB/USDT": "SHIBUSDT", "INJ/USDT": "INJUSDT", "ARB/USDT": "ARBUSDT",
};

type Fee = { makerPct: number; takerPct: number };
type Venues = { binance: Fee; bybit: Fee };
type Balances = { binance: Record<string, number>; bybit: Record<string, number> };

export type LiveRoute = {
  symbol: string; venueSymbol: string; baseAsset: string;
  buyVenue: Venue; sellVenue: Venue;
  buyPrice: number; sellPrice: number; spreadPercent: number;
  qty: number; notional: number; grossProfit: number; fees: number; netProfit: number;
  profitChargeRatio: number; passes: boolean; reason?: string; buyable: boolean; sellable: boolean;
  qtyStr: string; buyPriceStr: string; sellPriceStr: string;
  buyFeePct: number; sellFeePct: number;
};

export type LiveScanResult = {
  live: boolean;
  dryRun: boolean;
  scannedAt: string;
  routes: LiveRoute[];
  executed: { symbol: string; route: string; net: number; spread: number }[];
  errors: string[];
  balances: { binanceUsd: number; bybitUsd: number };
  fees: { binanceMaker: number; binanceTaker: number; bybitMaker: number; bybitTaker: number };
};

// ── caches & locks ─────────────────────────────────────────────────────
let instCache: { at: number; binance: Record<string, InstInfo>; bybit: Record<string, InstInfo> } | null = null;
const feeCache = new Map<string, { at: number; fees: Venues }>();
let lastExecAt = 0;
let execBusy = false;
const BALANCE_CACHE_MS = 30_000;
let balanceCache: { at: number; data: { bal: Balances; errors: string[] } } | null = null;

// ── exact decimal helpers (exported for tests) ─────────────────────────
export const decimalsOf = (step: number) => Math.max(0, Math.round(-Math.log10(step)));
// Results are snapped to the step's decimal places so float drift never leaks out.
export const floorToStep = (x: number, step: number) =>
  Number((Math.floor(x / step + 1e-9) * step).toFixed(decimalsOf(step)));
export const roundToTick = (x: number, tick: number, mode: "up" | "down") =>
  Number(((mode === "up" ? Math.ceil(x / tick - 1e-9) : Math.floor(x / tick + 1e-9)) * tick).toFixed(decimalsOf(tick)));
export const toPlain = (x: number, decimals: number) => x.toFixed(decimals);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isTerminal = (s?: string) => !!s && TERMINAL.has(String(s).toLowerCase());

const VENUE = {
  binance: { place: binancePlaceOrder, get: binanceGetOrder, cancel: binanceCancelOrder, book: binanceBook },
  bybit: { place: bybitPlaceOrder, get: bybitGetOrder, cancel: bybitCancelOrder, book: bybitBook },
} as const;

// ── market metadata ────────────────────────────────────────────────────
async function getInstruments() {
  if (instCache && Date.now() - instCache.at < CACHE_MS) return instCache;
  const symbols = Object.values(SYMBOL_MAP);
  const [b, y] = await Promise.all([binanceExchangeInfo(symbols), bybitInstruments(symbols)]);
  instCache = { at: Date.now(), binance: b, bybit: y };
  return instCache;
}

/** Fee rates for a symbol from the ACCOUNT. Returns null if either venue cannot be read. */
async function getFees(venueSymbol: string): Promise<Venues | null> {
  const c = feeCache.get(venueSymbol);
  if (c && Date.now() - c.at < CACHE_MS) return c.fees;
  try {
    const [b, y] = await Promise.all([binanceCommission(venueSymbol), bybitFeeRate(venueSymbol)]);
    const ok = [b.makerPercent, b.takerPercent, y.makerPercent, y.takerPercent].every((n) => Number.isFinite(n) && n >= 0);
    if (!ok) return null;
    const fees: Venues = {
      binance: { makerPct: b.makerPercent, takerPct: b.takerPercent },
      bybit: { makerPct: y.makerPercent, takerPct: y.takerPercent },
    };
    feeCache.set(venueSymbol, { at: Date.now(), fees });
    return fees;
  } catch {
    return null;
  }
}

async function getBalances(): Promise<{ bal: Balances; errors: string[] }> {
  if (balanceCache && Date.now() - balanceCache.at < BALANCE_CACHE_MS) return balanceCache.data;
  const bal: Balances = { binance: {}, bybit: {} };
  const errors: string[] = [];
  try {
    const a = await binanceAccount();
    for (const b of a.balances) bal.binance[b.asset] = b.free;
  } catch (e: any) { errors.push(`Binance balance: ${e?.message}`); }
  try {
    const a = await bybitAccount();
    for (const b of a.balances) bal.bybit[b.asset] = b.free;
  } catch (e: any) { errors.push(`Bybit balance: ${e?.message}`); }
  balanceCache = { at: Date.now(), data: { bal, errors } };
  return balanceCache.data;
}

async function todayLivePnl(): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const [r] = await db
    .select({ pnl: sql<number>`coalesce(sum(${trades.netProfit}), 0)::float` })
    .from(trades)
    .where(sql`${trades.source} = 'live' and ${trades.executedAt} >= ${start}`);
  return r?.pnl ?? 0;
}

// ── route evaluation ───────────────────────────────────────────────────
export function buildRoute(a: {
  pair: string; venueSymbol: string; base: string;
  buyVenue: Venue; sellVenue: Venue;
  buyBook: Book; sellBook: Book;
  buyInst?: InstInfo; sellInst?: InstInfo;
  fees: Venues | null; bal: Balances;
  cap: number; config: any; dailyBlocked: boolean;
}): LiveRoute {
  const base: LiveRoute = {
    symbol: a.pair, venueSymbol: a.venueSymbol, baseAsset: a.base,
    buyVenue: a.buyVenue, sellVenue: a.sellVenue,
    buyPrice: 0, sellPrice: 0, spreadPercent: 0, qty: 0, notional: 0,
    grossProfit: 0, fees: 0, netProfit: 0, profitChargeRatio: 0,
    passes: false, buyable: false, sellable: false,
    qtyStr: "0", buyPriceStr: "0", sellPriceStr: "0", buyFeePct: 0, sellFeePct: 0,
  };
  const reject = (reason: string, patch: Partial<LiveRoute> = {}): LiveRoute => ({ ...base, ...patch, reason, passes: false });

  // 1. listing
  if (!a.buyInst || !a.sellInst) return reject("Pair not listed on both venues");
  if (a.buyInst.status.toUpperCase() !== "TRADING" && a.buyInst.status !== "Trading") return reject(`${a.buyVenue} pair not trading (${a.buyInst.status})`);
  if (a.sellInst.status.toUpperCase() !== "TRADING" && a.sellInst.status !== "Trading") return reject(`${a.sellVenue} pair not trading (${a.sellInst.status})`);
  if (!(a.buyInst.stepSize > 0) || !(a.sellInst.stepSize > 0) || !(a.buyInst.tickSize > 0) || !(a.sellInst.tickSize > 0))
    return reject("Exchange lot/tick filter missing — refusing to size an order");

  // 2. fees (taker: both legs are IOC)
  if (!a.fees) return reject("Fee rate unavailable from account — not trading blind");
  const buyFeePct = a.fees[a.buyVenue].takerPct;
  const sellFeePct = a.fees[a.sellVenue].takerPct;
  base.buyFeePct = buyFeePct; base.sellFeePct = sellFeePct;

  if (a.dailyBlocked) return reject("Daily live loss limit reached — paused until UTC midnight");
  if (!(a.buyBook.ask > 0) || !(a.sellBook.bid > 0)) return reject("Empty order book");

  // 3. prices on the tick grid
  const buyPrice = roundToTick(a.buyBook.ask, a.buyInst.tickSize, "up");
  const sellPrice = roundToTick(a.sellBook.bid, a.sellInst.tickSize, "down");
  const spreadPercent = ((sellPrice - buyPrice) / buyPrice) * 100;

  // 4. size: USD cap and half of top-of-book depth on both sides
  const step = Math.max(a.buyInst.stepSize, a.sellInst.stepSize);
  const depth = Math.min(a.buyBook.askQty, a.sellBook.bidQty) * 0.5;
  const qty = floorToStep(Math.min(a.cap / buyPrice, depth), step);
  const notional = qty * buyPrice;
  const qtyStr = toPlain(qty, decimalsOf(step));
  const buyPriceStr = toPlain(buyPrice, decimalsOf(a.buyInst.tickSize));
  const sellPriceStr = toPlain(sellPrice, decimalsOf(a.sellInst.tickSize));

  const charges = notional * buyFeePct / 100 + sellPrice * qty * sellFeePct / 100;
  const gross = (sellPrice - buyPrice) * qty;
  const net = gross - charges;
  const ratio = charges > 0 ? net / charges : 0;

  const withNums: Partial<LiveRoute> = {
    buyPrice, sellPrice, spreadPercent: parseFloat(spreadPercent.toFixed(4)),
    qty, notional: parseFloat(notional.toFixed(4)), grossProfit: parseFloat(gross.toFixed(4)),
    fees: parseFloat(charges.toFixed(4)), netProfit: parseFloat(net.toFixed(4)),
    profitChargeRatio: parseFloat(ratio.toFixed(3)), qtyStr, buyPriceStr, sellPriceStr,
  };

  // 5. exchange minimums
  const minQty = Math.max(a.buyInst.minQty, a.sellInst.minQty);
  const minNotional = Math.max(a.buyInst.minNotional, a.sellInst.minNotional);
  if (qty <= 0 || qty < minQty) return reject(`Size ${qty} below exchange minimum ${minQty} (after depth/USD cap)`, withNums);
  if (notional < minNotional) return reject(`Notional $${notional.toFixed(2)} below exchange minimum $${minNotional}`, withNums);

  // 6. inventory
  const usdtFree = a.bal[a.buyVenue]["USDT"] ?? 0;
  const baseFree = a.bal[a.sellVenue][a.base] ?? 0;
  const buyable = usdtFree >= notional * (1 + buyFeePct / 100);
  const sellable = baseFree >= qty;

  // 7. profit gate
  const passes = !!(
    buyable && sellable &&
    net >= a.config.minProfitUsd &&
    ratio >= a.config.minProfitChargeRatio &&
    spreadPercent >= a.config.spreadThreshold
  );
  const reason = !buyable ? `Need $${(notional * (1 + buyFeePct / 100)).toFixed(2)} USDT on ${a.buyVenue} (have $${usdtFree.toFixed(2)})`
    : !sellable ? `Need ${qty} ${a.base} on ${a.sellVenue} (have ${baseFree})`
    : net < a.config.minProfitUsd ? `Net $${net.toFixed(4)} < min $${a.config.minProfitUsd}`
    : ratio < a.config.minProfitChargeRatio ? `Profit only ${ratio.toFixed(2)}× charges (need ${a.config.minProfitChargeRatio}×)`
    : spreadPercent < a.config.spreadThreshold ? `Spread ${spreadPercent.toFixed(3)}% < ${a.config.spreadThreshold}%`
    : undefined;

  return { ...base, ...withNums, passes, buyable, sellable, reason };
}

export async function liveScan(opts: { execute?: boolean } = {}): Promise<LiveScanResult> {
  const config = await ensureConfig();
  const dryRun = !config.liveEnabled || config.liveDryRun;
  const errors: string[] = [];
  const routes: LiveRoute[] = [];
  const executed: LiveScanResult["executed"] = [];
  const cap = Math.min(config.liveMaxTradeUsd || 20, config.maxTradeAmountUsd || HARD_MAX_TRADE_USD, HARD_MAX_TRADE_USD);

  const empty = (): LiveScanResult => ({
    live: config.liveEnabled, dryRun, scannedAt: new Date().toISOString(), routes, executed, errors,
    balances: { binanceUsd: 0, bybitUsd: 0 }, fees: { binanceMaker: 0, binanceTaker: 0, bybitMaker: 0, bybitTaker: 0 },
  });

  let inst: Awaited<ReturnType<typeof getInstruments>>;
  try { inst = await getInstruments(); }
  catch (e: any) { errors.push(`Market metadata unavailable: ${e?.message}`); return empty(); }

  const { bal, errors: balErrors } = await getBalances();
  errors.push(...balErrors);
  const dayPnl = await todayLivePnl();
  const dailyBlocked = dayPnl <= -(config.maxDailyLossUsd || 3);
  if (dailyBlocked) errors.push(`Daily live loss limit reached (${dayPnl.toFixed(4)}) — paused until UTC midnight`);

  // Binance books come from the persistent WebSocket stream. REST is used only
  // for symbols that have not produced a fresh stream frame yet (cold start or
  // reconnect), so steady-state scanning spends ZERO Binance REST book weight.
  const allSymbols = BEST_6.map((p) => SYMBOL_MAP[p.symbol]).filter(Boolean) as string[];
  const streamed = getStreamBooks(allSymbols);
  let binanceBooks: Record<string, Book> = { ...streamed.books };
  if (streamed.missing.length) {
    try {
      const fallback = await binanceBooksBatch(streamed.missing);
      binanceBooks = { ...binanceBooks, ...fallback };
    } catch (e: any) { errors.push(`Binance book fallback: ${e?.message}`); }
  }
  let bybitBooks: Record<string, Book> = {};
  try { bybitBooks = await bybitBooksBatch(allSymbols); }
  catch (e: any) { errors.push(`Bybit batch books: ${e?.message}`); }

  for (const pair of BEST_6) {
    const vs = SYMBOL_MAP[pair.symbol];
    if (!vs) continue;
    const base = vs.replace(/USDT$/, "");
    const bBook = binanceBooks[vs] ?? null;
    const yBook = bybitBooks[vs] ?? null;
    if (!bBook || !yBook) { errors.push(`${pair.symbol}: missing book on one venue`); continue; }
    const fees = await getFees(vs);
    const iB = inst.binance[vs], iY = inst.bybit[vs];

    routes.push(buildRoute({ pair: pair.symbol, venueSymbol: vs, base, buyVenue: "binance", sellVenue: "bybit",
      buyBook: bBook, sellBook: yBook, buyInst: iB, sellInst: iY, fees, bal, cap, config, dailyBlocked }));
    routes.push(buildRoute({ pair: pair.symbol, venueSymbol: vs, base, buyVenue: "bybit", sellVenue: "binance",
      buyBook: yBook, sellBook: bBook, buyInst: iY, sellInst: iB, fees, bal, cap, config, dailyBlocked }));
  }

  routes.sort((a, b) => (b.passes ? 1 : 0) - (a.passes ? 1 : 0) || b.netProfit - a.netProfit);

  const best = routes.find((r) => r.passes);
  if (best && opts.execute && !dryRun) {
    if (execBusy) errors.push("A live execution is already running — skipped this cycle");
    else if (Date.now() - lastExecAt < MIN_SECONDS_BETWEEN_LIVE_EXEC * 1000) errors.push("Live pacing: waiting between executions");
    else {
      execBusy = true;
      try {
        const res = await executeLiveRoute(best, config);
        lastExecAt = Date.now();
        if (res.ok) executed.push({ symbol: best.symbol, route: `${best.buyVenue}→${best.sellVenue}`, net: res.net ?? 0, spread: best.spreadPercent });
        else if (res.error) errors.push(res.error);
      } catch (e: any) {
        errors.push(`Execution error: ${e?.message}`);
        await haltLive(`execution error on ${best.symbol}: ${e?.message}`);
      } finally { execBusy = false; }
    }
  }

  const f = await getFees(SYMBOL_MAP["PEPE/USDT"]);
  return {
    live: config.liveEnabled, dryRun, scannedAt: new Date().toISOString(),
    routes, executed, errors,
    balances: { binanceUsd: bal.binance["USDT"] ?? 0, bybitUsd: bal.bybit["USDT"] ?? 0 },
    fees: {
      binanceMaker: f?.binance.makerPct ?? 0, binanceTaker: f?.binance.takerPct ?? 0,
      bybitMaker: f?.bybit.makerPct ?? 0, bybitTaker: f?.bybit.takerPct ?? 0,
    },
  };
}

// ── execution ──────────────────────────────────────────────────────────
type Leg = { venue: Venue; side: "BUY" | "SELL"; qty: number; avg: number; feePct: number };

async function haltLive(reason: string) {
  const config = await ensureConfig();
  await db.update(botConfigs).set({ liveEnabled: false, liveDryRun: true, updatedAt: new Date() }).where(eq(botConfigs.id, config.id));
  await log("warn", `🚨 LIVE TRADING HALTED — ${reason}. Check both exchanges and close any open coins manually.`);
}

/** Place one IOC limit order and wait for its final state. */
async function placeLeg(venue: Venue, vs: string, side: "BUY" | "SELL", qtyStr: string, priceStr: string, tag: string) {
  const v = VENUE[venue];
  const clientOrderId = newClientOrderId(tag);
  const placed = await v.place({ symbol: vs, side, qty: qtyStr, price: priceStr, timeInForce: "IOC", clientOrderId });
  if (!placed.ok) return { ok: false as const, error: placed.error, filled: 0, avg: 0, status: "REJECTED", orderId: "", clientOrderId };
  let st = { status: placed.status || "NEW", filledQty: placed.filledQty || 0, avgPrice: placed.avgPrice || 0 };
  for (let i = 0; i < 5 && !isTerminal(st.status); i++) {
    await sleep(400);
    const g = await v.get(vs, placed.orderId || "", clientOrderId);
    st = { status: g.status, filledQty: g.filledQty, avgPrice: g.avgPrice };
  }
  return { ok: true as const, error: undefined, filled: st.filledQty, avg: st.avgPrice, status: st.status, orderId: placed.orderId || "", clientOrderId };
}

/** Close an unbalanced position immediately, with a 0.5% price allowance. Up to 3 attempts. */
async function flatten(venue: Venue, vs: string, side: "BUY" | "SELL", qty: number, step: number, tick: number, feePct: number, legs: Leg[]) {
  let remaining = qty;
  for (let attempt = 0; attempt < 3 && remaining >= step; attempt++) {
    const book = await VENUE[venue].book(vs);
    const px = side === "SELL" ? roundToTick(book.bid * 0.995, tick, "down") : roundToTick(book.ask * 1.005, tick, "up");
    const q = floorToStep(remaining, step);
    if (q < step || !(px > 0)) break;
    const leg = await placeLeg(venue, vs, side, toPlain(q, decimalsOf(step)), toPlain(px, decimalsOf(tick)), "FLT");
    if (leg.ok && leg.filled > 0) {
      legs.push({ venue, side, qty: leg.filled, avg: leg.avg || px, feePct });
      remaining -= leg.filled;
    }
  }
  return remaining;
}

async function executeLiveRoute(route: LiveRoute, config: any): Promise<{ ok: boolean; net?: number; error?: string }> {
  const vs = route.venueSymbol;
  const inst = await getInstruments();
  const buyInst = route.buyVenue === "binance" ? inst.binance[vs] : inst.bybit[vs];
  const sellInst = route.sellVenue === "binance" ? inst.binance[vs] : inst.bybit[vs];
  const step = Math.max(buyInst.stepSize, sellInst.stepSize);

  // Both legs at once (IOC). Each returns its real filled quantity.
  const [buy, sell] = await Promise.all([
    placeLeg(route.buyVenue, vs, "BUY", route.qtyStr, route.buyPriceStr, "ARB"),
    placeLeg(route.sellVenue, vs, "SELL", route.qtyStr, route.sellPriceStr, "ARB"),
  ]);

  const legs: Leg[] = [];
  if (buy.ok && buy.filled > 0) legs.push({ venue: route.buyVenue, side: "BUY", qty: buy.filled, avg: buy.avg, feePct: route.buyFeePct });
  if (sell.ok && sell.filled > 0) legs.push({ venue: route.sellVenue, side: "SELL", qty: sell.filled, avg: sell.avg, feePct: route.sellFeePct });

  const buyFilled = buy.ok ? buy.filled : 0;
  const sellFilled = sell.ok ? sell.filled : 0;
  const uncertain = (buy.ok && buy.status === "UNKNOWN") || (sell.ok && sell.status === "UNKNOWN");

  if (buyFilled + sellFilled === 0 && !uncertain) {
    await log("info", `⚪ LIVE ${route.symbol}: neither leg filled (buy ${buy.ok ? buy.status : buy.error}, sell ${sell.ok ? sell.status : sell.error}). No exposure.`);
    return { ok: false, error: "No fill on either leg — no exposure taken" };
  }

  // Close any imbalance immediately so no coins are left unhedged.
  const matched = Math.min(buyFilled, sellFilled);
  const extraBought = buyFilled - matched;   // holding extra coin on the buy venue → sell it back there
  const extraSold = sellFilled - matched;    // sold extra coin on the sell venue → buy it back there
  let naked = 0;
  if (extraBought >= step) naked += await flatten(route.buyVenue, vs, "SELL", extraBought, step, buyInst.tickSize, route.buyFeePct, legs);
  if (extraSold >= step) naked += await flatten(route.sellVenue, vs, "BUY", extraSold, step, sellInst.tickSize, route.sellFeePct, legs);

  const isExposed = naked >= step || uncertain;
  if (isExposed) {
    await haltLive(
      uncertain
        ? `fill status unknown on ${route.symbol} — verify orders on both exchanges`
        : `${naked} ${route.baseAsset} still open on ${route.symbol} after 3 close attempts`,
    );
  }

  // Real P&L: actual fill prices and actual taker fee rates on every fill.
  const cashIn = legs.filter((l) => l.side === "SELL").reduce((s, l) => s + l.qty * l.avg, 0);
  const cashOut = legs.filter((l) => l.side === "BUY").reduce((s, l) => s + l.qty * l.avg, 0);
  const fees = legs.reduce((s, l) => s + l.qty * l.avg * l.feePct / 100, 0);
  const net = cashIn - cashOut - fees;
  const buys = legs.filter((l) => l.side === "BUY");
  const sells = legs.filter((l) => l.side === "SELL");
  const buyQty = buys.reduce((s, l) => s + l.qty, 0);
  const sellQty = sells.reduce((s, l) => s + l.qty, 0);
  const buyAvg = buyQty ? buys.reduce((s, l) => s + l.qty * l.avg, 0) / buyQty : route.buyPrice;
  const sellAvg = sellQty ? sells.reduce((s, l) => s + l.qty * l.avg, 0) / sellQty : route.sellPrice;
  const buyVenueName = route.buyVenue === "binance" ? "Binance" : "Bybit";
  const sellVenueName = route.sellVenue === "binance" ? "Binance" : "Bybit";

  await db.insert(trades).values({
    symbol: route.symbol, buyExchange: buyVenueName, sellExchange: sellVenueName,
    buyPrice: buyAvg, sellPrice: sellAvg, spreadPercent: route.spreadPercent,
    quantity: matched, amountUsd: buyAvg * matched,
    grossProfit: (sellAvg - buyAvg) * matched, fees, netProfit: net,
    status: isExposed ? "exposed" : "completed", strategy: "LIVE-real", source: "live",
    stopLossAmount: config.maxLossPerTradeUsd, stopLossTriggered: false,
  });
  await db.insert(opportunities).values({
    symbol: route.symbol, buyExchange: buyVenueName, sellExchange: sellVenueName,
    buyAsk: buyAvg, sellBid: sellAvg, spreadPercent: route.spreadPercent,
    spreadUsd: sellAvg - buyAvg, estimatedProfit: net, tradeAmountUsd: buyAvg * matched,
    status: "executed", totalCharges: fees, profitChargeRatio: route.profitChargeRatio,
    breakEvenSpreadPercent: route.spreadPercent, riskLevel: "low", qualityScore: 100, skipReason: null,
  });
  await log(
    isExposed ? "warn" : "trade",
    `🔴 LIVE ${route.symbol} ${buyVenueName}→${sellVenueName} • matched ${matched} @ buy ${buyAvg.toFixed(8)} / sell ${sellAvg.toFixed(8)} • fees $${fees.toFixed(4)} • net $${net.toFixed(4)} • orders ${buy.orderId || "-"}/${sell.orderId || "-"}${isExposed ? " • EXPOSED — live halted" : ""}`,
  );
  return { ok: !isExposed, net };
}
