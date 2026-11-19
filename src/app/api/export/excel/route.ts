import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "../../../../db";
import { trades } from "../../../../db/schema";
import { ensureConfig } from "../../../../lib/bot";
import { buildDailySummaries } from "../../../../lib/daily";
import { SESSIONS, sessionForHour } from "../../../../lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Generates a real .xlsx workbook on the server. The browser only has to
 * download the response, so this works even if client-side dynamic imports,
 * dashboard data loading, or popup restrictions fail.
 */
export async function GET() {
  try {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const appendSheet = (name: string, rows: Record<string, unknown>[]) => {
      const sheet = workbook.addWorksheet(name);
      if (!rows.length) { sheet.addRow(["No data"]); return; }
      const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      sheet.addRow(headers);
      for (const row of rows) sheet.addRow(headers.map((header) => row[header] ?? ""));
    };
    const config = await ensureConfig();
    const allTrades = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(10000);
    const daily = buildDailySummaries(allTrades);
    const round = (n: number, digits = 4) => Number(Number(n || 0).toFixed(digits));

    const byHour = Array.from({ length: 24 }, (_, hour) => {
      const matching = allTrades.filter((t) => new Date(t.executedAt).getUTCHours() === hour);
      return {
        "Hour (UTC)": `${String(hour).padStart(2, "0")}:00`,
        Trades: matching.length,
        Wins: matching.filter((t) => t.netProfit > 0).length,
        "Win Rate %": matching.length ? round((matching.filter((t) => t.netProfit > 0).length / matching.length) * 100, 1) : 0,
        "Gross Profit $": round(matching.reduce((s, t) => s + t.grossProfit, 0)),
        "Fees $": round(matching.reduce((s, t) => s + t.fees, 0)),
        "Net Profit $": round(matching.reduce((s, t) => s + t.netProfit, 0)),
        "Avg Spread %": matching.length ? round(matching.reduce((s, t) => s + t.spreadPercent, 0) / matching.length) : 0,
        Verdict: matching.length === 0 ? "No trades yet" : matching.reduce((s, t) => s + t.netProfit, 0) < 0 ? "Losing hour" : "Profitable",
      };
    });

    const sessions = SESSIONS.map((session) => {
      const matching = allTrades.filter((t) => sessionForHour(new Date(t.executedAt).getUTCHours()).key === session.key);
      return {
        Session: session.label,
        "UTC Range": session.range,
        Trades: matching.length,
        "Win Rate %": matching.length ? round((matching.filter((t) => t.netProfit > 0).length / matching.length) * 100, 1) : 0,
        "Net Profit $": round(matching.reduce((s, t) => s + t.netProfit, 0)),
        "Avg Spread %": matching.length ? round(matching.reduce((s, t) => s + t.spreadPercent, 0) / matching.length) : 0,
      };
    });

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const daysOfWeek = dayNames.map((day, index) => {
      const matching = allTrades.filter((t) => new Date(t.executedAt).getUTCDay() === index);
      return {
        Day: day,
        Trades: matching.length,
        "Win Rate %": matching.length ? round((matching.filter((t) => t.netProfit > 0).length / matching.length) * 100, 1) : 0,
        "Net Profit $": round(matching.reduce((s, t) => s + t.netProfit, 0)),
        "Avg Spread %": matching.length ? round(matching.reduce((s, t) => s + t.spreadPercent, 0) / matching.length) : 0,
      };
    });

    const pairMap = new Map<string, typeof allTrades>();
    for (const trade of allTrades) {
      const list = pairMap.get(trade.symbol) || [];
      list.push(trade);
      pairMap.set(trade.symbol, list);
    }
    const pairs = [...pairMap.entries()].map(([symbol, list]) => ({
      Pair: symbol,
      Trades: list.length,
      Wins: list.filter((t) => t.netProfit > 0).length,
      "Win Rate %": round((list.filter((t) => t.netProfit > 0).length / list.length) * 100, 1),
      "Net Profit $": round(list.reduce((s, t) => s + t.netProfit, 0)),
      "Avg Spread %": round(list.reduce((s, t) => s + t.spreadPercent, 0) / list.length),
      "Max Spread %": round(Math.max(...list.map((t) => t.spreadPercent))),
      "Stop-Loss Hits": list.filter((t) => t.stopLossTriggered).length,
    })).sort((a, b) => b["Net Profit $"] - a["Net Profit $"]);

    const dailyRows = daily.map((x) => ({
      "Date (UTC)": x.reportDate, Day: x.dayName, Trades: x.trades, Wins: x.wins,
      "Win Rate %": x.winRate, "Net Profit $": round(x.netProfit),
      "Gross Profit $": round(x.grossProfit), "Fees $": round(x.fees),
      "Volume $": round(x.volume, 2), "Avg Spread %": x.avgSpreadPercent,
      "Best Hour (UTC)": x.bestHour || "—", "Best Hour Profit $": round(x.bestHourProfit),
      "Best Session": x.bestSession || "—", "Best Session Profit $": round(x.bestSessionProfit),
      "Worst Hour (UTC)": x.worstHour || "—", "Worst Hour Profit $": round(x.worstHourProfit),
    }));
    appendSheet("Daily Summary", dailyRows.length ? dailyRows : [{ Note: "No trades recorded yet" }]);
    appendSheet("Hourly Profit (UTC)", byHour);
    appendSheet("Sessions", sessions);
    appendSheet("Days of Week", daysOfWeek);
    appendSheet("Pairs", pairs.length ? pairs : [{ Note: "No pair data yet" }]);
    appendSheet("Trades", allTrades.slice(0, 2000).map((t) => ({
      "Executed At (UTC)": new Date(t.executedAt).toISOString(), Pair: t.symbol,
      Buy: t.buyExchange, Sell: t.sellExchange, Quantity: t.quantity,
      "Buy Price": t.buyPrice, "Sell Price": t.sellPrice,
      "Spread %": t.spreadPercent, "Trade USD": t.amountUsd,
      "Gross Profit $": round(t.grossProfit), "Fees $": round(t.fees),
      "Net Profit $": round(t.netProfit), "Stop Loss": t.stopLossTriggered ? "Yes" : "No",
      Source: t.source,
    })));

    const totalGross = allTrades.reduce((s, t) => s + t.grossProfit, 0);
    const totalFees = allTrades.reduce((s, t) => s + t.fees, 0);
    const totalNet = allTrades.reduce((s, t) => s + t.netProfit, 0);
    const taxReserve = Math.max(0, totalNet) * (config.taxPercent / 100);
    appendSheet("Summary", [
      { Item: "Generated (UTC)", Value: new Date().toISOString() },
      { Item: "Starting capital", Value: `$${config.initialBalanceUsd}` },
      { Item: "Current paper balance", Value: `$${round(config.balanceUsd, 2)}` },
      { Item: "Mode", Value: config.liveEnabled && !config.liveDryRun ? "Live" : "Paper simulation" },
      { Item: "Gross profit", Value: `$${round(totalGross)}` },
      { Item: "Trading charges", Value: `$${round(totalFees)}` },
      { Item: "Net profit after charges", Value: `$${round(totalNet)}` },
      { Item: `Tax reserve (${config.taxPercent}%)`, Value: `$${round(taxReserve)}` },
      { Item: "After-tax estimate", Value: `$${round(totalNet - taxReserve)}` },
      { Item: "Timezone", Value: "All hourly data is UTC" },
      { Item: "Disclaimer", Value: "Paper-trading results are simulated and are not guaranteed live returns." },
    ]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="spread-capture-bot-report-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[excel-export] failed", error);
    return NextResponse.json({ error: "Could not generate the Excel report" }, { status: 500 });
  }
}
