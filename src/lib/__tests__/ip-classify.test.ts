import assert from "node:assert/strict";
import { classifyAuthFailure } from "../../app/api/preflight/route";

// Region blocks must never be reported as an allowlist problem.
const b451 = classifyAuthFailure(451, "");
assert.match(b451, /region-blocked/i);
assert.match(b451, /allowlist cannot fix/i);

const y403 = classifyAuthFailure(403, "");
assert.match(y403, /blocked/i);
assert.match(y403, /region/i);

// Real allowlist/key failures say so, and recommend leaving it empty.
const ip401 = classifyAuthFailure(401, "Invalid API-key, IP, or permissions for action.");
assert.match(ip401, /IP rejected/i);
assert.match(ip401, /leaving the allowlist EMPTY/i);

const bybitIP = classifyAuthFailure(0, "invalid api key (code 10003)");
assert.match(bybitIP, /IP rejected/i);

assert.match(classifyAuthFailure(429, ""), /rate limited/i);

// Unknown errors pass through unchanged rather than being mislabelled.
assert.equal(classifyAuthFailure(500, "boom"), "boom");

console.log("preflight IP/region classifier: 6 scenarios passed");
