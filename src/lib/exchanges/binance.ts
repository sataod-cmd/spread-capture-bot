import { hmac, type Book, type OrderRequest, type OrderResult, type VenueConnection, withTimeout } from "./types";

// Official Binance market-data host (documented in Binance Spot API FAQ).
// Public books, exchange filters and server time must NOT use the account API.
const PUBLIC_BASE = "https://data-api.binance.vision";
// Authenticated account, commission and order calls still require this host.
const PRIVATE_BASE = "https://api.binance.com";
const PUBLIC_PATHS = new Set([
  "/api/v3/time", "/api/v3/ping", "/api/v3/exchangeInfo",
  "/api/v3/ticker/bookTicker", "/api/v3/ticker/price", "/api/v3/ticker/24hr",
  "/api/v3/depth", "/api/v3/klines", "/api/v3/aggTrades",
  "/api/v3/avgPrice", "/api/v3/trades", "/api/v3/ticker",
]);

/**
 * Binance bans an IP when its request-weight budget is exceeded (the ban
 * message reads "Way too much request weight used; IP banned until ...").
 * A ban is per IP, so one heavy endpoint or a few repeated "Test Connection"
 * clicks takes out every Binance call from the whole server.
 *
 * Two protections, applied to every request:
 *  1. A shared throttle — at most one request per MIN_GAP_MS from this process.
 *  2. A short response cache for read-only calls, so repeated connection tests
 *     and overlapping scans reuse one response instead of spending new weight.
 * Order placement is never cached and never skipped by the cache.
 */
const MIN_GAP_MS = 1100;
const READ_CACHE_MS = 45_000;
let lastRequestAt = 0;
const readCache = new Map<string, { at: number; data: unknown }>();

/** Bans are tracked per hostname: public market data and the account API are separate. */
const bannedUntilByHost = new Map<string, number>();
let lastWeight: { host: string; path: string; usedWeight1m: string | null; at: number } | null = null;

export function binanceBannedForMs(host = PRIVATE_BASE) {
  const bannedUntil = bannedUntilByHost.get(new URL(host).hostname) || 0;
  return Math.max(0, bannedUntil - Date.now());
}
/** Absolute expiry time of an active Binance IP ban (ms epoch), or null. */
export function binanceBanExpiry(host = PRIVATE_BASE): number | null {
  const bannedUntil = bannedUntilByHost.get(new URL(host).hostname) || 0;
  return bannedUntil > Date.now() ? bannedUntil : null;
}
export function binanceRateStats() {
  return lastWeight;
}

async function throttle() {
  const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function parseBanUntil(message: string): number | null {
  // "IP banned until 1794803971999"
  const m = message.match(/banned until (\d{10,})/i);
  return m ? Number(m[1]) : null;
}

export type InstInfo = { minQty: number; stepSize: number; minNotional: number; tickSize: number; status: string };

export function binanceKeys() {
  return {
    key: process.env.BINANCE_API_KEY || "",
    secret: process.env.BINANCE_API_SECRET || "",
  };
}

/**
 * Signed/unsigned request. Signed requests put every parameter (incl. timestamp)
 * in the query string and sign that exact string — Binance requires this for
 * GET, POST and DELETE alike.
 */
async function req(path: string, method: "GET" | "POST" | "DELETE" = "GET", params: Record<string, string | number> = {}, signed = false) {
  const { key, secret } = binanceKeys();
  if (signed && (!key || !secret)) throw new Error("Binance API key/secret not set in server environment");

  // Public market endpoints use Binance's dedicated public host. This avoids
  // burning the account API's request-weight budget and keeps key/order traffic
  // separate from high-frequency market scans.
  const isPublicMarketData = method === "GET" && !signed && PUBLIC_PATHS.has(path);
  const base = isPublicMarketData ? PUBLIC_BASE : PRIVATE_BASE;
  const host = new URL(base).hostname;

  // If Binance has banned this IP on this host, fail fast with a clear message
  // instead of firing more requests and extending the ban window.
  const banned = binanceBannedForMs(base);
  if (banned > 0) {
    const mins = Math.ceil(banned / 60_000);
    throw new Error(`Binance ${host} IP banned for rate-limit abuse — ${mins} more minute(s). No requests will be sent to that host until it expires.`);
  }

  const cacheKey = `${method} ${base}${path} ${JSON.stringify(params)} ${signed ? "s" : "u"}`;
  const cached = readCache.get(cacheKey);
  if (method === "GET" && cached && Date.now() - cached.at < READ_CACHE_MS) {
    return cached.data;
  }

  await throttle();
  const url = new URL(base + path);
  if (signed) {
    const all: Record<string, string | number> = { ...params, recvWindow: 5000, timestamp: Date.now() };
    const qs = Object.entries(all).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    url.search = `${qs}&signature=${hmac(secret, qs)}`;
  } else {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }
  const { signal, done } = withTimeout(15000);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: signed ? { "X-MBX-APIKEY": key } : {},
      signal,
      cache: "no-store",
    });
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { json = { msg: text.slice(0, 200) }; }
    const usedWeight = res.headers.get("x-mbx-used-weight-1m");
    lastWeight = { host, path, usedWeight1m: usedWeight, at: Date.now() };
    if (!res.ok) {
      const msg = String(json?.msg || "");
      const until = parseBanUntil(msg);
      if (until) bannedUntilByHost.set(host, until);
      else if (res.status === 418 || res.status === 429) {
        // Some 418/429 responses omit an expiry. Back off conservatively instead
        // of retrying immediately and extending the restriction.
        bannedUntilByHost.set(host, Math.max(bannedUntilByHost.get(host) || 0, Date.now() + 60_000));
      }

      const hint = until || res.status === 418 || res.status === 429
        ? ` — IP banned/rate limited on ${host}${until ? ` until ${new Date(until).toISOString()}` : " for 60s"}. This is not an API-key, region or allowlist problem. Used weight (1m): ${usedWeight || "not reported"}.`
        : res.status === 451 || res.status === 403
          ? " — blocked for this server's region. Binance does not serve US-hosted servers; deploy in Singapore, Frankfurt or London."
          : "";
      throw new Error(`Binance ${host} HTTP ${res.status}${hint}${msg && !hint ? `: ${msg}` : ""}`);
    }

    if (method === "GET") readCache.set(cacheKey, { at: Date.now(), data: json });
    return json;
  } finally { done(); }
}

