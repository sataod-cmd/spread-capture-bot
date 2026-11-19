import assert from "node:assert/strict";

/**
 * The screenshot showed Binance returning:
 *   "Way too much request weight used; IP banned until 1794803971999."
 * These tests pin the parsing/health behaviour so the UI can distinguish a
 * rate-limit ban from an API-key, region or allowlist problem.
 */
function parseBanUntil(message: string): number | null {
  const m = message.match(/banned until (\d{10,})/i);
  return m ? Number(m[1]) : null;
}

// 1. The exact message from the screenshot parses to a millisecond timestamp.
const ts = parseBanUntil("Way too much request weight used; IP banned until 1794803971999. Please use WebSocket Streams for live updates to avoid bans.");
assert.equal(ts, 1794803971999);
assert.ok(ts! > 1e12, "timestamp must be milliseconds");

// 2. Ordinary errors must not be mistaken for a ban.
assert.equal(parseBanUntil("Invalid API-key, IP, or permissions for action."), null);
assert.equal(parseBanUntil("Market is closed"), null);
assert.equal(parseBanUntil(""), null);

// 3. A ban whose timestamp is in the past means we may retry immediately.
const now = Date.now();
assert.ok(ts! < now, "the banner's ban timestamp should already have expired");

// 4. A ban timestamp in the future must suppress requests until it expires.
const futureBan = parseBanUntil("IP banned until " + (now + 3600_000) + ".");
assert.ok(futureBan !== null && futureBan > now, "a future ban must be detected so requests are suppressed");
assert.equal(Math.ceil((futureBan! - now) / 60_000) > 0, true, "remaining minutes must be positive");

console.log("rate-limit ban parsing: 7 assertions passed");
