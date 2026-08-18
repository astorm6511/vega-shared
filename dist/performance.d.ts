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
export type PricePoint = {
    price: number | null;
    date: string | null;
};
export type PriceSeries = {
    /** Trading dates with a known close, ascending, "YYYY-MM-DD". */
    datesAsc: string[];
    /** date -> close_price */
    byDate: Map<string, number>;
};
export type InstrumentPriceRow = {
    ticker: string;
    price_date: string;
    close_price: number | null;
};
/**
 * instruments.ticker is often a Bloomberg-style custodian ticker with an
 * exchange/security-type suffix ("ASML US", "MSFT US Equity");
 * instrument_prices is written by the Yahoo sync under the bare root
 * symbol only ("ASML", "MSFT"). Strip the suffix so lookups against
 * instrument_prices land on the row that's actually there.
 */
export declare function rootTicker(ticker: string): string;
/** ISO "YYYY-MM-DD" for `days` calendar days before `fromIso`. */
export declare function isoDaysAgo(fromIso: string, days: number): string;
/**
 * Latest date in a sorted-ascending date list that is <= target, gated by
 * maxGapDays so a long-stale price (delisted instrument, no data yet for
 * a brand-new listing, a data-feed gap) doesn't get silently treated as
 * "current" or "as of the target date." Binary search since a full price
 * history can be thousands of rows per ticker across a rebalance book.
 */
export declare function nearestOnOrBefore(datesAsc: string[], target: string, maxGapDays: number): string | null;
/** Resolve the price (and the date it actually came from) nearest on or
 * before `target`, within `maxGapDays`. Returns both so callers can guard
 * against comparing a value against itself (see `calcRet`). */
export declare function priceAt(series: PriceSeries | undefined, target: string, maxGapDays: number): PricePoint;
/**
 * Percentage return from `hist` to `cur`. Returns null when either price
 * is missing, when `hist` is zero, or when `cur`/`hist` resolved to the
 * exact same underlying date row (see module docstring) — a textually
 * different date with a coincidentally identical close_price still
 * returns a real 0, since that's an actual (if unusual) zero-movement
 * day, not a resolution collision.
 */
export declare function calcRet(cur: number | null, curDate: string | null, hist: number | null, histDate: string | null): number | null;
/**
 * Build a per-ticker { sorted dates, date->close_price } index from raw
 * instrument_prices rows. Both vega-pms and vega-fms fetch this table
 * with different windowing strategies (narrow per-period `.or()` filters
 * vs. one wide paginated range) but need this identical shape downstream
 * — the fetch stays app-specific, the indexing doesn't need to.
 */
export declare function buildPriceIndex(rows: InstrumentPriceRow[]): Map<string, PriceSeries>;
export type ReturnPeriods = {
    perf_1d: number | null;
    perf_7d: number | null;
    perf_1m: number | null;
    perf_ytd: number | null;
};
/**
 * Gap tolerance (in calendar days) per period leg. The two apps currently
 * run with different tolerances (tuned independently, at different
 * times) — this type doesn't force them to match, it just gives both a
 * single place to express and adjust their own tolerance.
 */
export type ReturnPeriodConfig = {
    /** Anchor date for the "current" leg, "YYYY-MM-DD" (usually today, or
     * the book's latest known position/NAV date). */
    today: string;
    curMaxGapDays: number;
    d1MaxGapDays: number;
    d7MaxGapDays: number;
    d1mMaxGapDays: number;
    ytdMaxGapDays: number;
};
/**
 * Computes the four standard rebalance-tab return columns for one
 * ticker's price series. `current` is always re-derived from the same
 * `instrument_prices` series as the historical legs (never taken from a
 * separate `instruments.last_price` column) — comparing two different
 * sources for "current" vs. "N days ago" is exactly what caused the
 * vega-pms source-mismatch bug this module also closes off.
 */
export declare function computeReturnPeriods(series: PriceSeries | undefined, cfg: ReturnPeriodConfig): ReturnPeriods;
