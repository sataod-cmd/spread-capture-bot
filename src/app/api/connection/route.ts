import { NextResponse } from "next/server";
import { db } from "../../../db";
import { botConfigs } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { ensureConfig, log } from "../../../lib/bot";
import { binanceConnection, binanceBanExpiry, binanceBannedForMs, binanceRateStats } from "../../../lib/exchanges/binance";
import { binanceStreamStatus } from "../../../lib/exchanges/binanceStream";
import { bybitConnection } from "../../../lib/exchanges/bybit";
import { SYMBOL_MAP } from "../../../lib/live";

export const dynamic = "force-dynamic";
// The test hits both exchanges several times; give it room on Render.
export const maxDuration = 60;

async function publicIp() {
  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(6000) });
    const j = await res.json();
    return String(j.ip || "");
  } catch { return ""; }
}

/**
 * The connection test costs several Binance requests. Repeated clicks are the
 * fastest way to trigger an IP ban, so results are cached briefly. Pass
 * ?fresh=1 to force a real re-check.
 */
const CONNECTION_CACHE_MS = 30_000;
let connectionCache: { at: number; payload: unknown } | null = null;

/** Never let one slow exchange hang the whole connection test. */
function withDeadline<T>(promise: Promise<T>, fallback: T, ms = 25_000): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function GET(request: Request) {
  const config = await ensureConfig();
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  if (!fresh && connectionCache && Date.now() - connectionCache.at < CONNECTION_CACHE_MS) {
    return NextResponse.json({
      ...(connectionCache.payload as Record<string, unknown>),
      cached: true,
      cachedNote: "Reusing a result from the last 30s to protect Binance's rate limit. Open /api/connection?fresh=1 for a new check.",
    });
  }
  const symbols: string[] = Object.values(SYMBOL_MAP);

  // If Binance has banned this IP on EITHER host, make ZERO Binance calls and
  // say so plainly. Every call made during a ban extends the ban.
  const privateBanExpiry = binanceBanExpiry();
  const publicBanExpiry = binanceBanExpiry("https://data-api.binance.vision");
  const banExpiry = [privateBanExpiry, publicBanExpiry].filter((x): x is number => x !== null).sort((a, b) => b - a)[0] ?? null;
  const binanceBanned = banExpiry !== null;

  const timeoutVenue = (venue: "binance" | "bybit", name: string) => ({
    venue, name, configured: true, authenticated: false,
    balances: [], totalUsdValue: 0, makerFeePercent: 0, takerFeePercent: 0,
    feeSource: "timed out", symbols: [], serverTimeOk: false, clockSkewMs: 0,
    errors: [`${name} did not respond within 25s — the server may be unable to reach ${name} from this region. Open /api/preflight to confirm.`],
    notes: [],
  });

  const binance = binanceBanned
    ? {
        venue: "binance" as const, name: "Binance", configured: true, authenticated: false,
        balances: [], totalUsdValue: 0, makerFeePercent: 0, takerFeePercent: 0,
        feeSource: "banned", symbols: [], serverTimeOk: false, clockSkewMs: 0,
        errors: [`Binance IP banned until ${new Date(banExpiry!).toISOString()} (${Math.ceil(binanceBannedForMs() / 60_000)} min left). No requests were sent — each call during a ban extends it. Wait it out, then use ?fresh=1 once.`],
        notes: [],
      }
    : await withDeadline(binanceConnection(symbols), timeoutVenue("binance", "Binance"));

  const [bybit, ip] = await Promise.all([
    withDeadline(bybitConnection(symbols), timeoutVenue("bybit", "Bybit")),
    publicIp(),
  ]);

  const bothReady = binance.authenticated && bybit.authenticated;
  const bothFunded = binance.totalUsdValue > 0 && bybit.totalUsdValue > 0;

  // Authentication, funding and live execution are different states. A green
  // "connected" badge alone must never imply the account is trading live.
  const withState = <T extends { authenticated: boolean; totalUsdValue: number; errors: string[] }>(venue: T) => ({
    ...venue,
    state: !venue.authenticated
      ? venue.errors.some((e) => /banned|rate.?limit|HTTP 41[89]/i.test(e)) ? "rate_limited" : "error"
      : venue.totalUsdValue > 0 ? "ready" : "connected_unfunded",
  });
  const binanceState = withState(binance);
  const bybitState = withState(bybit);
  const weight = Number(binanceRateStats()?.usedWeight1m || 0);
  const binanceRateLimited = binanceBanned || binance.errors.some((e) => /banned|rate.?limit|HTTP 41[89]/i.test(e));

  const payload = {
    ok: bothReady,
    serverPublicIp: ip,
    symbols,
    binanceBan: {
      active: binanceBanned,
      until: banExpiry ? new Date(banExpiry).toISOString() : null,
      minutesLeft: binanceBanned ? Math.ceil(binanceBannedForMs() / 60_000) : 0,
      advice: "Binance banned this server IP for rate-limit abuse. Do NOT click Test Connection until the ban expires — every call during a ban extends it. The throttled build suppresses requests automatically while banned.",
    },
    binanceStream: binanceStreamStatus(),
    binanceRateLimit: {
      ...binanceRateStats(),
      marketDataHost: "data-api.binance.vision",
      accountApiHost: "api.binance.com",
      note: "Public books and exchange filters use Binance's official market-data host. Only account, fee and order calls use the authenticated API.",
    },
    venues: [binanceState, bybitState],
    sharedIpGuidance: {
      suspected: binanceRateLimited,
      usedWeight1m: weight || null,
      assessment: binanceRateLimited
        ? weight >= 5000
          ? "Binance reports near-limit usage for the whole public IP. That total includes every workload sharing the hosting IP, not only this bot."
          : "Binance has banned the hosting IP. The API key has not necessarily been evaluated yet."
        : "No active Binance IP ban detected in this process.",
      requiredAction: binanceRateLimited
        ? "Use a dedicated outbound IP (Render workspace → Networking → Dedicated IPs, in the same region as the service) or a VPS with a dedicated IPv4. Do not keep retrying during the ban."
        : "No dedicated-IP change is currently indicated by this error.",
      officialGuide: "https://render.com/docs/dedicated-ips",
    },
    checks: [
      { label: "Binance API key valid", ok: binance.authenticated, detail: binance.authenticated ? "Authenticated + spot permission confirmed" : binance.errors[0] || "Not authenticated" },
      { label: "Bybit API key valid", ok: bybit.authenticated, detail: bybit.authenticated ? "Authenticated + wallet readable" : bybit.errors[0] || "Not authenticated" },
      { label: "Server clock in sync", ok: binance.serverTimeOk && bybit.serverTimeOk, detail: `Binance skew ${binance.clockSkewMs}ms • Bybit skew ${bybit.clockSkewMs}ms` },
      { label: "Best 6 pairs listed on both", ok: binance.symbols.length > 0 && bybit.symbols.length > 0, detail: `Binance ${binance.symbols.length}/6 • Bybit ${bybit.symbols.length}/6` },
      { label: "Both accounts funded", ok: bothFunded, detail: `Binance $${binance.totalUsdValue.toFixed(2)} • Bybit $${bybit.totalUsdValue.toFixed(2)}` },
    ],
    readyForLive: bothReady && bothFunded,
    envSetup: [
      { name: "BINANCE_API_KEY", configured: !!process.env.BINANCE_API_KEY },
      { name: "BINANCE_API_SECRET", configured: !!process.env.BINANCE_API_SECRET },
      { name: "BYBIT_API_KEY", configured: !!process.env.BYBIT_API_KEY },
      { name: "BYBIT_API_SECRET", configured: !!process.env.BYBIT_API_SECRET },
    ],
    apiKeyInstructions: [
      "Binance: Profile → API Management → Create API. Enable 'Enable Spot & Margin Trading'. LEAVE withdrawals DISABLED. Copy Key + Secret into BINANCE_API_KEY / BINANCE_API_SECRET.",
      "Bybit: Account → API → Create New Key (choose 'Spot' or 'Unified'). LEAVE withdrawals DISABLED. Copy into BYBIT_API_KEY / BYBIT_API_SECRET.",
      `If your exchange asks for an IP allowlist, add this server IP: ${ip || "(fetch it from your hosting panel)"} — or leave the allowlist empty while testing.`,
      "Never paste keys into this dashboard or into chat. They belong in the server environment variables (see the Install guide) and nowhere else.",
    ],
    liveMode: {
      liveEnabled: config.liveEnabled,
      liveDryRun: config.liveDryRun,
      liveMaxTradeUsd: config.liveMaxTradeUsd,
      liveExecutionMode: config.liveExecutionMode,
      liveEnabledAt: config.liveEnabledAt,
    },
  };
  connectionCache = { at: Date.now(), payload };
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const config = await ensureConfig();
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = { updatedAt: new Date() };

  if (body.action === "enable-live") {
    // Hard safety gates before real money can be traded
    const symbols: string[] = Object.values(SYMBOL_MAP);
    const [b, y] = await Promise.all([binanceConnection(symbols), bybitConnection(symbols)]);
    if (!b.authenticated || !y.authenticated) {
      return NextResponse.json({ ok: false, error: "Both API keys must authenticate before live trading can be enabled." }, { status: 400 });
    }
    if (b.totalUsdValue <= 0 || y.totalUsdValue <= 0) {
      return NextResponse.json({ ok: false, error: "Both accounts must have USDT balance before live trading." }, { status: 400 });
    }
    const cap = Math.min(Number(body.maxTradeUsd || 20), 50);
    update.liveEnabled = true;
    update.liveDryRun = false;
    update.liveMaxTradeUsd = cap;
    update.liveEnabledAt = new Date();
    const [updated] = await db.update(botConfigs).set(update).where(eq(botConfigs.id, config.id)).returning();
    await log("warn", `🔴🔴 LIVE TRADING ENABLED — real orders on Binance + Bybit, max $${cap} per trade, stop-loss ${updated.maxLossPerTradeUsd}, daily loss cap ${updated.maxDailyLossUsd}`);
    return NextResponse.json({ ok: true, config: updated });
  }
  if (body.action === "disable-live") {
    update.liveEnabled = false;
    update.liveDryRun = true;
    const [updated] = await db.update(botConfigs).set(update).where(eq(botConfigs.id, config.id)).returning();
    await log("warn", "⚪ LIVE TRADING DISABLED — back to paper mode");
    return NextResponse.json({ ok: true, config: updated });
  }
  if (body.action === "dry-run") {
    update.liveDryRun = !!body.dryRun;
    const [updated] = await db.update(botConfigs).set(update).where(eq(botConfigs.id, config.id)).returning();
    return NextResponse.json({ ok: true, config: updated });
  }
  if (body.action === "set-cap") {
    update.liveMaxTradeUsd = Math.min(50, Math.max(1, Number(body.maxTradeUsd || 20)));
    const [updated] = await db.update(botConfigs).set(update).where(eq(botConfigs.id, config.id)).returning();
    return NextResponse.json({ ok: true, config: updated });
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
