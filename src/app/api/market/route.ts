import { NextResponse } from "next/server";
import { getMarketSnapshot, ALL_SYMBOLS, ALL_EXCHANGES } from "../../../lib/market";
import { ensureConfig } from "../../../lib/bot";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const config = await ensureConfig();
  const symbols = (config.symbols as string[]) || ALL_SYMBOLS;
  const exchanges = (config.exchanges as string[]) || ALL_EXCHANGES;
  const market = getMarketSnapshot(symbols, exchanges);
  // sort by spread desc
  const sorted = [...market].sort((a,b)=> b.arbitrage.spreadPercent - a.arbitrage.spreadPercent);
  return NextResponse.json({ market: sorted, allSymbols: ALL_SYMBOLS, allExchanges: ALL_EXCHANGES, timestamp: new Date().toISOString(), config });
}
