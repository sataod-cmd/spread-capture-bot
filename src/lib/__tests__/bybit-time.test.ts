import assert from "node:assert/strict";

// Bybit returns BOTH fields, but timeNano is the complete epoch timestamp in
// nanoseconds. Summing them (the old bug) doubles the timestamp and produces
// a huge negative clock skew like -1794994210965ms.
function parseServerTime(response: { result?: { timeSecond?: string; timeNano?: string } }) {
  const res = response.result || {};
  const nano = Number(res.timeNano);
  const sec = Number(res.timeSecond);
  return Number.isFinite(nano) && nano > 0
    ? nano / 1_000_000
    : Number.isFinite(sec) && sec > 0
      ? sec * 1000
      : 0;
}

// Official response shape from Bybit's API docs.
const official = { retCode: 0, retMsg: "OK", result: { timeSecond: "1688639403", timeNano: "1688639403423213947" } };
assert.equal(Math.round(parseServerTime(official)), 1688639403423);

// Current-time example: server/local clocks should differ by milliseconds, not years.
const now = Date.now();
const serverMs = parseServerTime({ result: { timeSecond: String(Math.floor(now / 1000)), timeNano: String(now * 1_000_000) } });
assert.ok(Math.abs(now - serverMs) < 100, `expected near-zero skew, got ${now - serverMs}ms`);

// timeSecond is a valid fallback only if timeNano is unavailable.
assert.equal(parseServerTime({ result: { timeSecond: "1688639403" } }), 1688639403000);

// Missing/garbage fields must never produce NaN.
assert.equal(parseServerTime({}), 0);
assert.equal(parseServerTime({ result: { timeSecond: "abc", timeNano: "nope" } }), 0);
assert.ok(Number.isFinite(parseServerTime({ result: { timeSecond: "abc" } })));

console.log("bybit time parsing: 6 assertions passed (epoch nanoseconds handled correctly)");
