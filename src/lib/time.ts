import { db } from "../db";
import { timePeriodStats } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Exclusive trading sessions (UTC). Sessions are where profitability differs:
 * volatility, spread width and exchange lag all change when different
 * regions are awake and trading.
 */
export const SESSIONS = [
  { key: "asia", label: "Asia Session", range: "00:00–08:00 UTC", startHour: 0, endHour: 8, description: "Tokyo/Hong Kong/Singapore active. Meme & alt volatility often starts here; US/EU asleep so some books are thin." },
  { key: "europe", label: "Europe Session", range: "08:00–13:00 UTC", startHour: 8, endHour: 13, description: "London open. Liquidity improves, spreads on majors tighten, alts still move." },
  { key: "overlap", label: "Europe–US Overlap ⭐", range: "13:00–17:00 UTC", startHour: 13, endHour: 17, description: "Highest global volume of the day. Fast repricing on US/EU venues while smaller Asian venues lag — classic arbitrage window." },
  { key: "us", label: "US Session", range: "17:00–21:00 UTC", startHour: 17, endHour: 21, description: "New York afternoon. Strong moves on US news; Coinbase volume peaks." },
  { key: "offhours", label: "Off-Hours / Late", range: "21:00–00:00 UTC", startHour: 21, endHour: 24, description: "Thinnest books of the day. Spreads can be wide but slippage risk is highest — the Risk Guard matters most here." },
] as const;

export function sessionForHour(hourUtc: number) {
  return SESSIONS.find(s => hourUtc >= s.startHour && hourUtc < s.endHour) || SESSIONS[0];
}
export function sessionKeyForDate(d: Date) { return sessionForHour(d.getUTCHours()).key; }
export function bucketStartUtc(d: Date) {
  const b = new Date(d); b.setUTCMinutes(0, 0, 0); return b;
}

/** Called by every scan (server worker / cron / manual) — this is the "keep tracking". */
export async function recordPeriodObservation(input: {
  opportunities: number; wideOpportunities: number; megaOpportunities: number;
  trades: number; netProfit: number; grossProfit: number; fees: number;
  spreadSum: number; maxSpread: number; wideThreshold: number;
}) {
  try {
    const now = new Date();
    const bucket = bucketStartUtc(now);
    const hour = now.getUTCHours();
    const session = sessionForHour(hour).key;
    const existing = await db.select().from(timePeriodStats).where(eq(timePeriodStats.bucketStart, bucket)).limit(1);
    if (existing.length) {
      const r = existing[0];
      await db.update(timePeriodStats).set({
        scans: r.scans + 1,
        opportunities: r.opportunities + input.opportunities,
        wideOpportunities: r.wideOpportunities + input.wideOpportunities,
        megaOpportunities: r.megaOpportunities + input.megaOpportunities,
        trades: r.trades + input.trades,
        netProfit: parseFloat((r.netProfit + input.netProfit).toFixed(4)),
        grossProfit: parseFloat((r.grossProfit + input.grossProfit).toFixed(4)),
        fees: parseFloat((r.fees + input.fees).toFixed(4)),
        spreadSum: parseFloat((r.spreadSum + input.spreadSum).toFixed(4)),
        maxSpread: Math.max(r.maxSpread, input.maxSpread),
        updatedAt: new Date(),
      }).where(eq(timePeriodStats.id, r.id));
    } else {
      await db.insert(timePeriodStats).values({
        bucketStart: bucket, hourUtc: hour, session, scans: 1,
        opportunities: input.opportunities, wideOpportunities: input.wideOpportunities, megaOpportunities: input.megaOpportunities,
        trades: input.trades, netProfit: input.netProfit, grossProfit: input.grossProfit, fees: input.fees,
        spreadSum: input.spreadSum, maxSpread: input.maxSpread,
      });
    }
  } catch { /* tracking must never break a scan */ }
}
