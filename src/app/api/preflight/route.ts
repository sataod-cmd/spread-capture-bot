import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "../../../db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Preflight — answers "is the deployed server actually able to trade?"
 * Runs the checks that fail independently and returns each verdict
 * separately, so a failure points at one cause instead of "no connection".
 * Read-only: it never places an order and never prints a key.
 */
type Check = { name: string; ok: boolean; detail: string; fatal?: boolean };

/**
 * Classifies an exchange auth failure so the operator is not left guessing
 * between an IP allowlist problem and everything else.
 * Key point: an IP problem is reported by the venue as 401 / -2015 (or
 * "invalid signature"), never as 451/403 which are region blocks.
 */
export function classifyAuthFailure(status: number, message: string): string {
  if (status === 451) return "region-blocked (HTTP 451): Binance does not serve this server's country. Redeploy the web service in Singapore, Frankfurt or London. An IP allowlist cannot fix this.";
  if (status === 403) return "blocked (HTTP 403): the venue is refusing this server's region or IP. If both venues fail identically it is the region; redeploy in Singapore, Frankfurt or London.";
  if (status === 429) return "rate limited (HTTP 429): too many requests from this IP. Wait a minute; a rotating IP can trigger this, but it clears on its own.";
  if (/invalid api-key, ip, or permissions|-2015|10003|unauthorized/i.test(message)) {
    return "key or IP rejected (401/-2015): check that the API key has Spot trading enabled and that the server's current IP is allowed. Prefer leaving the allowlist EMPTY, because hosting IPs rotate.";
  }
  return message;
}

async function timed(label: string, url: string, init?: RequestInit): Promise<Check> {
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const ms = Date.now() - started;
    const body = await res.text();
    const snippet = body.replace(/\s+/g, " ").slice(0, 120);
    if (res.ok) return { name: label, ok: true, detail: `HTTP ${res.status} in ${ms}ms` };
    const geo = res.status === 403 || res.status === 451;
    return {
      name: label, ok: false, fatal: geo,
      detail: `HTTP ${res.status} in ${ms}ms — ${geo ? "region-blocked. Redeploy this service in Singapore, Frankfurt or London; Binance and Bybit do not serve US-hosted servers." : snippet}`,
    };
  } catch (error) {
    return {
      name: label, ok: false,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

export async function GET() {
  const checks: Check[] = [];

  // 1. Database reachability — everything else depends on it.
  const dbStarted = Date.now();
  try {
    const result = await db.execute(sql`select 1 as ok`);
    const rows = (result as unknown as { rows?: unknown[] }).rows;
    checks.push({ name: "Database", ok: true, fatal: true, detail: `Connected in ${Date.now() - dbStarted}ms (${rows?.length ?? 1} row)` });
  } catch (error) {
    checks.push({
      name: "Database", ok: false, fatal: true,
      detail: `${error instanceof Error ? error.message : String(error)} — confirm Render's DATABASE_URL references the Postgres service's Internal Database URL.`,
    });
  }

  // 2. Environment variables present (names only, never values).
  const names = ["DATABASE_URL", "BINANCE_API_KEY", "BINANCE_API_SECRET", "BYBIT_API_KEY", "BYBIT_API_SECRET"];
  const missing = names.filter((n) => !process.env[n]);
  checks.push({
    name: "Environment variables", ok: missing.length === 0,
    detail: missing.length ? `Missing on this service: ${missing.join(", ")}` : `All ${names.length} present`,
  });

  // 3. Exchange reachability from THIS server. If Binance has banned this IP,
  //    do NOT call Binance at all — each call during a ban extends the ban.
  const { binanceBanExpiry, binanceBannedForMs } = await import("../../../lib/exchanges/binance");
  const banExpiry = binanceBanExpiry();
  const publicBanExpiry = binanceBanExpiry("https://data-api.binance.vision");
  if (publicBanExpiry) {
    checks.push({
      name: "Binance market data reachable", ok: false, fatal: true,
      detail: `Public-data IP ban until ${new Date(publicBanExpiry).toISOString()}. No request was sent; live books use WebSocket streaming instead.`,
    });
  } else {
    checks.push(await timed("Binance market data reachable", "https://data-api.binance.vision/api/v3/time"));
  }
  if (banExpiry) {
    checks.push({
      name: "Binance account API", ok: false, fatal: true,
      detail: `Account API IP BANNED until ${new Date(banExpiry).toISOString()} (${Math.ceil(binanceBannedForMs() / 60_000)} min left). No authenticated request was sent.`,
    });
  }
  checks.push(await timed("Bybit reachable", "https://api.bybit.com/v5/market/time"));

  // 4. Outbound internet + current egress IP (hosting IPs rotate; this shows
  //    the live value rather than asking the operator to guess).
  const ipCheck = await timed("General internet", "https://api.ipify.org?format=json");
  checks.push(ipCheck);
  let egressIp = "";
  try {
    const r = await fetch("https://api.ipify.org?format=json", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (r.ok) egressIp = String((await r.json())?.ip ?? "");
  } catch { /* optional */ }

  const fatal = checks.some((c) => !c.ok && c.fatal);
  const reachable = checks.filter((c) => c.name.includes("reachable")).every((c) => c.ok);
  const regionBlocked = checks.some((c) => c.name.includes("reachable") && /HTTP (403|451)/.test(c.detail));
  const allowlistNote = regionBlocked
    ? "EXCHANGE IP ALLOWLIST IS NOT THE CAUSE. A venue blocked by region returns 403/451 before it ever looks at your key. Leave the allowlist empty and redeploy the web service in Singapore, Frankfurt or London instead."
    : "If a future test returns 401 or 'invalid API-key, IP, or permissions', that is an allowlist/key problem. Because hosting IPs rotate, leaving the allowlist empty is more reliable than pinning today's IP.";

  return NextResponse.json({
    serverTimeUtc: new Date().toISOString(),
    region: process.env.RENDER_REGION || process.env.VERCEL_REGION || process.env.FLY_REGION || "unknown",
    egressIp: egressIp || "unavailable",
    egressIpNote: "This is the address the exchange sees right now. Hosting IPs rotate, so do not pin it in an allowlist unless the host offers a static outbound IP.",
    binanceBan: (banExpiry || publicBanExpiry)
      ? { active: true, until: new Date(Math.max(banExpiry || 0, publicBanExpiry || 0)).toISOString(), minutesLeft: Math.ceil(binanceBannedForMs() / 60_000) }
      : { active: false },
    binanceStream: (await import("../../../lib/exchanges/binanceStream")).binanceStreamStatus(),
    regionBlocked,
    allowlistNote,
    ok: checks.every((c) => c.ok),
    canReachExchanges: reachable,
    fatal,
    checks,
    next: fatal
      ? "Fix the failed fatal check first; the dashboard cannot work until it passes."
      : !reachable
        ? "The server cannot reach an exchange API. Change the Render region (Singapore or Frankfurt) and redeploy."
        : missing.length
          ? "Add the missing variables in Render → Environment, then redeploy."
          : "Server, database and exchanges are all reachable. Open the dashboard → Live Trading → Test Connection.",
  });
}
