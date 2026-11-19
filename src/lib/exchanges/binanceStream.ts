import WebSocket from "ws";
import type { Book } from "./types";

/**
 * Persistent Binance public bookTicker stream.
 *
 * Binance explicitly recommends WebSocket streams instead of REST polling to
 * avoid request-weight bans. One multiplexed connection covers all watched
 * symbols and pushes best bid/ask updates without spending REST request weight.
 * REST is only used by the caller as a cold-start/failure fallback.
 */
type StreamState = {
  socket: WebSocket | null;
  connecting: boolean;
  connected: boolean;
  lastMessageAt: number;
  lastError: string | null;
  books: Map<string, Book>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  symbolsKey: string;
};

const g = globalThis as typeof globalThis & { __binanceBookStream?: StreamState };
const STALE_AFTER_MS = 12_000;

function state(): StreamState {
  if (!g.__binanceBookStream) {
    g.__binanceBookStream = {
      socket: null, connecting: false, connected: false, lastMessageAt: 0,
      lastError: null, books: new Map(), reconnectTimer: null, symbolsKey: "",
    };
  }
  return g.__binanceBookStream;
}

function connect(symbols: string[]) {
  const s = state();
  if (s.connecting || s.connected) return;
  const streams = symbols.map((symbol) => `${symbol.toLowerCase()}@bookTicker`).join("/");
  if (!streams) return;
  s.symbolsKey = streams;
  s.connecting = true;
  s.lastError = null;

  const url = `wss://data-stream.binance.vision:443/stream?streams=${streams}`;
  const socket = new WebSocket(url, { handshakeTimeout: 12_000 });
  s.socket = socket;

  socket.on("open", () => {
    s.connected = true;
    s.connecting = false;
    s.lastMessageAt = Date.now();
  });

  socket.on("message", (raw: WebSocket.RawData) => {
    try {
      const payload = JSON.parse(String(raw)) as {
        data?: { s?: string; b?: string; a?: string; B?: string; A?: string };
      };
      const d = payload.data;
      if (!d?.s || !d.b || !d.a) return;
      s.books.set(d.s, {
        bid: Number(d.b), ask: Number(d.a),
        bidQty: Number(d.B || 0), askQty: Number(d.A || 0),
        ts: Date.now(),
      });
      s.lastMessageAt = Date.now();
    } catch { /* ignore malformed market frames */ }
  });

  socket.on("error", (error) => {
    s.lastError = error.message;
  });

  socket.on("close", () => {
    s.connected = false;
    s.connecting = false;
    s.socket = null;
    if (!s.reconnectTimer) {
      s.reconnectTimer = setTimeout(() => {
        s.reconnectTimer = null;
        connect(symbols);
      }, 5000);
      s.reconnectTimer.unref?.();
    }
  });
}

/** Current stream health, safe to expose in diagnostics (contains no secrets). */
export function binanceStreamStatus() {
  const s = state();
  return {
    connected: s.connected,
    connecting: s.connecting,
    symbols: s.books.size,
    lastMessageAt: s.lastMessageAt ? new Date(s.lastMessageAt).toISOString() : null,
    staleForMs: s.lastMessageAt ? Date.now() - s.lastMessageAt : null,
    lastError: s.lastError,
    host: "data-stream.binance.vision",
  };
}

/**
 * Returns fresh streamed books when every requested symbol has updated recently.
 * `missing` tells the caller exactly which symbols still need a REST fallback.
 */
export function getStreamBooks(symbols: string[], staleMs = STALE_AFTER_MS) {
  const s = state();
  connect(symbols);
  const now = Date.now();
  const books: Record<string, Book> = {};
  const missing: string[] = [];
  for (const symbol of symbols) {
    const book = s.books.get(symbol);
    if (book && now - book.ts <= staleMs) books[symbol] = book;
    else missing.push(symbol);
  }
  return { books, missing, fresh: missing.length === 0 };
}
