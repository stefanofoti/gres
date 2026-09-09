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
| flex centring on a `<button>` | iOS 11 | centre the child as inline content — `line-height: 0` + `text-align: center` on the button, `vertical-align: middle` on the child. A button is the one element whose flex container Safari 9 does not honour; `display: block` on the child then takes it out of the centred inline flow and it sits hard left. Keep the flex declarations, just never let them be the only thing centring it (`.btn-icon-only`, `.wx-icon-btn`) |
| `object-fit` | iOS 10 | already wrapped in `@supports not (object-fit: cover)` |
| `env(safe-area-inset-*)` | iOS 11.2 | fine, but a plain fallback **must** be declared first |
| `document.hidden` / `visibilitychange` | iOS 10.3 | `window._appHidden()` / `window._onAppVisible(cb)` — app.js resolves the `webkit`-prefixed pair once. The unprefixed event never fires on 9.3 and `document.hidden` reads `undefined`, so a `if (document.hidden) return` guard silently stops guarding |
| ES6+ syntax/APIs | — | ES5 only: `var`, `function`, XHR. No arrow fns, `let`/`const`, template literals, `Promise`, `fetch`, `Object.assign`, `Array.includes`, `NodeList.forEach` |

Allowed and used heavily: CSS custom properties (iOS 9.3), `rem` (iOS 4), `calc()` (iOS 6), `@media`, `@supports`, `.dataset`, `orientationchange`.

Custom properties **cannot** appear in `@media` conditions (`@media (min-width: var(--bp))` is invalid) — breakpoint values stay literal.

## Commands

```bash
npm run dev                  # nodemon on :3000 — nodemon is NOT a project dep, install it yourself
npm start                    # plain node on :3000 (backend also serves frontend/ statically)

npm test                     # jest: backend + frontend unit tests
npm run test:backend         # supertest against the express routes
npm run test:frontend        # jsdom; includes tests/frontend/es5-compat.test.js
npx jest -t "name"           # single test by name

npm run test:visual          # playwright screenshot regression (74 shots)
npm run test:visual:update   # re-baseline after an INTENDED visual change
npm run test:visual:capture  # re-record tests/visual/fixtures from a live backend on :3000
```

`.env` is optional and gitignored; copy `.env.example`. Without `SETTINGS_PIN`/`DEVICES_PIN` the PIN gate reports `required:false` and Settings/devices open freely.

## Architecture

**Backend** (`backend/`) — Express. `server.js` serves `frontend/` statically and mounts one router per integration under `/api/*` (`ha`, `jf`, `px`, `weather`, `markets`, `settings`, `config`, `auth`). Routers are thin credential-holding proxies to Home Assistant / Jellyfin / Proxmox / Open-Meteo / Yahoo Finance, so the browser never holds tokens. Persistence is a single JSON file (`data/settings.json`, gitignored) — no database.

**Frontend** (`frontend/`) — **no build step.** Four hand-authored files: `index.html`, `css/main.css`, `js/widgets.js`, `js/app.js`.

There is no module system, so **load order is the dependency graph**: `widgets.js` must come before `app.js` in `index.html` (enforced by a test in `es5-compat.test.js`). `widgets.js` only *defines* things — it fires no request at parse time and resolves `window._xhr` and friends when a widget actually renders, so the ordering never becomes a race.

`app.js` is a sequence of IIFE modules (HOME, MARKETS, WEATHER, JELLYFIN, PROXMOX, FEATURES, APPEARANCE, UPDATE), each self-contained. They communicate **only** through a small set of `window._*` globals — this is the app's internal API and the thing to read first when tracing cross-tab behaviour:

- `window._xhr(method, url, body, cb)` — the single HTTP entry point (XHR, not fetch). Everything must go through it: this is where the feature-disable gate lives.
- `window._showPage` / `window._currentPage` — tab routing
- `window._onTabActivate(pageId, cb)` — modules register here to be told their tab was opened, just before its page is shown. Tabs activate on `touchend` (`bindTap`), not on the `click` iOS holds back ~350ms, so a capture-phase `click` listener on the tab element no longer sees a tab being opened
- `window._onSettingsLoad(cb)` — modules register here to receive settings on load
- `window._toast`, `window._openPinPrompt`, `window._guardDeviceAction`, `window._openLightSheet`
- `window._homeRefresh`, `window._syncHACard`, `window._mergeHAEntities` — Home/Smart-Home state sync
- `window._haDeviceTile(entity)` / `window._haGhostTile(id, label)` — the device tile, built in one place (see below)
- `window._haAllOff(entities)` / `window._haEntitySnapshot()` — switch a set of devices off, and the live snapshot to pick that set from
- `window._WIDGETS` — the Home widget registry (see below)

### Home widgets (`js/widgets.js`)

The Home tab is one wrapping flex grid (`.w-grid`) of cards, built from the `home_widgets` array in settings. `widgets.js` holds the registry, the card shell, and every widget definition; `app.js`'s HOME module only decides *what* appears and in *what order*.

