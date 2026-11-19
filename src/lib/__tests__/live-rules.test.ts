import assert from "node:assert/strict";
import { buildRoute, roundToTick, floorToStep, toPlain, decimalsOf } from "../live";

const CFG = { minProfitUsd: 0.07, minProfitChargeRatio: 1.5, spreadThreshold: 0.575 };
const FEES = { binance: { makerPct: 0.1, takerPct: 0.1 }, bybit: { makerPct: 0.1, takerPct: 0.1 } };
// Exchange filters as published: PEPE-like tiny price, large lot step.
const INST = { minQty: 1, stepSize: 1, minNotional: 5, tickSize: 0.0000001, status: "TRADING" };
const bookWide = (ask: number, bid: number, qty = 1e12) => ({ bid, ask, bidQty: qty, askQty: qty, ts: 0 });
const base = (o: any) => ({
  pair: "PEPE/USDT", venueSymbol: "PEPEUSDT", base: "PEPE",
  buyVenue: "binance" as const, sellVenue: "bybit" as const,
  buyBook: bookWide(0.00001000, 0.00001000), sellBook: bookWide(0.00001030, 0.00001030),
  buyInst: INST, sellInst: INST, fees: FEES,
  bal: { binance: { USDT: 500 }, bybit: { PEPE: 1e12, USDT: 500 } },
  cap: 20, config: CFG, dailyBlocked: false, ...o,
});

// 1. Healthy opportunity passes, quantity rounded DOWN to step, sent as plain decimal
let r = buildRoute(base({}));
assert.equal(r.passes, true, `expected pass, got reason: ${r.reason}`);
assert.ok(Number.isInteger(r.qty) && r.qty > 0, "qty must be a whole multiple of the step");
assert.ok(!/e/i.test(r.qtyStr), "qty string must not use exponent notation");
assert.ok(r.notional <= 20 + 1e-9, "notional must respect the USD cap");

// 2. Fee unavailable → rejected (never trade blind)
r = buildRoute(base({ fees: null }));
assert.equal(r.passes, false); assert.match(r.reason!, /Fee rate unavailable/);

// 3. Pair not trading on one venue → rejected
r = buildRoute(base({ sellInst: { ...INST, status: "Break" } }));
assert.equal(r.passes, false); assert.match(r.reason!, /not trading/);

// 4. Pair not listed → rejected
r = buildRoute(base({ buyInst: undefined }));
assert.equal(r.passes, false); assert.match(r.reason!, /not listed/);

// 5. Missing lot step (0) → rejected, never size an order without a valid filter
r = buildRoute(base({ buyInst: { ...INST, stepSize: 0 } }));
assert.equal(r.passes, false); assert.match(r.reason!, /filter missing/);

// 6. Empty order book → rejected
r = buildRoute(base({ buyBook: bookWide(0, 0) }));
assert.equal(r.passes, false);

// 7. Oversized request capped by TOP-OF-BOOK DEPTH (half of displayed size)
r = buildRoute(base({ buyBook: bookWide(0.00001, 0.00001, 1000), sellBook: bookWide(0.00001030, 0.00001030, 1000), cap: 1000 }));
assert.ok(r.qty <= 500, `qty ${r.qty} must not exceed half of 1000 displayed`);

// 8. Below exchange minimum notional → rejected
r = buildRoute(base({ cap: 2 }));
assert.equal(r.passes, false); assert.match(r.reason!, /minimum/);

// 9. No USDT on buy venue → rejected with inventory reason
r = buildRoute(base({ bal: { binance: { USDT: 0 }, bybit: { PEPE: 1e12 } } }));
assert.equal(r.passes, false); assert.equal(r.buyable, false); assert.match(r.reason!, /USDT/);

// 10. No coin inventory on the SELL venue → rejected (this was previously always "true")
r = buildRoute(base({ bal: { binance: { USDT: 500 }, bybit: { USDT: 500 } } }));
assert.equal(r.passes, false); assert.equal(r.sellable, false); assert.match(r.reason!, /Need .* PEPE/);

// 11. Fees are priced at TAKER rate (both legs are IOC)
r = buildRoute(base({ fees: { binance: { makerPct: 0.0, takerPct: 0.1 }, bybit: { makerPct: 0.0, takerPct: 0.1 } } }));
assert.equal(r.buyFeePct, 0.1); assert.equal(r.sellFeePct, 0.1);

// 12. Thin spread below the bar → rejected even if the arithmetic is positive
r = buildRoute(base({ buyBook: bookWide(0.00001000, 0.00001000), sellBook: bookWide(0.00001003, 0.00001003) }));
assert.equal(r.passes, false);

// 13. Tick rounding: buy rounds UP, sell rounds DOWN (never worse than the book)
assert.equal(roundToTick(1.23456, 0.001, "up"), 1.235);
assert.equal(roundToTick(1.23456, 0.001, "down"), 1.234);
assert.equal(floorToStep(12.9, 1), 12);
assert.equal(floorToStep(0.000123456, 0.00001), 0.00012);
assert.equal(toPlain(0.0000001, decimalsOf(0.0000001)), "0.0000001");
assert.equal(decimalsOf(0.00000001), 8);

console.log("live rules: 13 scenarios passed");
