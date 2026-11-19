import { NextResponse } from "next/server";
import { db } from "../../../db";
import { volatilityAnalyses } from "../../../db/schema";
import { desc } from "drizzle-orm";
import { ensureConfig, log } from "../../../lib/bot";
import { analyzePairs } from "../../../lib/analysis";
import { injectFastMove } from "../../../lib/market";

export const dynamic = "force-dynamic";

function cfgFrom(config: Awaited<ReturnType<typeof ensureConfig>>) {
  return {
    tradeAmountUsd: config.tradeAmountUsd,
    lowFeeRouting: config.lowFeeRouting,
    slippagePercent: config.slippagePercent,
    minProfitChargeRatio: config.minProfitChargeRatio,
    minProfitUsd: config.minProfitUsd,
    spreadThreshold: config.spreadThreshold,
  };
}

async function build(direction: "up" | "down" | "both", magnitudePercent: number) {
  const config = await ensureConfig();
  const symbols = (config.symbols as string[]) || [];
  const exchanges = (config.exchanges as string[]) || [];
  const result = analyzePairs({ symbols, exchanges, direction, magnitudePercent, cfg: cfgFrom(config) });
  const bestUp = result.up[0];
  const bestDown = result.down[0];
  const overallBest = direction === "down" ? bestDown : bestUp;
  return {
    direction, magnitudePercent,
    tradeAmountUsd: config.tradeAmountUsd,
    config: { wideSpreadThreshold: config.wideSpreadThreshold, spreadThreshold: config.spreadThreshold, minProfitChargeRatio: config.minProfitChargeRatio, lowFeeRouting: config.lowFeeRouting },
    pairs: result.pairs, up: result.up, down: result.down,
    summary: {
      mostVolatile: [...result.pairs].sort((a, b) => b.realisedVolPercent - a.realisedVolPercent)[0]?.symbol,
      widestCurrentSpread: [...result.pairs].sort((a, b) => b.currentSpreadPercent - a.currentSpreadPercent)[0]?.symbol,
      bestImmediateProfitUp: bestUp ? { symbol: bestUp.symbol, netProfit: bestUp.scenario.netProfit, spreadPercent: bestUp.scenario.spreadPercent, route: `${bestUp.scenario.buyExchange}→${bestUp.scenario.sellExchange}`, windowSeconds: bestUp.scenario.profitWindowSeconds, passesRiskGuard: bestUp.scenario.passesRiskGuard } : null,
      bestImmediateProfitDown: bestDown ? { symbol: bestDown.symbol, netProfit: bestDown.scenario.netProfit, spreadPercent: bestDown.scenario.spreadPercent, route: `${bestDown.scenario.buyExchange}→${bestDown.scenario.sellExchange}`, windowSeconds: bestDown.scenario.profitWindowSeconds, passesRiskGuard: bestDown.scenario.passesRiskGuard } : null,
      overallBestSymbol: overallBest?.symbol,
      lesson: "Fast moves pay the pairs with thin books + slow exchanges (memes/volatile on Gate.io, Bitget, KuCoin). Direction does not matter — the bot just flips the route: pump = buy the lagging venue, crash = sell the lagging venue.",
    },
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const direction = (["up", "down", "both"].includes(searchParams.get("direction") || "") ? searchParams.get("direction") : "both") as "up" | "down" | "both";
  const magnitudePercent = Math.min(10, Math.max(0.5, Number(searchParams.get("magnitude") || 2)));
  const analysis = await build(direction, magnitudePercent);
  const runs = await db.select().from(volatilityAnalyses).orderBy(desc(volatilityAnalyses.createdAt)).limit(8);
  return NextResponse.json({ ...analysis, savedRuns: runs });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const config = await ensureConfig();

  if (body.action === "inject") {
    // Genuine live stress test on the paper market — the 24×7 worker should capture it
    const symbol = String(body.symbol || "PEPE/USDT");
    const direction = body.direction === "down" ? "down" : "up";
    const magnitudePercent = Math.min(10, Math.max(0.5, Number(body.magnitudePercent || 3)));
    const result = injectFastMove(symbol, direction, magnitudePercent);
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    await log(direction === "up" ? "warn" : "warn", `🚀 STRESS TEST INJECTED — ${result.message} • Bot running: ${config.isRunning && config.run24x7 ? "YES, watch for a server trade" : "NO — start 24×7 or run Scan+Execute"}`);
    return NextResponse.json({ ...result, botRunning24x7: config.isRunning && config.run24x7, hint: "Now watch Recent Trades / Opportunity Feed — the server worker scans every few seconds and should capture the lagging-exchange spread if it passes the charges guard." });
  }

  // Default: run + save an analysis
  const direction = (["up", "down", "both"].includes(body.direction) ? body.direction : "both") as "up" | "down" | "both";
  const magnitudePercent = Math.min(10, Math.max(0.5, Number(body.magnitudePercent || 2)));
  const analysis = await build(direction, magnitudePercent);
  const best = direction === "down" ? analysis.down[0] : analysis.up[0];
  const [saved] = await db.insert(volatilityAnalyses).values({
    direction, magnitudePercent,
    bestSymbol: best?.symbol || null,
    bestRoute: best ? `${best.scenario.buyExchange}→${best.scenario.sellExchange}` : null,
    bestSpreadPercent: best?.scenario.spreadPercent || 0,
    bestNetProfit: best?.scenario.netProfit || 0,
    tradeAmountUsd: config.tradeAmountUsd,
    results: analysis.pairs.map(p => ({ symbol: p.symbol, category: p.category, score: p.volatilityProfitScore, realisedVolPercent: p.realisedVolPercent, currentSpreadPercent: p.currentSpreadPercent, scenarioSpreadPercent: p.scenario.spreadPercent, scenarioNetProfit: p.scenario.netProfit, route: `${p.scenario.buyExchange}→${p.scenario.sellExchange}` })),
  }).returning();
  await log("info", `📊 Volatility analysis (${direction} ${magnitudePercent}%) • Best immediate-profit pair: ${best?.symbol} — $${best?.scenario.netProfit} net on a ${best?.scenario.spreadPercent}% shock-spread (${best?.scenario.buyExchange}→${best?.scenario.sellExchange})`);
  const runs = await db.select().from(volatilityAnalyses).orderBy(desc(volatilityAnalyses.createdAt)).limit(8);
  return NextResponse.json({ ...analysis, savedRun: saved, savedRuns: runs });
}