The Smart Home widget is the one that reaches across: its **tiles** are built by `app.js`'s SMARTHOME module and fetched through `window._haDeviceTile`, because everything a tile needs already lives there — `state.toggling`, `callService`, `applyCardColor`, the light sheet. `widgets.js` used to build its own near-copy, kept in step by hand through three more globals, and the two had drifted: only the tab's tiles had the in-flight toggle guard, the busy state, the rollback on a failed call and the colour tint. What the widget still owns is which entities appear and the header count. `tests/frontend/dom.test.js` asserts the two render structurally identical tiles, so the second renderer cannot grow back.

- **A widget definition** is `{ type, title, page, wide, aggregate, flush, refreshSec, render(ctx) }`. `render` fills `ctx.body` and **must be safe to call repeatedly on the same ctx** — the refresh scheduler re-runs it into the existing shell.
- **`aggregate: true`** means every `home_widgets` entry of that type collapses into one card (Smart Home, Markets). Otherwise it is one card per entry.
- **`_WIDGETS.plan(widgets)`** turns saved settings into the cards to render, and **silently drops types it doesn't know**. This matters: `markets` and `server` entries were writable from Settings long before anything rendered them, so real `settings.json` files contain entries older builds ignored. Never make an unknown type throw.
- **One shared refresh scheduler** lives in HOME. Widgets declare `refreshSec` instead of calling `setInterval`; the timer goes quiet whenever Home is not the visible tab. This runs 24/7 on a wall panel — do not reintroduce per-widget timers.
- Adding a widget: register it in `widgets.js`, add its `html.light` overrides (the light theme is explicit overrides, not tokens), add a fixture to `tests/visual/fixtures/` plus a `_manifest.json` entry, and add the entry to the fixture `settings.json` so the visual suite actually renders it.

Every page lives in `index.html` as a `.page` div, shown/hidden by tab; nothing is routed or lazily loaded.

### Smart Home tab and the light sheet

Three things here are invariants rather than choices, and all three are easy to break by accident.

**`tileSignature(entity)` is the tile's cache key.** The 15-second poll compares it against the tile's `data-sig` and does nothing at all when they match — which is what keeps a panel that is static for hours from doing a style recalc and a gradient repaint every 15 seconds. It must therefore list *everything* `syncCardFromEntity` renders and nothing it doesn't. Render a new attribute on a tile without adding it to the signature and the tile will simply never update for it.

**`state.toggling[eid]` is `{ inFlight, expect, until }`, not a boolean.** `inFlight` blocks a second tap while the request is out; `expect` + `until` stop the poll overwriting an optimistic state until HA agrees or `SETTLE_MS` passes. These were one flat 500ms timer, which is why every tap used to leave a dimmed, dead tile behind it. `.busy` now appears only if a call is still out after `BUSY_AFTER_MS`.

The poll no longer stops while the sheet is open. `mergeEntityStates` skips just the entity the sheet is editing — that one is being changed in place and sent on a throttle, so a poll landing mid-drag would overwrite the value the finger is still moving — and everything else stays live. The blanket guard this replaces froze the whole grid, so a light switched by an automation elsewhere went unnoticed for as long as the sheet stayed up.

**A plain tile is a `div` with `role="button"`, and `bindButtonRole` is what makes that honest.** It adds the role, a `tabindex`, and Enter/Space handling — the last of which is not optional: `role="button"` without a keyboard announces as a button and then refuses to be operated as one. The keyboard half is deliberately *not* in `bindTap`, which is also used on real `<button>`s that already activate on Enter and Space; binding `keydown` there too would fire those handlers twice. `aria-pressed` goes on the tile for a plain device but on the inner `.light-main-toggle` for a light, since a light tile is a div hosting two real buttons and a button may not contain buttons — `pressHost()` picks the right one and `setPressed()` only writes where the attribute already exists, so an offline tile that never had a role does not get a state it cannot honour.

**`bindTap` is not the PIN keypad's `bindFastInteraction`.** Both make a control answer on release instead of waiting for the delayed synthetic `click`, but the keypad's version cancels the touch on `touchstart`, which it can afford in a fixed overlay with nothing behind it. A device tile sits in a scrolling page, so cancelling there would stop the grid scrolling wherever a finger landed. `bindTap` lets the touch run and claims it on `touchend` only if it stayed within `TAP_SLOP_PX` and `TAP_MAX_MS`. Don't "simplify" one into the other.

The sheet's colour wheel is drawn on first disclosure, never on open: it is 360 canvas wedges plus one white radial gradient (exactly equivalent to HSV at V=1, where saturation is the normalised radius). It replaced a hand-written 57,600-pixel raster that ran synchronously inside the open path and stuttered the slide-up once per session.

