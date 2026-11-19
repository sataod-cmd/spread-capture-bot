import crypto from "crypto";

export type Venue = "binance" | "bybit";

export type BookLevel = { price: number; qty: number };
export type Book = { bid: number; ask: number; bidQty: number; askQty: number; ts: number };

export type OrderRequest = {
  symbol: string;      // e.g. PEPEUSDT
  side: "BUY" | "SELL";
  qty: string;   // exchange-valid: already rounded down to the lot step, formatted as plain decimal
  price: string; // exchange-valid: already rounded to the price tick, formatted as plain decimal
  timeInForce?: "GTC" | "IOC" | "FOK";
  clientOrderId: string;
};

export type OrderResult = {
  ok: boolean;
  orderId?: string;
  clientOrderId: string;
  status?: string;
  filledQty?: number;
  avgPrice?: number;
  error?: string;
};

export type VenueConnection = {
  venue: Venue;
  name: string;
  configured: boolean;
  authenticated: boolean;
  accountType?: string;
  balances: { asset: string; free: number; locked: number }[];
  totalUsdValue: number;
  makerFeePercent: number;
  takerFeePercent: number;
  feeSource: string;
  symbols: { symbol: string; minQty: number; minNotional: number; stepSize: number; tickSize: number; status: string }[];
  serverTimeOk: boolean;
  clockSkewMs: number;
  errors: string[];
  notes: string[];
};

export function hmac(secret: string, message: string) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

export function newClientOrderId(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 36);
}

export function withTimeout(ms: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(t) };
}
