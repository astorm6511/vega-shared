# Vega Shared

Shared logic used across Vega applications. Today this is one module:
rebalance-tab performance/return calculations against `instrument_prices`
(`src/performance.ts`) — previously hand-duplicated, and independently
drifting, in both vega-pms (`AccountRebalance.tsx`) and vega-fms
(`rebalance-quant/route.ts`).

## Used by
- vega-pms (Portfolio Management System)
- vega-fms (Fund Management System)

## What's in here

`src/performance.ts` — the return-calc "recipe": binary-search date
lookup (`nearestOnOrBefore`), `priceAt` / `buildPriceIndex` for turning
raw `instrument_prices` rows into a per-ticker series, `calcRet` (with a
same-underlying-row guard — see the docstring in that file for the
2026-08-17 incident this closes off), and `computeReturnPeriods`, which
wires all of the above into the four standard columns (1D/7D/1M/YTD%).
Each app still fetches its own `instrument_prices` rows however it
prefers (windowed vs. one wide range) and still sets its own gap
tolerances — this package doesn't force the two apps to agree on
tuning, only on the mechanics.

`dist/` is the compiled, committed output (plain CommonJS + `.d.ts`), so
consumers don't need this package's own devDependencies (TypeScript) to
install it. It's also rebuilt automatically on install via a `prepare`
script, so a stale `dist/` self-heals as long as `npm`/`pnpm` run it
(git-based installs run `prepare` by default).

## Installing this in vega-pms or vega-fms

This repo is **private**, so a plain `git+https://github.com/...`
dependency needs credentials at install time — Vercel's GitHub
integration does *not* automatically supply credentials for a
*different* private repo than the one it's building. Setup (one-time,
per consuming app):

1. **Generate a token** (Adrian, in your own GitHub account — this is a
   credential and has to be created by you, not by an assistant):
   GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained token → repository access limited to just
   `astorm6511/vega-shared` → permission: **Contents: Read-only**. Copy
   the token once; GitHub won't show it again.

2. **Add it as an env var in each Vercel project's settings**
   (vega-pms and vega-fms, separately) — Project → Settings →
   Environment Variables:
   - Name: `VEGA_SHARED_GH_TOKEN`
   - Value: the token from step 1
   - Environments: at minimum Production + Preview (add Development
     too if you build locally against the git dependency rather than
     `pnpm link`)

3. **Add a `preinstall` script** to the consuming app's `package.json`
   so `git` rewrites any `github.com` URL to use that token, without
   the token ever being written to a file in the repo:
   ```json
   "scripts": {
     "preinstall": "git config --global url.\"https://${VEGA_SHARED_GH_TOKEN}@github.com/\".insteadOf \"https://github.com/\""
   }
   ```
   (If the app already has a `preinstall` script, append this as an
   additional command rather than replacing it.)

4. **Add the dependency**, pinned to a tag rather than a branch so a
   future push to `vega-shared` can't silently change either app's
   build:
   ```json
   "dependencies": {
     "vega-shared": "github:astorm6511/vega-shared#v0.1.0"
   }
   ```

Locally (outside Vercel), the simplest thing is `pnpm link` against a
local clone instead of steps 1–3 — see each app's own notes, since local
dev doesn't need the token dance at all.

## Releasing a new version

Bump `version` in `package.json`, run `npm run build` (or rely on
`prepare`), commit `dist/`, tag it (`git tag vX.Y.Z && git push --tags`),
then bump the `#vX.Y.Z` pin in whichever app(s) should pick it up.
Pinning to a tag (not a branch, not `main`) is deliberate — it means a
change here never silently changes vega-pms's or vega-fms's build until
someone explicitly bumps that app's pin.

## Testing

```
npm install
npm test
```
