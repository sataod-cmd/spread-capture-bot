import { hmac, type Book, type OrderRequest, type OrderResult, type VenueConnection, withTimeout } from "./types";
import type { InstInfo } from "./binance";

const BASE = "https://api.bybit.com";
const V5 = "/v5";

export function bybitKeys() {
  return {
    key: process.env.BYBIT_API_KEY || "",
    secret: process.env.BYBIT_API_SECRET || "",
  };
}

/**
 * Bybit V5 signing rule:
 *   GET   → sign  timestamp + apiKey + recvWindow + <query string>
 *   POST  → sign  timestamp + apiKey + recvWindow + <the exact JSON body sent>
 * The body we sign MUST be the body we send — signing a query string while
 * sending JSON makes every order fail with an invalid-signature error.
 */
async function req(path: string, method: "GET" | "POST" = "GET", params: Record<string, string | number> = {}, signed = false) {
  const { key, secret } = bybitKeys();
  if (signed && (!key || !secret)) throw new Error("Bybit API key/secret not set in server environment");
  const url = new URL(BASE + path);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const bodyStr = method === "POST" ? JSON.stringify(params) : "";

  if (signed) {
    const ts = Date.now().toString();
    const recvWindow = "5000";
    const payload = method === "POST"
      ? bodyStr
      : new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    headers["X-BAPI-API-KEY"] = key;
    headers["X-BAPI-SIGN"] = hmac(secret, ts + key + recvWindow + payload);
    headers["X-BAPI-TIMESTAMP"] = ts;
    headers["X-BAPI-RECV-WINDOW"] = recvWindow;
    if (method === "GET") url.search = payload;
  } else if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }

  const { signal, done } = withTimeout(15000);
  try {
    const res = await fetch(url.toString(), {
      method, headers, signal, cache: "no-store",
      body: method === "POST" ? bodyStr : undefined,
    });
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { json = { retMsg: text.slice(0, 200) }; }
    if (json?.retCode !== undefined && json.retCode !== 0) throw new Error(`${json.retMsg} (code ${json.retCode})`);
    if (!res.ok) {
      const hint = res.status === 403 || res.status === 451
        ? " — blocked for this server's region. Bybit does not serve US-hosted servers; deploy in Singapore, Frankfurt or London."
        : res.status === 429
          ? " — rate limited, retry shortly"
          : "";
      throw new Error(`Bybit HTTP ${res.status}${hint}`);
    }
    return json;
  } finally { done(); }
}

export async function bybitServerTime() {
  const r = await req(V5 + "/market/time");
  // Bybit wraps the payload: { retCode, retMsg, result: { timeSecond, timeNano } }.
  // IMPORTANT: timeNano is the COMPLETE epoch timestamp in nanoseconds, not a
  // fractional part of timeSecond. Use it alone; adding both counts time twice.
  const res = r.result || {};
  const nano = Number(res.timeNano);
  const sec = Number(res.timeSecond);
  const serverTime = Number.isFinite(nano) && nano > 0
    ? nano / 1_000_000
    : Number.isFinite(sec) && sec > 0
      ? sec * 1000
      : 0;
  return { serverTime, localTime: Date.now() };
}

export async function bybitBook(symbol: string): Promise<Book> {
  const r = await req(V5 + "/market/orderbook", "GET", { category: "spot", symbol, limit: 5 });
  const b = r.result?.[0];
  return {
    bid: Number(b?.b?.[0]?.[0] ?? 0), ask: Number(b?.a?.[0]?.[0] ?? 0),
    bidQty: Number(b?.b?.[0]?.[1] ?? 0), askQty: Number(b?.a?.[0]?.[1] ?? 0),
    ts: Date.now(),
  };
}

/**
 * Batch Bybit order books in one call. Bybit's /v5/market/orderbook accepts a
 * single symbol per request, so we parallelise but cap concurrency at 3 to
 * avoid a burst of 6 simultaneous requests that trips the per-IP rate limit.
 */
export async function bybitBooksBatch(symbols: string[]): Promise<Record<string, Book>> {
  const out: Record<string, Book> = {};
  for (let i = 0; i < symbols.length; i += 3) {
    const chunk = symbols.slice(i, i + 3);
    const results = await Promise.allSettled(chunk.map((s) => bybitBook(s)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") out[chunk[j]] = r.value;
    });
  }
  return out;
}

/** Real spot filters from V5 instruments-info: basePrecision (step), minOrderAmt, tickSize. */
export async function bybitInstruments(symbols: string[]): Promise<Record<string, InstInfo>> {
  const r = await req(V5 + "/market/instruments-info", "GET", { category: "spot" });
  const wanted = new Set(symbols);
  const map: Record<string, InstInfo> = {};
  for (const s of r.result?.list || []) {
    if (!wanted.has(s.symbol)) continue;
    const lot = s.lotSizeFilter || {};
    map[s.symbol] = {
      minQty: Number(lot.minOrderQty || 0),
      stepSize: Number(lot.basePrecision || 0),
      minNotional: Number(lot.minOrderAmt || 0),
      tickSize: Number(s.priceFilter?.tickSize || 0),
      status: String(s.status || ""),
    };
  }
  return map;
}

