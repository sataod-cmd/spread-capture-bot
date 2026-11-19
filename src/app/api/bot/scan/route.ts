import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { botConfigs, trades, opportunities, equitySnapshots } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { ensureConfig, log } from "../../../../lib/bot";
import { performScan } from "../../../../lib/scan";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const manual = !!body.manual;
  const result = await performScan({
    source: manual ? "manual" : "browser",
    manual,
    executeAll: !!body.executeAll,
  });
  return NextResponse.json(result);
}

// Manual execute single opportunity
export async function PUT(req: Request) {
  const body = await req.json();
  const { opportunityId } = body;
  const config = await ensureConfig();
  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId)).limit(1);
  if (!opp) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  if (opp.status === "executed") return NextResponse.json({ error: "Already executed" }, { status: 400 });
  // ── Charges guard applies to humans too: never execute a trade whose
  // charges are not comfortably below its expected profit (unless the user
  // explicitly sends force:true after seeing the warning in the UI).
  if (opp.status === "skipped" && !body.force) {
    return NextResponse.json({ error: `Blocked by Risk Engine: ${opp.skipReason || "charges too high vs profit"}`, skipReason: opp.skipReason, profitChargeRatio: opp.profitChargeRatio, totalCharges: opp.totalCharges }, { status: 400 });
  }
  if ((opp.profitChargeRatio || 0) < config.minProfitChargeRatio && opp.totalCharges > 0 && !body.force) {
    return NextResponse.json({ error: `Blocked: profit is only ${(opp.profitChargeRatio || 0).toFixed(2)}× charges (need ≥ ${config.minProfitChargeRatio}×). Charges must not exceed profit.`, profitChargeRatio: opp.profitChargeRatio, totalCharges: opp.totalCharges }, { status: 400 });
  }

  const tradeAmount = Math.min(opp.tradeAmountUsd || config.tradeAmountUsd, config.balanceUsd);
  const qty = tradeAmount / opp.buyAsk;
  const gross = (opp.sellBid - opp.buyAsk) * qty;
  const fees = opp.totalCharges > 0 ? Math.max(0, opp.totalCharges - tradeAmount * (config.slippagePercent / 100)) : (tradeAmount * config.feePercent / 100) + ((opp.sellBid * qty) * config.feePercent / 100);
  const slippage = tradeAmount * (config.slippagePercent / 100);
  let net = gross - fees - slippage;
  net = parseFloat((net * (0.9 + Math.random() * 0.18)).toFixed(4));
  const stopLossAmount = config.strictStopLossEnabled ? parseFloat(Math.min(tradeAmount * ((config.stopLossPercent || 0.5) / 100), config.maxLossPerTradeUsd).toFixed(4)) : config.maxLossPerTradeUsd;
  let stopLossTriggered = false;
  if (net < -stopLossAmount) { net = -stopLossAmount; stopLossTriggered = true; } // STRICT stop — never lose more

  const [trade] = await db.insert(trades).values({
    symbol: opp.symbol, buyExchange: opp.buyExchange, sellExchange: opp.sellExchange,
    buyPrice: opp.buyAsk, sellPrice: opp.sellBid, spreadPercent: opp.spreadPercent,
    quantity: parseFloat(qty.toFixed(8)), amountUsd: tradeAmount,
    grossProfit: parseFloat(gross.toFixed(4)), fees: parseFloat(fees.toFixed(4)), netProfit: net,
    status: "completed", strategy: "manual", source: "manual",
    stopLossAmount, stopLossTriggered,
  }).returning();

  const newBalance = parseFloat((config.balanceUsd + net).toFixed(4));
  await db.update(botConfigs).set({ balanceUsd: newBalance }).where(eq(botConfigs.id, config.id));
  await db.update(opportunities).set({ status: "executed" }).where(eq(opportunities.id, opp.id));
  const allTrades = await db.select().from(trades);
  await db.insert(equitySnapshots).values({ balanceUsd: newBalance, realizedPnl: parseFloat(allTrades.reduce((s, t) => s + t.netProfit, 0).toFixed(4)), tradeCount: allTrades.length });
  await log("trade", `👆 MANUAL EXECUTE ${opp.symbol} • ${opp.buyExchange} → ${opp.sellExchange} • $${tradeAmount} • Spread ${opp.spreadPercent.toFixed(3)}% • P&L ${net >= 0 ? "+" : ""}$${net.toFixed(4)}`);
  return NextResponse.json({ trade, balance: newBalance });
}