export async function binanceServerTime() {
  const t = await req("/api/v3/time");
  return { serverTime: Number(t.serverTime), localTime: Date.now() };
}

export async function binanceBook(symbol: string): Promise<Book> {
  const b = await req("/api/v3/ticker/bookTicker", "GET", { symbol });
  return {
    bid: Number(b.bidPrice), ask: Number(b.askPrice),
    bidQty: Number(b.bidQty), askQty: Number(b.askQty),
    ts: Date.now(),
  };
}

/**
 * Batch all book tickers in ONE request instead of 6 separate ones.
 * Binance charges weight per REQUEST (bookTicker weight 2 per symbol),
 * so 6 symbols in one call costs ~12 vs 6 separate calls = 12 — but the
 * real saving is fewer request slots, fewer connections, and no burst that
 * tips the per-second rate budget and gets the IP banned.
 */
export async function binanceBooksBatch(symbols: string[]): Promise<Record<string, Book>> {
  const list = await req("/api/v3/ticker/bookTicker", "GET", { symbols: JSON.stringify(symbols) });
  const out: Record<string, Book> = {};
  for (const b of list || []) {
    out[b.symbol] = {
      bid: Number(b.bidPrice), ask: Number(b.askPrice),
      bidQty: Number(b.bidQty), askQty: Number(b.askQty),
      ts: Date.now(),
    };
  }
  return out;
}

/** Real exchange filters: lot step/min, notional minimum, price tick. */
export async function binanceExchangeInfo(symbols: string[]): Promise<Record<string, InstInfo>> {
  const info = await req("/api/v3/exchangeInfo", "GET", { symbols: JSON.stringify(symbols) });
  const map: Record<string, InstInfo> = {};
  for (const s of info.symbols || []) {
    const filters: any[] = s.filters || [];
    const lot = filters.find((f) => f.filterType === "LOT_SIZE");
    const notional = filters.find((f) => f.filterType === "NOTIONAL") || filters.find((f) => f.filterType === "MIN_NOTIONAL");
    const px = filters.find((f) => f.filterType === "PRICE_FILTER");
    map[s.symbol] = {
      minQty: Number(lot?.minQty || 0),
      stepSize: Number(lot?.stepSize || 0),
      minNotional: Number(notional?.minNotional || 0),
      tickSize: Number(px?.tickSize || 0),
      status: String(s.status || ""),
    };
  }
  return map;
}

export async function binanceAccount() {
  const acc = await req("/api/v3/account", "GET", {}, true);
  return {
    canTrade: !!acc.canTrade,
    accountType: acc.accountType as string,
    balances: ((acc.balances || []) as any[]).map((b) => ({ asset: String(b.asset), free: Number(b.free), locked: Number(b.locked) })),
  };
}

/**
 * Account commission for a symbol. Binance returns decimals ("0.001" = 0.10%).
 * Standard (VIP 0) rate is used unless the account has a token discount — we
 * deliberately do NOT assume the BNB discount, so fees are never understated.
 */
