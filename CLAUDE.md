# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The one constraint that shapes everything

**The frontend must run on iOS 9.3 WebKit** (a wall-mounted iPad is the primary target). This is not a nice-to-have — it dictates the entire frontend architecture and is easy to break accidentally, because everything below is valid CSS/JS that simply fails on that engine.

Banned in `frontend/`:

| Feature | Available from | Use instead |
|---|---|---|
| flexbox `gap` | iOS 14.1 | adjacent-sibling margins: `.row > * + * { margin-left: … }` |
| CSS Grid | iOS 10.3 | flexbox with `calc(N% - gutter)` widths |
| `clamp()` / `min()` / `max()` | iOS 11.3–13.4 | fixed values per breakpoint |
| `var()` **inside** `calc()` | buggy in Safari 9.1–11 | a literal `rem`, with a comment noting the coupling |
| `object-fit` | iOS 10 | already wrapped in `@supports not (object-fit: cover)` |
| `env(safe-area-inset-*)` | iOS 11.2 | fine, but a plain fallback **must** be declared first |
| ES6+ syntax/APIs | — | ES5 only: `var`, `function`, XHR. No arrow fns, `let`/`const`, template literals, `Promise`, `fetch`, `Object.assign`, `Array.includes`, `NodeList.forEach` |

Allowed and used heavily: CSS custom properties (iOS 9.3), `rem` (iOS 4), `calc()` (iOS 6), `@media`, `@supports`, `.dataset`, `orientationchange`.

Custom properties **cannot** appear in `@media` conditions (`@media (min-width: var(--bp))` is invalid) — breakpoint values stay literal.

## Commands

```bash
npm run dev                  # nodemon on :3000 (backend also serves frontend/ statically)
npm start                    # plain node

npm test                     # jest: backend + frontend unit tests
npm run test:backend         # supertest against the express routes
npm run test:frontend        # jsdom; includes tests/frontend/es5-compat.test.js
npx jest -t "name"           # single test by name

npm run test:visual          # playwright screenshot regression (67 shots)
npm run test:visual:update   # re-baseline after an INTENDED visual change
npm run test:visual:capture  # re-record tests/visual/fixtures from a live backend on :3000
```

`.env` is optional and gitignored; copy `.env.example`. Without `SETTINGS_PIN`/`DEVICES_PIN` the PIN gate reports `required:false` and Settings/devices open freely.

## Architecture

**Backend** (`backend/`) — Express. `server.js` serves `frontend/` statically and mounts one router per integration under `/api/*` (`ha`, `jf`, `px`, `weather`, `markets`, `settings`, `config`, `auth`). Routers are thin credential-holding proxies to Home Assistant / Jellyfin / Proxmox / Open-Meteo / Yahoo Finance, so the browser never holds tokens. Persistence is a single JSON file (`data/settings.json`, gitignored) — no database despite `mongoose` being in `package.json`.

**Frontend** (`frontend/`) — **no build step.** Four hand-authored files: `index.html`, `css/main.css`, `js/widgets.js`, `js/app.js`.

There is no module system, so **load order is the dependency graph**: `widgets.js` must come before `app.js` in `index.html` (enforced by a test in `es5-compat.test.js`). `widgets.js` only *defines* things — it fires no request at parse time and resolves `window._xhr` and friends when a widget actually renders, so the ordering never becomes a race.

`app.js` is a sequence of IIFE modules (HOME, MARKETS, WEATHER, JELLYFIN, PROXMOX, FEATURES, APPEARANCE), each self-contained. They communicate **only** through a small set of `window._*` globals — this is the app's internal API and the thing to read first when tracing cross-tab behaviour:

- `window._xhr(method, url, body, cb)` — the single HTTP entry point (XHR, not fetch). Everything must go through it: this is where the feature-disable gate lives.
- `window._showPage` / `window._currentPage` — tab routing
- `window._onSettingsLoad(cb)` — modules register here to receive settings on load
- `window._toast`, `window._openPinPrompt`, `window._guardDeviceAction`, `window._openLightSheet`
- `window._homeRefresh`, `window._syncHACard`, `window._mergeHAEntities` — Home/Smart-Home state sync
- `window._WIDGETS` — the Home widget registry (see below)

