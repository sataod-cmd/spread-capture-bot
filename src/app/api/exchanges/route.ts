import { NextResponse } from "next/server";
import { db } from "../../../db";
import { trades, opportunities } from "../../../db/schema";
import { desc } from "drizzle-orm";
import { ensureConfig } from "../../../lib/bot";
import { getExchangeProfiles } from "../../../lib/market";

export const dynamic = "force-dynamic";

const EXCHANGE_META: Record<string, { site: string; role: string; note: string }> = {
  Binance: { site: "binance.com", role: "Primary hub — buy & sell", note: "Deepest books, fastest repricing (96%), joint-cheapest maker fee. Your main account." },
  Bybit: { site: "bybit.com", role: "Secondary hub — buy & sell", note: "Joint-cheapest maker fee (0.02%) and 93% repricing speed. Ideal second balance." },
  OKX: { site: "okx.com", role: "Fast backup hub", note: "Fast (89%) with a low 0.025% maker fee. Good third account / redundancy if one venue halts." },
  "Gate.io": { site: "gate.io", role: "Wide-spread catcher (small balance)", note: "Slowest repricer (45%) — this lag CREATES the wide spreads on memes. Keep only a small balance here; it is where you sell into stale high bids / buy stale cheap asks." },
  Bitget: { site: "bitget.com", role: "Wide-spread catcher (optional)", note: "Second lag venue (66%) for meme dislocations. Optional until capital grows." },
  KuCoin: { site: "kucoin.com", role: "Alt/meme access (optional)", note: "Lists small pairs early; mid fees and speed. Optional for meme routes." },
  Kraken: { site: "kraken.com", role: "Regulated backup (optional)", note: "Solid and regulated, but slower (61%) and pricier for this strategy. Better as a fiat on-ramp than a main arb venue for $100." },
  Coinbase: { site: "coinbase.com", role: "Fiat on-ramp — NOT a main arb venue at $100", note: "Highest fees here (0.06% maker / 0.12% taker) and slow repricing (56%). On $20 trades its fee can exceed the spread. Useful to buy USDT with a bank card in some countries, then move it — check local availability." },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const config = await ensureConfig();
  const capital = Math.min(1_000_000, Math.max(10, Number(searchParams.get("capital") || config.initialBalanceUsd || 100)));
  const tradeSize = config.tradeAmountUsd;

  const allTrades = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(5000);
  const allOpps = await db.select().from(opportunities).orderBy(desc(opportunities.createdAt)).limit(5000);
  const wideThreshold = config.wideSpreadThreshold || 0.75;

  const profiles = getExchangeProfiles();
  const maxInvolvedPnl = 1;

  const rows = profiles.map((p) => {
    const involved = allTrades.filter(t => t.buyExchange === p.exchange || t.sellExchange === p.exchange);
    const buyTrades = allTrades.filter(t => t.buyExchange === p.exchange);
    const sellTrades = allTrades.filter(t => t.sellExchange === p.exchange);
    const involvedPnl = involved.reduce((s, t) => s + t.netProfit / 2, 0); // attribute half the round-trip to each leg venue
    const involvedOpps = allOpps.filter(o => o.buyExchange === p.exchange || o.sellExchange === p.exchange);
    const wideOpps = involvedOpps.filter(o => o.spreadPercent >= wideThreshold);
    // Score: cheap fees (30) + fast repricing (25) + profitable involvement (25) + wide-spread involvement (20)
    const feeScore = Math.max(0, 30 - p.makerFeePercent * 320);
    const speedScore = p.reactionSpeed * 25;
    const pnlScore = Math.min(25, Math.max(0, involvedPnl) * 60 + involved.length * 0.4);
    const wideScore = Math.min(20, wideOpps.length * 0.9 + involvedOpps.length * 0.08);
    const score = Math.round(Math.min(100, feeScore + speedScore + pnlScore + wideScore));
    const meta = EXCHANGE_META[p.exchange] || { site: "", role: "Venue", note: "" };
    const recommendation =
      p.exchange === "Binance" || p.exchange === "Bybit" ? "⭐ OPEN FIRST"
      : p.exchange === "OKX" ? "Recommended (3rd)"
      : p.exchange === "Gate.io" || p.exchange === "Bitget" ? "Small balance for wide spreads"
      : p.exchange === "Coinbase" ? "On-ramp only at $100"
      : "Optional";
    return {
      ...p, ...meta, score, recommendation,
      stats: {
        involvedTrades: involved.length, buyTrades: buyTrades.length, sellTrades: sellTrades.length,
        attributedPnl: parseFloat(involvedPnl.toFixed(4)),
        involvedOpportunities: involvedOpps.length, wideOpportunities: wideOpps.length,
      },
    };
  }).sort((a, b) => b.score - a.score);

  // ─── Deposit plan, scaled honestly to capital ───
  let planExchanges: { exchange: string; weight: number }[] = [];
  let planNote = "";
  if (capital < 150) {
    planExchanges = [{ exchange: "Binance", weight: 0.55 }, { exchange: "Bybit", weight: 0.45 }];
    planNote = "With under $150, do NOT split across 8 exchanges — each balance would fall below one $20 trade and minimum-order sizes. Two fast, cheap venues only. Gate.io/Bitget stay as price-watch venues ($0 deposited) until capital grows.";
  } else if (capital < 500) {
    planExchanges = [{ exchange: "Binance", weight: 0.4 }, { exchange: "Bybit", weight: 0.35 }, { exchange: "OKX", weight: 0.25 }];
    planNote = "Three venues is the sweet spot at this size: two fast hubs plus a fast backup. Add Gate.io only above $500.";
  } else if (capital < 1500) {
    planExchanges = [{ exchange: "Binance", weight: 0.35 }, { exchange: "Bybit", weight: 0.3 }, { exchange: "OKX", weight: 0.2 }, { exchange: "Gate.io", weight: 0.15 }];
    planNote = "Now a small Gate.io balance pays off: it is the lagging venue in most wide/meme spreads, so you need funds pre-positioned there to sell into its stale bids.";
  } else {
    planExchanges = [{ exchange: "Binance", weight: 0.3 }, { exchange: "Bybit", weight: 0.25 }, { exchange: "OKX", weight: 0.2 }, { exchange: "Gate.io", weight: 0.15 }, { exchange: "Bitget", weight: 0.1 }];
    planNote = "Five venues, weighted to the cheap fast hubs, with small catcher balances on the two lag venues.";
  }
  const depositPlan = planExchanges.map(({ exchange, weight }) => {
    const total = parseFloat((capital * weight).toFixed(2));
    return {
      exchange, percent: Math.round(weight * 100), totalUsd: total,
      usdtForBuys: parseFloat((total * 0.65).toFixed(2)),
      coinInventoryForSells: parseFloat((total * 0.35).toFixed(2)),
      inventoryNote: "Mostly USDT (buy side). The coin-inventory slice should be BTC/ETH only at small capital — pre-holding PEPE/BONK on every venue ties up cash and adds price risk; meme routes stay paper until capital is larger.",
      belowTradeSize: total < tradeSize,
      role: EXCHANGE_META[exchange]?.role,
    };
  });

  const indiaLegal = [
    {
      exchange: "Binance",
      legallyServesIndia: true,
      spotPermitted: true,
      status: "FIU-IND registered reporting entity",
      detail: "Binance announced on 15 Aug 2024 that it registered as a reporting entity with India's Financial Intelligence Unit (FIU-IND) and that its website/app became fully accessible to Indian users. Spot trading for Indian residents is therefore available after full KYC (PAN etc.), under PMLA/AML reporting. This is an AML registration, not SEBI/RBI investment regulation and not government protection of your funds.",
      source: { label: "Binance official announcement (15 Aug 2024)", url: "https://www.binance.com/en-IN/square/post/2024-08-15-binance-achieves-major-regulatory-milestone-with-registration-in-india-12191256221994" },
    },
    {
      exchange: "Bybit",
      legallyServesIndia: true,
      spotPermitted: true,
      status: "FIU-IND registered reporting entity (VDA SP)",
      detail: "Bybit's official press release (8 Sep 2025) states it registered with FIU-IND as a reporting entity under PMLA and restored full access for Indian users, explicitly including Spot among the services offered to Indian customers, with KYC procedures. Same caveat: FIU/PMLA registration is AML compliance, not SEBI/RBI endorsement or deposit insurance.",
      source: { label: "Bybit official press release (8 Sep 2025)", url: "https://www.bybit.com/en/press/post/bybit-resumes-full-access-for-indian-users-reinforces-commitment-to-compliance-and-crypto-inclusion-blt7042bbc940598172" },
    },
  ];
  const twoAccount = {
    works: true,
    verdict: "YES — Binance + Bybit alone WILL work for this bot. It is now set to exactly that (Two-Exchange Mode).",
    how: "Every trade is one of only two routes: Buy Binance → Sell Bybit, or Buy Bybit → Sell Binance — on the Best 6 pairs, with maker/limit pricing and the strict stop-loss. You do not need the other 6 exchanges to run the strategy.",
    conditions: [
      "Both accounts fully KYC-verified for India (PAN) with spot trading enabled — no futures/leverage needed or used",
      "BOTH accounts funded BEFORE trading: USDT for the buy side and a small coin inventory for the sell side (you cannot buy on one and instantly sell on the other without already holding the coin there)",
      "Best 6 pairs (PEPE, BONK, WIF, SHIB, INJ, ARB vs USDT) confirmed listed and tradeable on BOTH accounts, with minimum order ≤ your $20 trade size",
      "API keys (when live) set to spot-trade only, withdrawals OFF, stored only on the server",
      "You accept fewer opportunities: Binance and Bybit are both fast and cheap, so the gap between them is usually smaller than vs slow venues like Gate.io — the bot will trade less often, and that is normal and safer",
    ],
    limitations: [
      "Fewer and usually narrower spreads than the 8-exchange setup — expect quality over quantity",
      "If one of the two venues halts, prices or withdrawals, the bot has no third venue and simply waits (it will not improvise)",
      "Paper results from the earlier 8-exchange period will look better than a live Binance↔Bybit-only reality — judge the new mode by its own forward trades",
    ],
  };

  return NextResponse.json({
    capital, tradeAmountUsd: tradeSize,
    indiaLegal, twoAccount,
    exchanges: rows,
    topPick: rows[0]?.exchange,
    openFirst: ["Binance", "Bybit"],
    depositPlan, planNote,
    realityCheck: [
      `You cannot arbitrage with money on only ONE exchange: the buy and the sell happen in the same second on two venues, so both sides must be pre-funded. Sending coins between exchanges after spotting a spread does NOT work — transfers take minutes and the spread is gone in seconds.`,
      `At $${capital}, exchange minimum orders (~$5–10), deposit/withdrawal network fees and the bot's $${tradeSize} trade size are the binding constraints — not the strategy. That is why the plan uses ${depositPlan.length} venue(s), not 8.`,
      "In this app the bot is paper-trading a simulation. Treat real deposits as a later step: first let the 24×7 tracker collect a few days of period + per-exchange data, and only risk money you can afford to lose.",
    ],
    accountChecklist: [
      "Open + complete KYC on Binance first, then Bybit (official sites only — check the domain carefully; availability and rules depend on your country, and some regions restrict certain platforms/derivatives).",
      "Enable 2FA (authenticator app, not SMS) on every account before depositing anything.",
      "Deposit USDT using the cheapest network BOTH venues support (compare network/withdrawal fees in-app first; avoid expensive networks for $100-sized moves). Send a small test amount first and confirm it arrives.",
      "Create API keys only when you are ready to automate: Spot TRADE permission ON, Withdrawals OFF, IP-whitelist your server if the venue supports it. Never share the secret key.",
      "Turn on maker/limit pricing where possible — in this bot's data, maker fees (0.02%) vs taker (0.05–0.12%) are the difference between profit and a fee-eaten trade.",
      "Keep a simple spreadsheet of balances per venue and rebalance weekly; arbitrage slowly drains one side and piles up the other.",
      "Check your local tax rules for crypto trading and keep trade-history exports from day one.",
    ],
    disclaimer: "Educational information from this bot's simulated data — not financial advice. Exchange fees, availability, KYC and legality vary by country and change often; verify everything on the official exchange site before depositing.",
  });
}
