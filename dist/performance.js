"use strict";
/**
 * Rebalance-tab performance/return calculations against `instrument_prices`.
 *
 * This module is the single source of truth for "how do we compute
 * 1D% / 7D% / 1M% / YTD%" — logic that used to be independently
 * hand-written in both vega-pms (`AccountRebalance.tsx`) and vega-fms
 * (`rebalance-quant/route.ts`), and had drifted apart in small but real
 * ways (linear vs binary-search date lookup, and — critically — vega-fms
 * had no protection against the "same underlying row compared to itself"
 * case at all).
 *
 * Background on why the same-date guard in `calcRet` exists: on
 * 2026-08-17, vega-pms's Rebalance tab showed 1D% = +0.00% for every
 * single ticker. The root cause turned out to be upstream, in
 * data-loaders/sync_instruments.py: it stamped every Yahoo price under
 * wall-clock `date.today()` regardless of whether Yahoo actually had a
 * fresh quote, so over a weekend the same stale Friday close got
 * re-inserted as three "new" rows under Aug-15/16/17. `calcRet` then
 * compared two different date rows that happened to carry an identical
 * (duplicated) close_price, and confidently reported "no movement."
 * That root cause is fixed at the source now (sync_instruments.py dates
 * each price by yfinance's `regularMarketTime`, not wall-clock today).
 * The guard here is a second, independent line of defense for the class
 * of bug, not a fix for that specific incident: if `cur` and `hist` ever
 * resolve to the literal same database row (e.g. a genuine weekend/
 * holiday where "today" and "N days ago" both fall back to the same
 * last real trading day), we report "no data" (null) rather than a
 * misleadingly confident 0.00%.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_ABS_RETURN_PCT = void 0;
exports.rootTicker = rootTicker;
exports.isoDaysAgo = isoDaysAgo;
exports.nearestOnOrBefore = nearestOnOrBefore;
exports.priceAt = priceAt;
exports.calcRet = calcRet;
exports.buildPriceIndex = buildPriceIndex;
exports.computeReturnPeriods = computeReturnPeriods;
/**
 * instruments.ticker is often a Bloomberg-style custodian ticker with an
 * exchange/security-type suffix ("ASML US", "MSFT US Equity");
 * instrument_prices is written by the Yahoo sync under the bare root
 * symbol only ("ASML", "MSFT"). Strip the suffix so lookups against
 * instrument_prices land on the row that's actually there.
 */
function rootTicker(ticker) {
    return ticker.trim().split(/\s+/)[0];
}
/** ISO "YYYY-MM-DD" for `days` calendar days before `fromIso`. */
function isoDaysAgo(fromIso, days) {
    return new Date(new Date(fromIso).getTime() - days * 86400000)
        .toISOString()
        .slice(0, 10);
}
/**
 * Latest date in a sorted-ascending date list that is <= target, gated by
 * maxGapDays so a long-stale price (delisted instrument, no data yet for
 * a brand-new listing, a data-feed gap) doesn't get silently treated as
 * "current" or "as of the target date." Binary search since a full price
 * history can be thousands of rows per ticker across a rebalance book.
 */
function nearestOnOrBefore(datesAsc, target, maxGapDays) {
    let lo = 0;
    let hi = datesAsc.length - 1;
    let best = null;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (datesAsc[mid] <= target) {
            best = datesAsc[mid];
            lo = mid + 1;
        }
        else {
            hi = mid - 1;
        }
    }
    if (!best)
        return null;
    const gap = (new Date(target).getTime() - new Date(best).getTime()) / 86400000;
    return gap <= maxGapDays ? best : null;
}
/** Resolve the price (and the date it actually came from) nearest on or
 * before `target`, within `maxGapDays`. Returns both so callers can guard
 * against comparing a value against itself (see `calcRet`). */
