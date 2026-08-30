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

npm run test:visual          # playwright screenshot regression (65 shots)
npm run test:visual:update   # re-baseline after an INTENDED visual change
npm run test:visual:capture  # re-record tests/visual/fixtures from a live backend on :3000
```

`.env` is optional and gitignored; copy `.env.example`. Without `SETTINGS_PIN`/`DEVICES_PIN` the PIN gate reports `required:false` and Settings/devices open freely.

## Architecture

**Backend** (`backend/`) — Express. `server.js` serves `frontend/` statically and mounts one router per integration under `/api/*` (`ha`, `jf`, `px`, `weather`, `markets`, `settings`, `config`, `auth`). Routers are thin credential-holding proxies to Home Assistant / Jellyfin / Proxmox / Open-Meteo / Yahoo Finance, so the browser never holds tokens. Persistence is a single JSON file (`data/settings.json`, gitignored) — no database despite `mongoose` being in `package.json`.

**Frontend** (`frontend/`) — **no build step.** Three hand-authored files: `index.html`, `css/main.css`, `js/app.js`.

`app.js` is a sequence of IIFE modules (HOME, MARKETS, WEATHER, JELLYFIN, PROXMOX, FEATURES, APPEARANCE), each self-contained. They communicate **only** through a small set of `window._*` globals — this is the app's internal API and the thing to read first when tracing cross-tab behaviour:

- `window._xhr(method, url, body, cb)` — the single HTTP entry point (XHR, not fetch)
- `window._showPage` / `window._currentPage` — tab routing
- `window._onSettingsLoad(cb)` — modules register here to receive settings on load
- `window._toast`, `window._openPinPrompt`, `window._guardDeviceAction`, `window._openLightSheet`
- `window._homeRefresh`, `window._syncHACard`, `window._mergeHAEntities` — Home/Smart-Home state sync

Every page lives in `index.html` as a `.page` div, shown/hidden by tab; nothing is routed or lazily loaded.

### CSS design system (`css/main.css`)

A `:root` token layer (~72 tokens: colour, type, spacing, radius) drives everything. Rules should reference `var(--token)`, not raw values.

- **Type, spacing and radius are all in `rem`**, so root `font-size` is a single zoom lever. The text-size accessibility setting is therefore just `html.fs-large { font-size: 18px }` / `html.fs-xl { font-size: 20px }` — it scales the whole UI proportionally, not only text. Do not reintroduce per-selector font-size overrides.
- **Theme** is `html.light` + ~190 explicit override rules. These have *not* been collapsed into token redefinitions: the light theme is under-specified (many tokens have usages with no light override), so folding them would silently change rendering.
- **Grid gutters are coupled**: `width: calc(25% - 0.5rem)` where `0.5rem` is exactly 2× the card's `margin`. Change one and you must change the other, or rows wrap early once the text-size lever scales the margin. The literal is deliberate (see `var()`-in-`calc()` above).
- **Breakpoints**: content is full-bleed up to 1400px so a wall-mounted iPad (up to 1366px in landscape) uses the whole panel; only above 1400px does it cap and centre. The Server tab (`#page-server`) is exempt entirely — it is a master/detail split and runs full-bleed at every width.
- Media-query overrides must be placed **after** the base rule; they share its specificity, so source order decides.

### Visual regression harness (`tests/visual/`)

The safety net for CSS work, since there is no build step and no other coverage of rendering. 65 screenshots over 7 tabs × 6 viewports × 2 themes × 3 text sizes.

Runs are hermetic: a dependency-free static server serves `frontend/`, all `/api/*` is replayed from `tests/visual/fixtures/`, `Date` is frozen, and theme/text-size are seeded into `localStorage` before first paint. No backend or network needed.

Thresholds in `playwright.config.js` are deliberately far tighter than Playwright's defaults (`threshold: 0.04`) — the 0.2 default silently missed a 42/255 colour change on 11px text, which is useless for a token refactor. Do not loosen them.

`capture-fixtures.js` redacts integration credentials before writing, and **fails the capture** if any real value from `data/settings.json` reaches a fixture. Fixtures are git-tracked and do contain real device/VM/media names.

## Release

CI (`.github/workflows/build.yml`) triggers on **any tag push** and builds + publishes a Docker image to GHCR. Pushing a tag is therefore a publish action. Tags are plain `0.0.x`.