`allOff` takes the candidate entities rather than deciding them, because the two callers legitimately mean different sets: the tab acts on everything it shows (`state.entities`), the widget only on what is pinned. It sends one service call per distinct service with `entity_id` as an array. The backend's protection check reads `entity_id` in string, array and `target` form, so batching cannot slip a locked device past the PIN. The button reads the live snapshot through `window._haEntitySnapshot()` rather than the `ctx.entities` it was bound with — that list is empty on a fresh launch, since the card renders before the first HA response arrives.

### Knowing when the page is stale

`index.html` is requested once per app launch and never again — no router, no build step — so on the wall panel a deploy stays invisible until someone quits and reopens the web app. Service workers would be the normal answer and need iOS 11.3, so instead the version is compared:

- `backend/lib/appVersion.js` is the one release identifier (package.json's `version`, which CI refuses to publish unless it matches the pushed tag).
- `backend/lib/indexHtml.js` renders `index.html` with that version substituted into `__APP_VERSION__` and sends it `no-cache`. It is registered **before** `express.static`, which would otherwise answer `/` with the raw file and leak the placeholder. The SPA fallback uses the same handler.
- `/api/config` reports the version the **server** is on. The UPDATE module in `app.js` compares the two: a mismatch means the browser is running a cached page.

Nothing reloads by itself — the module only sets the Settings → Software readout and toasts once. An unattended reload would drop the visible state, re-lock the Settings PIN (in-memory only) and, since `index.html` pulls Chartist and the fonts from a CDN, could land while the internet is down and leave the panel worse off than the stale-but-working page. Self-host those two before revisiting that decision.

Served without substitution (opening the file directly, a plain static host) the placeholder survives and the check disables itself rather than reading `__APP_VERSION__` as an old release. `tests/visual/static-server.js` stamps a pinned `0.0.0-test` instead, matching `fixtures/config.json`, for the same reason `Date` is frozen — the Settings tab prints the version, and the real one would invalidate that baseline every release. `capture-fixtures.js` pins it too.

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

The safety net for CSS work, since there is no build step and no other coverage of rendering. 74 screenshots: 7 tabs across 6 viewports, plus a light-theme and two text-size passes, plus eleven states no tab shot reaches — the PIN overlay, the Jellyfin detail, the weather day detail in both themes, the light sheet in four (colour-temperature-only in both themes, colour-capable, and colour-capable with the wheel disclosed), the Proxmox VM action row for a running QEMU guest (the state in which every button appears at once), the Settings widget picker with an accordion expanded, and a Jellyfin grid with the missing-poster mark beside real posters.

Those last three exist because each is a list of drawn icons that no tab shot could reach — one behind a collapsed accordion, one needing an item Jellyfin has no image for, one needing a VM selected. All three carried typographic glyphs until recently, and the Shutdown button's U+23FB survived unrenderable on the device precisely because nothing looked at it.

A test can serve a state the captured data does not contain by passing `fixtures` to `gotoApp`: a `{ pathname: fn }` map whose function receives the parsed fixture body and returns what to serve instead. It runs *before* the not-captured fallback, so it can also supply a response the fixtures never recorded — the function just receives `{}`. The light-sheet colour shots use it to turn a colour-capable bulb on; the VM action shot uses it to supply a per-VM status, which nothing had ever requested during a capture. It belongs in the spec rather than in the fixture because `capture-fixtures.js` rewrites those files wholesale, so anything hand-added to one is dropped silently at the next capture — the fixture `settings.json` is the deliberate exception, and it is never overwritten.

Runs are hermetic: a dependency-free static server serves `frontend/`, all `/api/*` is replayed from `tests/visual/fixtures/`, `Date` is frozen, and theme/text-size are seeded into `localStorage` before first paint. No backend or network needed.

Thresholds in `playwright.config.js` are deliberately far tighter than Playwright's defaults (`threshold: 0.04`) — the 0.2 default silently missed a 42/255 colour change on 11px text, which is useless for a token refactor. Do not loosen them.

`capture-fixtures.js` redacts integration credentials before writing, and **fails the capture** if any real value from `data/settings.json` reaches a fixture. Fixtures are git-tracked and do contain real device/VM/media names.

The fixture `settings.json` decides which widgets the Home shots render, so it is part of the test surface, not just captured output. It was previously hidden by a bare `settings.json` line in `.gitignore` — the real credentials store is covered by the `data/` rule instead, so that line is gone and the fixture is tracked. Keep it that way, or the Home baselines stop reproducing on a fresh clone.

`tests/frontend/css-compat.test.js` is the static half of the iOS 9.3 guard: it fails on `gap`, CSS Grid, `clamp()`/`min()`/`max()`, `var()` inside `calc()`, and a bare `env(safe-area-inset-*)`. These are all valid CSS that parses everywhere and silently does nothing on the target engine, so nothing else would catch them. `es5-compat.test.js` covers every file in `frontend/js/`, not just `app.js`.

## Release

CI (`.github/workflows/build.yml`) triggers on **any tag push** and builds + publishes a Docker image to GHCR. Pushing a tag is therefore a publish action. Tags are plain `0.0.x`.