export async function binanceCommission(symbol: string) {
  const c = await req("/api/v3/account/commission", "GET", { symbol }, true);
  const maker = Number(c?.standardCommission?.maker);
  const taker = Number(c?.standardCommission?.taker);
  if (!Number.isFinite(maker) || !Number.isFinite(taker)) throw new Error("Binance commission response missing standardCommission");
  return {
    makerPercent: maker * 100,
    takerPercent: taker * 100,
    discountPercent: 0,
    source: `Binance account commission for ${symbol} (standard rate, no BNB discount assumed)`,
  };
}

export async function binancePlaceOrder(o: OrderRequest): Promise<OrderResult> {
  try {
    const r = await req("/api/v3/order", "POST", {
      symbol: o.symbol, side: o.side, type: "LIMIT",
      timeInForce: o.timeInForce || "GTC", quantity: o.qty, price: o.price,
      newClientOrderId: o.clientOrderId, newOrderRespType: "RESULT",
    }, true);
    const executed = Number(r.executedQty || 0);
    const quote = Number(r.cummulativeQuoteQty || 0);
    return {
      ok: true, orderId: String(r.orderId), clientOrderId: r.clientOrderId,
      status: r.status, filledQty: executed,
      avgPrice: executed > 0 ? quote / executed : 0,
    };
  } catch (e: any) {
    return { ok: false, clientOrderId: o.clientOrderId, error: e?.message || String(e) };
  }
}

export async function binanceGetOrder(symbol: string, orderId: string, clientOrderId: string) {
  try {
    const r = await req("/api/v3/order", "GET", { symbol, origClientOrderId: clientOrderId, orderId }, true);
    const executed = Number(r.executedQty || 0);
    const quote = Number(r.cummulativeQuoteQty || 0);
    return { status: String(r.status), filledQty: executed, avgPrice: executed > 0 ? quote / executed : Number(r.price || 0) };
  } catch (e: any) {
    return { status: "UNKNOWN", filledQty: 0, avgPrice: 0, error: e?.message };
  }
}

export async function binanceCancelOrder(symbol: string, orderId: string, clientOrderId: string) {
  try {
    const r = await req("/api/v3/order", "DELETE", { symbol, origClientOrderId: clientOrderId, orderId }, true);
    return { ok: true, status: r.status };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

export async function binanceConnection(symbols: string[]): Promise<VenueConnection> {
  const errors: string[] = [], notes: string[] = [];
  const { key, secret } = binanceKeys();
  const configured = !!(key && secret);
  const conn: VenueConnection = {
    venue: "binance", name: "Binance", configured, authenticated: false,
    balances: [], totalUsdValue: 0, makerFeePercent: 0, takerFeePercent: 0,
    feeSource: "not read yet", symbols: [], serverTimeOk: false, clockSkewMs: 0, errors, notes,
  };
  if (!configured) { errors.push("BINANCE_API_KEY / BINANCE_API_SECRET not set in the server environment"); return conn; }

  try {
    const t = await binanceServerTime();
    conn.clockSkewMs = t.localTime - t.serverTime;
    conn.serverTimeOk = Math.abs(conn.clockSkewMs) < 5000;
    if (!conn.serverTimeOk) notes.push(`Clock skew ${conn.clockSkewMs}ms — usually fine, but check your system clock`);
  } catch (e: any) { errors.push(`Server time failed: ${e?.message}`); }

  try {
    const info = await binanceExchangeInfo(symbols);
    conn.symbols = Object.entries(info).map(([symbol, v]) => ({ symbol, ...v }));
    const missing = symbols.filter(s => !info[s] || info[s].status !== "TRADING");
    if (missing.length) notes.push(`Not trading on Binance spot: ${missing.join(", ")}`);
  } catch (e: any) { errors.push(`Exchange info failed: ${e?.message}`); }

  try {
    const acc = await binanceAccount();
    conn.authenticated = true;
    conn.accountType = acc.accountType;
    if (!acc.canTrade) { errors.push("Key has no SPOT trading permission"); notes.push("Enable 'Enable Spot & Margin Trading' for this key"); }
    conn.balances = acc.balances.filter(b => b.free + b.locked > 0);
    conn.totalUsdValue = acc.balances.find(b => b.asset === "USDT")?.free ?? 0;
  } catch (e: any) {
    errors.push(`Auth failed: ${e?.message}`);
    if (/signature|invalid|apikey|-2015|401/i.test(String(e?.message))) notes.push("Check the API key/secret pair — they must be from the SAME Binance account");
    return conn;
  }

  try {
    const first = conn.symbols.find(s => s.status === "TRADING")?.symbol || symbols[0];
    const c = await binanceCommission(first);
    conn.makerFeePercent = c.makerPercent;
    conn.takerFeePercent = c.takerPercent;
    conn.feeSource = c.source;
    if (c.takerPercent >= 0.1) notes.push("Standard spot fee. Enable 'pay fees with BNB' to lower it (the bot still prices fees at the standard rate until then)");
  } catch (e: any) {
    errors.push(`Commission lookup failed: ${e?.message}`);
  }

  return conn;
}
