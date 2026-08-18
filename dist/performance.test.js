"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const performance_1 = require("./performance");
(0, node_test_1.test)("rootTicker strips Bloomberg-style suffixes", () => {
    strict_1.default.equal((0, performance_1.rootTicker)("ASML US"), "ASML");
    strict_1.default.equal((0, performance_1.rootTicker)("MSFT US Equity"), "MSFT");
    strict_1.default.equal((0, performance_1.rootTicker)("AAPL"), "AAPL");
});
(0, node_test_1.test)("isoDaysAgo subtracts calendar days", () => {
    strict_1.default.equal((0, performance_1.isoDaysAgo)("2026-08-17", 1), "2026-08-16");
    strict_1.default.equal((0, performance_1.isoDaysAgo)("2026-08-17", 7), "2026-08-10");
});
(0, node_test_1.test)("nearestOnOrBefore finds the latest date <= target within the gap", () => {
    const dates = ["2026-08-10", "2026-08-11", "2026-08-14"]; // Fri, then next Mon
    strict_1.default.equal((0, performance_1.nearestOnOrBefore)(dates, "2026-08-14", 5), "2026-08-14");
    // weekend target with no exact row: falls back to Friday's row
    strict_1.default.equal((0, performance_1.nearestOnOrBefore)(dates, "2026-08-16", 5), "2026-08-14");
    // too far back given the gap tolerance
    strict_1.default.equal((0, performance_1.nearestOnOrBefore)(["2026-08-01"], "2026-08-20", 5), null);
    // nothing on or before target at all
    strict_1.default.equal((0, performance_1.nearestOnOrBefore)(["2026-08-20"], "2026-08-10", 5), null);
});
(0, node_test_1.test)("calcRet computes a normal percentage return", () => {
    strict_1.default.equal((0, performance_1.calcRet)(110, "2026-08-17", 100, "2026-08-10"), 10);
    strict_1.default.equal((0, performance_1.calcRet)(90, "2026-08-17", 100, "2026-08-10"), -10);
});
(0, node_test_1.test)("calcRet returns null on missing data or zero base", () => {
    strict_1.default.equal((0, performance_1.calcRet)(null, "2026-08-17", 100, "2026-08-10"), null);
    strict_1.default.equal((0, performance_1.calcRet)(110, "2026-08-17", null, "2026-08-10"), null);
    strict_1.default.equal((0, performance_1.calcRet)(110, "2026-08-17", 0, "2026-08-10"), null);
});
(0, node_test_1.test)("calcRet returns null (not 0) when cur/hist resolve to the same row", () => {
    // Same date string -> guaranteed same underlying row, even if by some
    // accident the two callers passed different-looking numbers.
    strict_1.default.equal((0, performance_1.calcRet)(100, "2026-08-14", 100, "2026-08-14"), null);
});
(0, node_test_1.test)("calcRet still reports a real 0.00% for two different dates with an identical price", () => {
    // A genuinely flat day is not the same bug as the resolution-collision
    // case above -- different date, same price, real zero return.
    strict_1.default.equal((0, performance_1.calcRet)(100, "2026-08-14", 100, "2026-08-13"), 0);
});
(0, node_test_1.test)("buildPriceIndex + priceAt reproduce the 2026-08-17 stale-duplicate incident, and computeReturnPeriods guards it", () => {
    // Reproduces the actual bug: Friday 2026-08-14 closed at 305.26, and a
    // broken sync mis-dated that same stale quote under Sat/Sun/Mon as if
    // they were three fresh closes at a duplicated price of 305.93.
    const rows = [
        { ticker: "AAPL", price_date: "2026-08-14", close_price: 305.26 },
        { ticker: "AAPL", price_date: "2026-08-15", close_price: 305.93 },
        { ticker: "AAPL", price_date: "2026-08-16", close_price: 305.93 },
        { ticker: "AAPL", price_date: "2026-08-17", close_price: 305.93 },
    ];
    const index = (0, performance_1.buildPriceIndex)(rows);
    const series = index.get("AAPL");
    strict_1.default.ok(series);
    // Before cleanup: today (08-17) and "1 day ago" (08-16) are DIFFERENT
    // rows that happen to carry the same duplicated price -- this is a
    // real (if wrong) input, and calcRet correctly still returns 0 for it,
    // because from calcRet's point of view alone it cannot tell a
    // duplicate-data bug from a genuinely flat day between two distinct
    // dates. That distinction has to be fixed upstream (which it now is,
    // in sync_instruments.py) -- this module's guard protects a different,
    // narrower case: literally the same date compared to itself.
    const cur = (0, performance_1.priceAt)(series, "2026-08-17", 5);
    const d1 = (0, performance_1.priceAt)(series, "2026-08-16", 5);
    strict_1.default.equal((0, performance_1.calcRet)(cur.price, cur.date, d1.price, d1.date), 0);
    // After cleanup (the fix actually shipped): the two stale duplicate
    // rows (08-16, 08-17) are deleted, so both "today" and "1 day ago"
    // fall back to the SAME real last trading day (08-14) -- and the
    // same-date guard now correctly reports "no fresh data" (null)
    // instead of a confident +0.00%.
    const cleaned = (0, performance_1.buildPriceIndex)([rows[0]]).get("AAPL");
    const cur2 = (0, performance_1.priceAt)(cleaned, "2026-08-17", 5);
    const d1b = (0, performance_1.priceAt)(cleaned, "2026-08-16", 5);
    strict_1.default.equal(cur2.date, "2026-08-14");
    strict_1.default.equal(d1b.date, "2026-08-14");
    strict_1.default.equal((0, performance_1.calcRet)(cur2.price, cur2.date, d1b.price, d1b.date), null);
    const periods = (0, performance_1.computeReturnPeriods)(cleaned, {
        today: "2026-08-17",
        curMaxGapDays: 5,
        d1MaxGapDays: 5,
        d7MaxGapDays: 5,
        d1mMaxGapDays: 7,
        ytdMaxGapDays: 10,
    });
    strict_1.default.equal(periods.perf_1d, null);
});
(0, node_test_1.test)("calcRet rejects an implausible magnitude instead of returning a confident garbage number", () => {
    // Reproduces the real RHM incident (vega-fms Rebalance tab, 2026-08-18):
    // instrument_prices had exactly one row for ticker "RHM" -- 2026-08-12,
    // close_price 1.145 -- a wrong-instrument price fetched under a bad
    // Yahoo ticker resolution, sitting just inside the 1D leg's 5-day gap
    // tolerance. cur=1218.20 (the real, correct current price) vs
    // hist=1.145 (the garbage row) produced a genuine +106,293% before this
    // guard existed.
    const cur = 1218.2;
    const hist = 1.145;
    const rawPct = ((cur - hist) / hist) * 100;
    strict_1.default.ok(rawPct > 100000); // sanity: this really is the huge number
    strict_1.default.equal((0, performance_1.calcRet)(cur, "2026-08-18", hist, "2026-08-12"), null);
});
(0, node_test_1.test)("calcRet still allows a large but plausible move through the default bound", () => {
    // A stock tripling (+200%) or falling 90% (-90%) are real, if rare,
    // events -- DEFAULT_MAX_ABS_RETURN_PCT must not clip those.
    strict_1.default.equal((0, performance_1.calcRet)(300, "2026-08-18", 100, "2026-08-17"), 200);
    strict_1.default.equal((0, performance_1.calcRet)(10, "2026-08-18", 100, "2026-08-17"), -90);
});
(0, node_test_1.test)("calcRet's magnitude bound is overridable per call", () => {
    strict_1.default.equal((0, performance_1.calcRet)(1000, "2026-08-18", 100, "2026-08-17", 500), null);
    strict_1.default.equal((0, performance_1.calcRet)(1000, "2026-08-18", 100, "2026-08-17", 2000), 900);
});
(0, node_test_1.test)("computeReturnPeriods with no series at all returns all nulls, not a throw", () => {
    const periods = (0, performance_1.computeReturnPeriods)(undefined, {
        today: "2026-08-17",
        curMaxGapDays: 5,
        d1MaxGapDays: 5,
        d7MaxGapDays: 5,
        d1mMaxGapDays: 7,
        ytdMaxGapDays: 10,
    });
    strict_1.default.deepEqual(periods, {
        perf_1d: null,
        perf_7d: null,
        perf_1m: null,
        perf_ytd: null,
    });
});
