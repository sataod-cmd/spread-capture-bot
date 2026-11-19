import { NextResponse } from "next/server";
import { db } from "../../../db";
import { trades, opportunities, timePeriodStats } from "../../../db/schema";
import { desc } from "drizzle-orm";
import { ensureConfig, log } from "../../../lib/bot";
import { SESSIONS, sessionForHour } from "../../../lib/time";
import { VOLATILE_SYMBOLS } from "../../../lib/market";
import { buildDailySummaries, saveDailyReport, getDailyReports, utcDateKey } from "../../../lib/daily";

export const dynamic = "force-dynamic";

type Agg = {
  key: string; label: string; trades: number; wins: number; netProfit: number; grossProfit: number; fees: number;
  volume: number; spreadSum: number; opportunities: number; wideOpportunities: number; oppSpreadSum: number;
  symbols: Record<string, { trades: number; net: number }>;
};
function emptyAgg(key: string, label: string): Agg {
  return { key, label, trades: 0, wins: 0, netProfit: 0, grossProfit: 0, fees: 0, volume: 0, spreadSum: 0, opportunities: 0, wideOpportunities: 0, oppSpreadSum: 0, symbols: {} };
}
function finish(a: Agg, wideThreshold: number) {
  const charges = a.fees; // exchange fees (slippage excluded here, shown elsewhere)
  return {
    ...a,
    netProfit: parseFloat(a.netProfit.toFixed(4)), grossProfit: parseFloat(a.grossProfit.toFixed(4)), fees: parseFloat(a.fees.toFixed(4)),
    winRate: a.trades ? parseFloat(((a.wins / a.trades) * 100).toFixed(1)) : 0,
    avgSpreadPercent: a.trades ? parseFloat((a.spreadSum / a.trades).toFixed(4)) : 0,
    avgOppSpreadPercent: a.opportunities ? parseFloat((a.oppSpreadSum / a.opportunities).toFixed(4)) : 0,
    avgNetPerTrade: a.trades ? parseFloat((a.netProfit / a.trades).toFixed(4)) : 0,
    feesOfGrossPercent: a.grossProfit > 0 ? parseFloat(((charges / a.grossProfit) * 100).toFixed(1)) : 0,
    wideFrequencyPercent: a.opportunities ? parseFloat(((a.wideOpportunities / a.opportunities) * 100).toFixed(1)) : 0,
    topSymbols: Object.entries(a.symbols).map(([symbol, v]) => ({ symbol, ...v })).sort((x, y) => y.net - x.net).slice(0, 3),
    volatileSharePercent: a.trades ? parseFloat(((Object.entries(a.symbols).filter(([s]) => VOLATILE_SYMBOLS.includes(s)).reduce((sum, [, v]) => sum + v.trades, 0) / a.trades) * 100).toFixed(1)) : 0,
  };
}