export async function bybitAccount() {
  const r = await req(V5 + "/account/wallet-balance", "GET", { accountType: "UNIFIED" }, true);
  const coins: any[] = r.result?.list?.[0]?.coin || [];
  const balances = coins.map((c) => {
    const total = Number(c.walletBalance || 0);
    const locked = Number(c.locked || 0);
    return { asset: String(c.coin), free: Math.max(0, total - locked), locked };
  });
  const usdt = balances.find((b) => b.asset === "USDT");
  return {
    accountType: "UNIFIED",
    totalUsdValue: usdt?.free ?? 0,
    balances: balances.filter((b) => b.free + b.locked > 0),
  };
}

/** Account fee rate for a symbol (decimals: 0.001 = 0.10%). */
export async function bybitFeeRate(symbol: string) {
  const r = await req(V5 + "/account/fee-rate", "GET", { category: "spot", symbol }, true);
  const f = r.result?.list?.[0];
  const maker = Number(f?.makerFeeRate);
  const taker = Number(f?.takerFeeRate);
  if (!Number.isFinite(maker) || !Number.isFinite(taker)) throw new Error("Bybit fee-rate response missing makerFeeRate/takerFeeRate");
  return {
    makerPercent: maker * 100,
    takerPercent: taker * 100,
    source: `Bybit account fee-rate for ${symbol}`,
  };
}

export async function bybitPlaceOrder(o: OrderRequest): Promise<OrderResult> {
  try {
    const r = await req(V5 + "/order/create", "POST", {
      category: "spot", symbol: o.symbol, side: o.side === "BUY" ? "Buy" : "Sell",
      orderType: "Limit", qty: o.qty, price: o.price,
      timeInForce: o.timeInForce || "GTC", orderLinkId: o.clientOrderId,
    }, true);
    return { ok: true, orderId: String(r.result?.orderId || ""), clientOrderId: o.clientOrderId };
  } catch (e: any) {
    return { ok: false, clientOrderId: o.clientOrderId, error: e?.message || String(e) };
  }
}

export async function bybitGetOrder(symbol: string, orderId: string, clientOrderId: string) {
  try {
    const r = await req(V5 + "/order/realtime", "GET", { category: "spot", symbol, orderId, orderLinkId: clientOrderId }, true);
    const o = r.result?.list?.[0];
    if (!o) return { status: "UNKNOWN", filledQty: 0, avgPrice: 0 };
    return {
      status: String(o.orderStatus || "UNKNOWN"),
      filledQty: Number(o.cumExecQty || 0),
      avgPrice: Number(o.avgPrice || 0),
    };
  } catch (e: any) {
    return { status: "UNKNOWN", filledQty: 0, avgPrice: 0, error: e?.message };
  }
}

export async function bybitCancelOrder(symbol: string, orderId: string, clientOrderId: string) {
  try {
    await req(V5 + "/order/cancel", "POST", { category: "spot", symbol, orderId, orderLinkId: clientOrderId }, true);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

export async function bybitConnection(symbols: string[]): Promise<VenueConnection> {
  const errors: string[] = [], notes: string[] = [];
  const { key, secret } = bybitKeys();
  const configured = !!(key && secret);
  const conn: VenueConnection = {
    venue: "bybit", name: "Bybit", configured, authenticated: false,
    balances: [], totalUsdValue: 0, makerFeePercent: 0, takerFeePercent: 0,
    feeSource: "not read yet", symbols: [], serverTimeOk: false, clockSkewMs: 0, errors, notes,
  };
  if (!configured) { errors.push("BYBIT_API_KEY / BYBIT_API_SECRET not set in the server environment"); return conn; }

  try {
    const t = await bybitServerTime();
    if (t.serverTime > 0) {
      conn.clockSkewMs = Math.round(t.localTime - t.serverTime);
      conn.serverTimeOk = Math.abs(conn.clockSkewMs) < 5000;
      if (!conn.serverTimeOk) notes.push(`Clock skew ${conn.clockSkewMs}ms`);
    } else {
      conn.serverTimeOk = false;
      notes.push("Bybit server time unavailable — clock skew could not be calculated");
    }
  } catch (e: any) { errors.push(`Server time failed: ${e?.message}`); }

  try {
    const info = await bybitInstruments(symbols);
    conn.symbols = Object.entries(info).map(([symbol, v]) => ({ symbol, ...v }));
    const missing = symbols.filter(s => !info[s] || info[s].status !== "Trading");
    if (missing.length) notes.push(`Not trading on Bybit spot: ${missing.join(", ")}`);
  } catch (e: any) { errors.push(`Instruments failed: ${e?.message}`); }

  try {
    const acc = await bybitAccount();
    conn.authenticated = true;
    conn.accountType = acc.accountType;
    conn.balances = acc.balances;
    conn.totalUsdValue = acc.totalUsdValue;
    if (acc.totalUsdValue <= 0) notes.push("No USDT balance — deposit funds on this account before trading");
  } catch (e: any) {
    errors.push(`Auth failed: ${e?.message}`);
    if (/10003|10004|invalid|unauthorized|401/i.test(String(e?.message))) notes.push("Check the API key/secret pair and that the key has spot/unified permission");
    return conn;
  }

  try {
    const first = conn.symbols.find(s => s.status === "Trading")?.symbol || symbols[0];
    const f = await bybitFeeRate(first);
    conn.makerFeePercent = f.makerPercent;
    conn.takerFeePercent = f.takerPercent;
    conn.feeSource = f.source;
  } catch (e: any) {
    errors.push(`Fee-rate lookup failed: ${e?.message}`);
  }

  return conn;
}