### Home widgets (`js/widgets.js`)

The Home tab is one wrapping flex grid (`.w-grid`) of cards, built from the `home_widgets` array in settings. `widgets.js` holds the registry, the card shell, and every widget definition; `app.js`'s HOME module only decides *what* appears and in *what order*.

- **A widget definition** is `{ type, title, page, wide, aggregate, flush, refreshSec, render(ctx) }`. `render` fills `ctx.body` and **must be safe to call repeatedly on the same ctx** — the refresh scheduler re-runs it into the existing shell.
- **`aggregate: true`** means every `home_widgets` entry of that type collapses into one card (Smart Home, Markets). Otherwise it is one card per entry.
- **`_WIDGETS.plan(widgets)`** turns saved settings into the cards to render, and **silently drops types it doesn't know**. This matters: `markets` and `server` entries were writable from Settings long before anything rendered them, so real `settings.json` files contain entries older builds ignored. Never make an unknown type throw.
- **One shared refresh scheduler** lives in HOME. Widgets declare `refreshSec` instead of calling `setInterval`; the timer goes quiet whenever Home is not the visible tab. This runs 24/7 on a wall panel — do not reintroduce per-widget timers.
- Adding a widget: register it in `widgets.js`, add its `html.light` overrides (the light theme is explicit overrides, not tokens), add a fixture to `tests/visual/fixtures/` plus a `_manifest.json` entry, and add the entry to the fixture `settings.json` so the visual suite actually renders it.

Every page lives in `index.html` as a `.page` div, shown/hidden by tab; nothing is routed or lazily loaded.

### Weather tab

Four blocks off one `/api/weather/forecast` call: hero, a scrollable next-24-hours strip, a wrapping grid of metric tiles (2 / 3 / 4 up), and a 10-day list whose range bars are all scaled against the same min–max span — that shared scale is what makes the ten rows comparable, so don't switch them to per-row scaling.

**The route pre-formats every label the UI prints**: `clock`, `weekday`, `sunriseTime`, `sunsetTime`, plus `sunriseMin`/`sunsetMin`/`currentMin` for the sun arc. This is not incidental — Open-Meteo returns timezone-less local ISO (`2026-08-31T14:00`), which iOS 9 WebKit parses **as UTC** under the ES5 rule, so any hour label the browser derived would be shifted by the location's offset. The frontend must never construct a `Date` from an API string; add a derived field to the route instead.

The hourly series is sliced server-side from the current hour (it arrives starting at local midnight, so half of it is already history by mid-afternoon). The forecast cache key carries a shape version (`forecast_v3_…`) — entries live 12 hours, so widening the payload without bumping it serves the old shape for half a day after a deploy.

**The tab is a day browser.** Tapping a row in the 10-day list re-points the reference-day bar, hero, hourly strip and metric tiles at that day; the list stays put as the picker and marks the selection. Switching days never refetches — it all comes from the cached payload. Two data sources feed the strip: `hourly` is the next 24 hours from now (richer per entry, crosses midnight, today only) and `hoursByDate` is every hour grouped by local date (trimmed to five fields to keep the payload at ~24 KB rather than ~50 KB).

Index 0 is the only day with live data, so **every live-only affordance needs an explicit non-today branch**: the hero's `as of HH:MM`, the sun-arc marker, and the humidity / pressure / cloud-cover tiles (which have no daily aggregate and are omitted rather than averaged). Rendering them for a future day puts them at position zero, where they read as real. `wx.selectedDayIndex` resets inside `loadForecastForLocation`, not on tab entry — the one-off location search and the Settings default both land there.

The forecast rows are real `<button>` elements. Safari 9 applies its own button metrics, so the reset needs `font: inherit` and an explicit width, or the row's height and alignment shift on the device and nowhere else.

### CSS design system (`css/main.css`)

A `:root` token layer (~72 tokens: colour, type, spacing, radius) drives everything. Rules should reference `var(--token)`, not raw values.