export async function GET() {
  const config = await ensureConfig();
  const wideThreshold = config.wideSpreadThreshold || 0.75;
  const allTrades = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(5000);
  const allOpps = await db.select().from(opportunities).orderBy(desc(opportunities.createdAt)).limit(5000);
  const tracked = await db.select().from(timePeriodStats).orderBy(desc(timePeriodStats.bucketStart)).limit(72);

  const byHourMap = new Map<string, Agg>();
  for (let h = 0; h < 24; h++) byHourMap.set(String(h), emptyAgg(String(h), `${String(h).padStart(2, "0")}:00 UTC`));
  const bySessionMap = new Map<string, Agg>();
  for (const s of SESSIONS) bySessionMap.set(s.key, emptyAgg(s.key, s.label));
  const byBlockMap = new Map<string, Agg>();
  for (let b = 0; b < 6; b++) byBlockMap.set(String(b), emptyAgg(String(b), `${String(b * 4).padStart(2, "0")}:00–${String(b * 4 + 4).padStart(2, "0")}:00 UTC`));
  const byDayMap = new Map<string, Agg>();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let d = 0; d < 7; d++) byDayMap.set(String(d), emptyAgg(String(d), dayNames[d]));

  const addTrade = (t: typeof trades.$inferSelect) => {
    const d = new Date(t.executedAt);
    const h = d.getUTCHours();
    const targets = [byHourMap.get(String(h))!, bySessionMap.get(sessionForHour(h).key)!, byBlockMap.get(String(Math.floor(h / 4)))!, byDayMap.get(String(d.getUTCDay()))!];
    for (const a of targets) {
      a.trades++; if (t.netProfit > 0) a.wins++;
      a.netProfit += t.netProfit; a.grossProfit += t.grossProfit; a.fees += t.fees; a.volume += t.amountUsd; a.spreadSum += t.spreadPercent;
      if (!a.symbols[t.symbol]) a.symbols[t.symbol] = { trades: 0, net: 0 };
      a.symbols[t.symbol].trades++; a.symbols[t.symbol].net += t.netProfit;
    }
  };
  allTrades.forEach(addTrade);
  for (const o of allOpps) {
    const d = new Date(o.createdAt);
    const h = d.getUTCHours();
    const targets = [byHourMap.get(String(h))!, bySessionMap.get(sessionForHour(h).key)!, byBlockMap.get(String(Math.floor(h / 4)))!, byDayMap.get(String(d.getUTCDay()))!];
    for (const a of targets) {
      a.opportunities++; a.oppSpreadSum += o.spreadPercent;
      if (o.spreadPercent >= wideThreshold) a.wideOpportunities++;
    }
  }

  const byHour = [...byHourMap.values()].map(a => finish(a, wideThreshold));
  const bySessionRaw = [...bySessionMap.values()].map(a => finish(a, wideThreshold));
  const bySession = bySessionRaw.map(s => ({ ...s, ...(SESSIONS.find(x => x.key === s.key) || {}) }));
  const byBlock = [...byBlockMap.values()].map(a => finish(a, wideThreshold));
  const byDay = [...byDayMap.values()].map(a => finish(a, wideThreshold));

  const overall = finish(allTrades.reduce((acc, t) => {
    acc.trades++; if (t.netProfit > 0) acc.wins++;
    acc.netProfit += t.netProfit; acc.grossProfit += t.grossProfit; acc.fees += t.fees; acc.volume += t.amountUsd; acc.spreadSum += t.spreadPercent;
    if (!acc.symbols[t.symbol]) acc.symbols[t.symbol] = { trades: 0, net: 0 };
    acc.symbols[t.symbol].trades++; acc.symbols[t.symbol].net += t.netProfit;
    return acc;
  }, emptyAgg("all", "All time")), wideThreshold);
  overall.opportunities = allOpps.length;
  overall.wideOpportunities = allOpps.filter(o => o.spreadPercent >= wideThreshold).length;
  overall.avgOppSpreadPercent = allOpps.length ? parseFloat((allOpps.reduce((s, o) => s + o.spreadPercent, 0) / allOpps.length).toFixed(4)) : 0;

  const withTrades = (arr: ReturnType<typeof finish>[]) => arr.filter(x => x.trades >= 1);
  const bestHour = [...withTrades(byHour)].sort((a, b) => b.netProfit - a.netProfit)[0] || null;
  const worstHour = [...withTrades(byHour)].sort((a, b) => a.netProfit - b.netProfit)[0] || null;
  const bestSession = [...withTrades(bySession)].sort((a, b) => b.netProfit - a.netProfit)[0] || null;
  const worstSession = [...withTrades(bySession)].sort((a, b) => a.netProfit - b.netProfit)[0] || null;
  const bestBlock = [...withTrades(byBlock)].sort((a, b) => b.netProfit - a.netProfit)[0] || null;
  const bestDay = [...withTrades(byDay)].sort((a, b) => b.netProfit - a.netProfit)[0] || null;

  const now = new Date();
  const currentHour = byHour[now.getUTCHours()];
  const currentSessionDef = sessionForHour(now.getUTCHours());
  const currentSession = bySession.find(s => s.key === currentSessionDef.key);
  // Next occurrence of the best hour
  let nextBestInHours: number | null = null;
  if (bestHour) {
    const bh = Number(bestHour.key);
    nextBestInHours = (bh - now.getUTCHours() + 24) % 24;
  }

  // ── WHY is the best period best? (data-driven, not generic) ──
  const why: string[] = [];
  const best = bestSession || bestHour;
  if (best && overall.trades > 0) {
    if (best.avgSpreadPercent > overall.avgSpreadPercent && overall.avgSpreadPercent > 0)
      why.push(`Wider spreads captured: ${best.label} averages ${best.avgSpreadPercent.toFixed(3)}% per trade vs ${overall.avgSpreadPercent.toFixed(3)}% overall (+${(((best.avgSpreadPercent - overall.avgSpreadPercent) / overall.avgSpreadPercent) * 100).toFixed(0)}%) — with %-fees fixed, a wider spread means charges shrink as a share of profit.`);
    if (best.feesOfGrossPercent < overall.feesOfGrossPercent)
      why.push(`Charges bite less: fees are only ${best.feesOfGrossPercent}% of gross profit in ${best.label} vs ${overall.feesOfGrossPercent}% overall — this is the profit≥charges rule working best when spreads are fat.`);
    if (best.wideFrequencyPercent > 10)
      why.push(`More fat dislocations: ${best.wideFrequencyPercent}% of opportunities in this period were WIDE (≥${wideThreshold}%), driven by thin books and slow exchanges while other regions sleep or during the EU–US handover.`);
    if (best.winRate > overall.winRate)
      why.push(`Cleaner execution: win rate ${best.winRate}% vs ${overall.winRate}% overall — spreads stayed open long enough (thin pairs correct slowly) instead of vanishing mid-trade.`);
    if (best.volatileSharePercent > 25)
      why.push(`Volatile pairs did the work: ${best.volatileSharePercent}% of trades in this period were SUI/NEAR/ARB/INJ/WIF/PEPE/BONK/SHIB, whose books lag most when price moves fast.`);
    if (best.topSymbols?.length)
      why.push(`Top earners in ${best.label}: ${best.topSymbols.map((s: { symbol: string; net: number }) => `${s.symbol} (+$${s.net.toFixed(4)})`).join(", ")}.`);
  }
  if (!why.length) why.push("Not enough trades in any single period yet to explain a winner — the tracker needs the bot running across different hours. It records every scan automatically, 24×7.");

  const sampleTrades = best?.trades || 0;
  const activeSessions = bySession.filter(s => s.trades > 0).length;
  const activeHours = byHour.filter(h => h.trades > 0).length;
  const confidence =
    activeSessions >= 4 && activeHours >= 10 && sampleTrades >= 30 ? "High"
    : activeSessions >= 2 && sampleTrades >= 10 ? "Medium"
    : `Low — so far trades only occurred in ${activeSessions} session(s) / ${activeHours} hour(s). Other periods show “no data”, not “unprofitable”. Keep the bot running 24×7 for a few days before trusting this fully`;
  if (activeSessions < 3 && best) {
    why.unshift(`Coverage caveat: all ${overall.trades} trades so far happened in the ${best.label} window (the bot has mainly been observed then). ${best.label} is the most profitable period WE HAVE DATA FOR — as the 24×7 tracker fills Asia/Europe/Overlap hours, this ranking can change.`);
  }

  // Next best window clock (UTC)
  const nextBestAt = bestHour ? (() => { const d = new Date(now); d.setUTCHours(Number(bestHour.key), 0, 0, 0); if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString(); })() : null;

  // ─── Daily summaries (for the Excel export) + saved reports ───
  const daily = buildDailySummaries(allTrades);
  const savedReports = await getDailyReports();

  return NextResponse.json({
    timezoneNote: "All periods are UTC (server time). Your browser clock may differ — sessions are defined in UTC so the 24×7 server and this dashboard always agree.",
    daily,
    savedReports: savedReports.map(r => ({
      reportDate: r.reportDate, trades: r.trades, netProfit: r.netProfit,
      bestHour: r.bestHour, bestHourProfit: r.bestHourProfit,
      bestSession: r.bestSession, bestSessionProfit: r.bestSessionProfit,
      updatedAt: r.updatedAt,
    })),
    wideThreshold,
    tracking: {
      since: allOpps.length ? allOpps[allOpps.length - 1].createdAt : allTrades.length ? allTrades[allTrades.length - 1].executedAt : null,
      trackedBuckets: tracked.length,
      trackedScans: tracked.reduce((s, r) => s + r.scans, 0),
      lastUpdated: tracked[0]?.updatedAt || new Date().toISOString(),
      totalTrades: allTrades.length, totalOpportunities: allOpps.length,
    },
    overall, byHour, bySession, byBlock, byDay,
    bestHour, worstHour, bestSession, worstSession, bestBlock, bestDay,
    current: { hourUtc: now.getUTCHours(), hour: currentHour, session: currentSession, sessionDef: currentSessionDef, isBestSessionNow: !!bestSession && bestSession.key === currentSessionDef.key, isBestHourNow: !!bestHour && Number(bestHour.key) === now.getUTCHours(), nextBestHourAt: nextBestAt, nextBestInHours },
    why, confidence,
    recommendations: [
      bestSession ? `Most profitable so far: ${bestSession.label} (${(bestSession as unknown as { range?: string }).range || ""}) — $${bestSession.netProfit} from ${bestSession.trades} trades. Keep the bot running 24×7 so it never misses this window; you do NOT need to be awake for it.` : "Run the bot 24×7 for at least a few days to learn your most profitable window.",
      worstSession && worstSession.netProfit < 0 ? `Weakest: ${worstSession.label} lost $${Math.abs(worstSession.netProfit).toFixed(4)} — the Risk Guard already sizes down there; consider Wide-Only mode if this persists.` : "No losing session so far — keep position sizes as they are.",
      "Do not chase the best period by turning the bot off at other times yet: arbitrage needs pre-positioned balances and the wide spreads often appear exactly when a session opens/closes.",
      `Confidence: ${confidence}.`,
    ],
    recentPeriods: tracked.slice(0, 24).map(r => ({
      bucketStart: r.bucketStart, hourUtc: r.hourUtc, session: r.session, scans: r.scans,
      opportunities: r.opportunities, wideOpportunities: r.wideOpportunities, trades: r.trades,
      netProfit: r.netProfit, avgSpreadPercent: r.opportunities ? parseFloat((r.spreadSum / r.opportunities).toFixed(4)) : 0, maxSpread: r.maxSpread,
    })),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "save-daily") {
    const dateKey = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : utcDateKey(new Date());
    const saved = await saveDailyReport(dateKey);
    if (!saved) return NextResponse.json({ ok: false, error: `No trades found for ${dateKey} yet` }, { status: 400 });
    await log("success", `📊 Daily report saved for ${dateKey}: ${saved.trades} trades, $${saved.netProfit} net, best ${saved.bestHour} (${saved.bestHourProfit >= 0 ? "+" : ""}$${saved.bestHourProfit})`);
    const savedReports = await getDailyReports();
    return NextResponse.json({ ok: true, saved, savedReports: savedReports.map(r => ({ reportDate: r.reportDate, trades: r.trades, netProfit: r.netProfit, bestHour: r.bestHour, bestHourProfit: r.bestHourProfit, bestSession: r.bestSession, bestSessionProfit: r.bestSessionProfit, updatedAt: r.updatedAt })) });
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