function priceAt(series, target, maxGapDays) {
    var _a;
    if (!series)
        return { price: null, date: null };
    const d = nearestOnOrBefore(series.datesAsc, target, maxGapDays);
    if (!d)
        return { price: null, date: null };
    return { price: (_a = series.byDate.get(d)) !== null && _a !== void 0 ? _a : null, date: d };
}
/**
 * A single-listed-equity return whose magnitude exceeds this is far more
 * likely to be bad data (wrong-ticker collision, a decimal/unit mismatch,
 * a stray placeholder price) than a real move — even the most extreme
 * real single-day/week/month/YTD swings for a live, liquid listing don't
 * get near 50x. Confirmed against production data: 2026-08-18, vega-fms's
 * Rebalance tab showed Rheinmetall (RHM) 1D% = +106,293%, traced to
 * instrument_prices having exactly one row for ticker "RHM" (2026-08-12,
 * close_price 1.145) — a wrong-instrument price fetched under a bad
 * Yahoo ticker resolution, sitting just inside the 1D leg's gap
 * tolerance. That underlying data bug is a separate, upstream fix; this
 * bound exists so a bug LIKE it can never render as a confidently wrong
 * number again, regardless of which upstream process caused it.
 */
exports.DEFAULT_MAX_ABS_RETURN_PCT = 5000;
/**
 * Percentage return from `hist` to `cur`. Returns null when either price
 * is missing, when `hist` is zero, when `cur`/`hist` resolved to the
 * exact same underlying date row (see module docstring — a textually
 * different date with a coincidentally identical close_price still
 * returns a real 0, since that's an actual, if unusual, zero-movement
 * day, not a resolution collision), or when the computed magnitude
 * exceeds `maxAbsPct` (see DEFAULT_MAX_ABS_RETURN_PCT above).
 */
function calcRet(cur, curDate, hist, histDate, maxAbsPct = exports.DEFAULT_MAX_ABS_RETURN_PCT) {
    if (cur == null || hist == null || hist === 0)
        return null;
    if (curDate != null && histDate != null && curDate === histDate)
        return null;
    const pct = ((cur - hist) / hist) * 100;
    if (Math.abs(pct) > maxAbsPct)
        return null;
    return pct;
}
/**
 * Build a per-ticker { sorted dates, date->close_price } index from raw
 * instrument_prices rows. Both vega-pms and vega-fms fetch this table
 * with different windowing strategies (narrow per-period `.or()` filters
 * vs. one wide paginated range) but need this identical shape downstream
 * — the fetch stays app-specific, the indexing doesn't need to.
 */
function buildPriceIndex(rows) {
    var _a;
    const byTicker = new Map();
    for (const r of rows) {
        const tk = (_a = r.ticker) === null || _a === void 0 ? void 0 : _a.trim();
        if (!tk || r.close_price == null)
            continue;
        const dt = String(r.price_date).slice(0, 10);
        let m = byTicker.get(tk);
        if (!m) {
            m = new Map();
            byTicker.set(tk, m);
        }
        m.set(dt, r.close_price);
    }
    const out = new Map();
    for (const [tk, byDate] of byTicker) {
        out.set(tk, { datesAsc: [...byDate.keys()].sort(), byDate });
    }
    return out;
}
/**
 * Computes the four standard rebalance-tab return columns for one
 * ticker's price series. `current` is always re-derived from the same
 * `instrument_prices` series as the historical legs (never taken from a
 * separate `instruments.last_price` column) — comparing two different
 * sources for "current" vs. "N days ago" is exactly what caused the
 * vega-pms source-mismatch bug this module also closes off.
 */
function computeReturnPeriods(series, cfg) {
    var _a;
    const cur = priceAt(series, cfg.today, cfg.curMaxGapDays);
    const d1 = priceAt(series, isoDaysAgo(cfg.today, 1), cfg.d1MaxGapDays);
    const d7 = priceAt(series, isoDaysAgo(cfg.today, 7), cfg.d7MaxGapDays);
    const d1m = priceAt(series, isoDaysAgo(cfg.today, 30), cfg.d1mMaxGapDays);
    const ytdTarget = `${new Date(cfg.today).getFullYear()}-01-01`;
    const ytd = priceAt(series, ytdTarget, cfg.ytdMaxGapDays);
    const maxAbsPct = (_a = cfg.maxAbsReturnPct) !== null && _a !== void 0 ? _a : exports.DEFAULT_MAX_ABS_RETURN_PCT;
    return {
        perf_1d: calcRet(cur.price, cur.date, d1.price, d1.date, maxAbsPct),
        perf_7d: calcRet(cur.price, cur.date, d7.price, d7.date, maxAbsPct),
        perf_1m: calcRet(cur.price, cur.date, d1m.price, d1m.date, maxAbsPct),
        perf_ytd: calcRet(cur.price, cur.date, ytd.price, ytd.date, maxAbsPct),
    };
}
