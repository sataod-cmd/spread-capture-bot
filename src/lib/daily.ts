import { db } from "../db";
import { trades, dailyReports } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { SESSIONS, sessionForHour } from "./time";

export type DailySummary = {
  reportDate: string;
  dayName: string;
  trades: number;
  wins: number;
  winRate: number;
  netProfit: number;
  grossProfit: number;
  fees: number;
  volume: number;
  avgSpreadPercent: number;
  bestHour: string | null;
  bestHourProfit: number;
  bestSession: string | null;
  bestSessionProfit: number;
  worstHour: string | null;
  worstHourProfit: number;
  hourly: { hour: string; trades: number; netProfit: number; winRate: number; avgSpreadPercent: number }[];
  sessions: { session: string; trades: number; netProfit: number }[];
  pairs: { symbol: string; trades: number; netProfit: number }[];
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function utcDateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Aggregate all trades into per-UTC-day summaries (in-memory, from the trades table). */
export function buildDailySummaries(allTrades: (typeof trades.$inferSelect)[]): DailySummary[] {
  const byDate = new Map<string, (typeof trades.$inferSelect)[]>();
  for (const t of allTrades) {
    const key = utcDateKey(new Date(t.executedAt));
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(t);
  }
  const out: DailySummary[] = [];
  for (const [date, ts] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hourlyMap = new Map<number, { trades: number; wins: number; net: number; spreadSum: number }>();
    const sessionMap = new Map<string, { trades: number; net: number }>();
    const pairMap = new Map<string, { trades: number; net: number }>();
    let wins = 0, net = 0, gross = 0, fees = 0, volume = 0, spreadSum = 0;
    for (const t of ts) {
      const d = new Date(t.executedAt);
      const h = d.getUTCHours();
      if (!hourlyMap.has(h)) hourlyMap.set(h, { trades: 0, wins: 0, net: 0, spreadSum: 0 });
      const hh = hourlyMap.get(h)!;
      hh.trades++; if (t.netProfit > 0) hh.wins++; hh.net += t.netProfit; hh.spreadSum += t.spreadPercent;
      const sk = sessionForHour(h).key;
      if (!sessionMap.has(sk)) sessionMap.set(sk, { trades: 0, net: 0 });
      const ss = sessionMap.get(sk)!; ss.trades++; ss.net += t.netProfit;
      if (!pairMap.has(t.symbol)) pairMap.set(t.symbol, { trades: 0, net: 0 });
      const pp = pairMap.get(t.symbol)!; pp.trades++; pp.net += t.netProfit;
      if (t.netProfit > 0) wins++;
      net += t.netProfit; gross += t.grossProfit; fees += t.fees; volume += t.amountUsd; spreadSum += t.spreadPercent;
    }
    const hourly = [...hourlyMap.entries()].sort((a, b) => a[0] - b[0]).map(([h, v]) => ({
      hour: `${String(h).padStart(2, "0")}:00 UTC`, trades: v.trades, netProfit: parseFloat(v.net.toFixed(4)),
      winRate: v.trades ? parseFloat(((v.wins / v.trades) * 100).toFixed(1)) : 0,
      avgSpreadPercent: v.trades ? parseFloat((v.spreadSum / v.trades).toFixed(4)) : 0,
    }));
    const withTrades = hourly.filter(h => h.trades > 0);
    const bestH = [...withTrades].sort((a, b) => b.netProfit - a.netProfit)[0] || null;
    const worstH = [...withTrades].sort((a, b) => a.netProfit - b.netProfit)[0] || null;
    const sessions = SESSIONS.map(s => ({
      session: s.label, trades: sessionMap.get(s.key)?.trades || 0,
      netProfit: parseFloat((sessionMap.get(s.key)?.net || 0).toFixed(4)),
    }));
    const bestS = [...sessions].filter(s => s.trades > 0).sort((a, b) => b.netProfit - a.netProfit)[0] || null;
    out.push({
      reportDate: date,
      dayName: DAY_NAMES[new Date(date + "T00:00:00Z").getUTCDay()],
      trades: ts.length, wins,
      winRate: ts.length ? parseFloat(((wins / ts.length) * 100).toFixed(1)) : 0,
      netProfit: parseFloat(net.toFixed(4)), grossProfit: parseFloat(gross.toFixed(4)),
      fees: parseFloat(fees.toFixed(4)), volume: parseFloat(volume.toFixed(2)),
      avgSpreadPercent: ts.length ? parseFloat((spreadSum / ts.length).toFixed(4)) : 0,
      bestHour: bestH?.hour || null, bestHourProfit: bestH?.netProfit || 0,
      bestSession: bestS?.session || null, bestSessionProfit: bestS?.netProfit || 0,
      worstHour: worstH?.hour || null, worstHourProfit: worstH?.netProfit || 0,
      hourly, sessions,
      pairs: [...pairMap.entries()].map(([symbol, v]) => ({ symbol, trades: v.trades, netProfit: parseFloat(v.net.toFixed(4)) })).sort((a, b) => b.netProfit - a.netProfit),
    });
  }
  return out;
}

/** Save (or refresh) one day's report row. Called automatically at day rollover + on demand. */
export async function saveDailyReport(dateKey: string): Promise<DailySummary | null> {
  const allTrades = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(10000);
  const summaries = buildDailySummaries(allTrades);
  const summary = summaries.find(s => s.reportDate === dateKey);
  if (!summary) return null;
  const existing = await db.select().from(dailyReports).where(eq(dailyReports.reportDate, dateKey)).limit(1);
  const values = {
    reportDate: dateKey, trades: summary.trades, wins: summary.wins,
    netProfit: summary.netProfit, grossProfit: summary.grossProfit, fees: summary.fees,
    volume: summary.volume, avgSpreadPercent: summary.avgSpreadPercent,
    bestHour: summary.bestHour, bestHourProfit: summary.bestHourProfit,
    bestSession: summary.bestSession, bestSessionProfit: summary.bestSessionProfit,
    worstHour: summary.worstHour, worstHourProfit: summary.worstHourProfit,
    data: summary, updatedAt: new Date(),
  };
  if (existing.length) {
    await db.update(dailyReports).set(values).where(eq(dailyReports.id, existing[0].id));
  } else {
    await db.insert(dailyReports).values(values);
  }
  return summary;
}

export async function getDailyReports() {
  return db.select().from(dailyReports).orderBy(desc(dailyReports.reportDate)).limit(60);
}

/**
 * Called from the scan engine: when the UTC day rolls over, persist yesterday's
 * full report automatically so the Excel history builds itself 24×7.
 */
const g = globalThis as typeof globalThis & { __arbLastReportDay?: string };
export async function ensureDailyReport() {
  try {
    const today = utcDateKey(new Date());
    if (g.__arbLastReportDay === today) return;
    const yesterday = utcDateKey(new Date(Date.now() - 24 * 3600_000));
    const existing = await db.select().from(dailyReports).where(eq(dailyReports.reportDate, yesterday)).limit(1);
    if (!existing.length) {
      const saved = await saveDailyReport(yesterday);
      if (saved) console.log(`[daily-report] auto-saved ${yesterday}: ${saved.trades} trades, $${saved.netProfit} net`);
    }
    g.__arbLastReportDay = today;
  } catch { /* never break a scan */ }
}