- **Type, spacing and radius are all in `rem`**, so root `font-size` is a single zoom lever. The text-size accessibility setting is therefore just `html.fs-large { font-size: 18px }` / `html.fs-xl { font-size: 20px }` — it scales the whole UI proportionally, not only text. Do not reintroduce per-selector font-size overrides.
- **Theme** is `html.light` + ~190 explicit override rules. These have *not* been collapsed into token redefinitions: the light theme is under-specified (many tokens have usages with no light override), so folding them would silently change rendering.
- **Grid gutters are coupled**: `width: calc(25% - 0.5rem)` where `0.5rem` is exactly 2× the card's `margin`. Change one and you must change the other, or rows wrap early once the text-size lever scales the margin. The literal is deliberate (see `var()`-in-`calc()` above). `css-compat.test.js` asserts this coupling for `.w-card`.
- **Wrapping grids use uniform margins, not `> * + *`.** The sibling-margin idiom is correct for a single-line row and wrong for a wrapping one — the first card of every wrapped row loses its gutter. `.w-grid` and `.devices-grid` therefore give every card the same margin and subtract 2× that from the width.
- **Breakpoints**: content is full-bleed up to 1400px so a wall-mounted iPad (up to 1366px in landscape) uses the whole panel; only above 1400px does it cap and centre. The Server tab (`#page-server`) is exempt entirely — it is a master/detail split and runs full-bleed at every width.
- **The Home widget grid** is 1 column below 600px, 2 from 600px, 3 from 1024px, with `.w-card--wide` claiming a double cell (full width until there are three columns, then two thirds — so wide + normal fills a row exactly). Device tiles nested in a `.w-body` get their own scale (`.w-body .device-card`), since the page-level widths would render slivers inside a third-width card.
- **Short viewports**: the landscape/`max-height: 500px` block at the end of the widget CSS trims the greeting, shrinks tiles and hides `.w-optional` rows. It sits last on purpose — its selectors match the base rules' specificity exactly, so it only wins by source order.
- Media-query overrides must be placed **after** the base rule; they share its specificity, so source order decides.

### Visual regression harness (`tests/visual/`)

The safety net for CSS work, since there is no build step and no other coverage of rendering. 67 screenshots: 7 tabs across 6 viewports, plus a light-theme and two text-size passes, plus four states no tab shot reaches (the PIN overlay, the Jellyfin detail, and the weather day detail in both themes).

Runs are hermetic: a dependency-free static server serves `frontend/`, all `/api/*` is replayed from `tests/visual/fixtures/`, `Date` is frozen, and theme/text-size are seeded into `localStorage` before first paint. No backend or network needed.

Thresholds in `playwright.config.js` are deliberately far tighter than Playwright's defaults (`threshold: 0.04`) — the 0.2 default silently missed a 42/255 colour change on 11px text, which is useless for a token refactor. Do not loosen them.

`capture-fixtures.js` redacts integration credentials before writing, and **fails the capture** if any real value from `data/settings.json` reaches a fixture. Fixtures are git-tracked and do contain real device/VM/media names.

The fixture `settings.json` decides which widgets the Home shots render, so it is part of the test surface, not just captured output. It was previously hidden by a bare `settings.json` line in `.gitignore` — the real credentials store is covered by the `data/` rule instead, so that line is gone and the fixture is tracked. Keep it that way, or the Home baselines stop reproducing on a fresh clone.

`tests/frontend/css-compat.test.js` is the static half of the iOS 9.3 guard: it fails on `gap`, CSS Grid, `clamp()`/`min()`/`max()`, `var()` inside `calc()`, and a bare `env(safe-area-inset-*)`. These are all valid CSS that parses everywhere and silently does nothing on the target engine, so nothing else would catch them. `es5-compat.test.js` covers every file in `frontend/js/`, not just `app.js`.

## Release

CI (`.github/workflows/build.yml`) triggers on **any tag push** and builds + publishes a Docker image to GHCR. Pushing a tag is therefore a publish action. Tags are plain `0.0.x`.
