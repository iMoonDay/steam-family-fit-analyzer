# Steam Family Group Helper Extension

This is the Chromium Manifest V3 extension build of the Steam Family Group Helper.

## Local Installation

1. Open Chrome or Edge.
2. Go to `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select this `extension` folder.
6. Open `https://store.steampowered.com/` or a supported Steam Community profile page.

The extension injects an in-page Steam Family helper panel. Clicking the browser toolbar icon opens the panel on supported Steam pages; from other pages, it opens Steam Store in a new tab and shows the panel there.

## Supported Pages

- `https://store.steampowered.com/*`
- `https://steamcommunity.com/profiles/*`
- `https://steamcommunity.com/id/*`

## Notes

- Data is stored in `chrome.storage.local`.
- Extension metadata is localized through `_locales/en/messages.json` and `_locales/zh_CN/messages.json`.
- Steam network requests are proxied by the extension service worker and restricted to the Steam endpoints used by the helper.
- The extension does not upload Steam data to third-party services.

## Structure

- `manifest.json`: Chromium extension metadata, permissions, and script wiring.
- `page-vars.js`: MAIN-world page-state probe for Steam globals.
- `content/bootstrap.js`: content-script runtime adapters for storage, requests, page state, and toolbar messages.
- `content/config.js`: tunable constants, cache keys, sort modes, locale maps, and Steam IDs.
- `content/store-context.js`: Steam language/country detection, cookie reads, and store cache context helpers.
- `content/i18n.js`: localized UI copy.
- `content/styles.js`: injected panel styles.
- `content/http.js`: content-side HTTP helpers, request queueing, and rate-limit errors.
- `content/format.js`: formatting, HTML escaping, JSON attribute parsing, and list-label helpers.
- `content/panel-shell.js`: in-page panel HTML template and element collection.
- `content/menu-state.js`: dropdown/menu open-close state and aria-expanded updates.
- `content/panel-events.js`: panel event binding and keyboard/document-level handlers.
- `content/price-utils.js`: store price response parsing and zero-value checks.
- `content/store-item-batch.js`: Steam Store GetItems request construction and response indexing.
- `content/store-api.js`: shareability fallback reads and original-price Store API reads.
- `content/posters.js`: cover refresh, poster item preparation, canvas rendering, and PNG export.
- `content/steam-api.js`: Steam session discovery, Family API calls, target account parsing, and OwnedGames reads.
- `content/family-library-flow.js`: manual and automatic Steam Family library refresh flow.
- `content/analysis-flow.js`: target analysis orchestration and initial report creation.
- `content/state-store.js`: default-state cloning, store-cache freshness checks, cache merges, and cache normalization.
- `content/load-states.js`: loading, probing, filtering, and rate-limit state factories.
- `content/rate-limit-controller.js`: rate-limit state, retry checks, and paused-work resume decisions.
- `content/raw-data-store.js`: raw API/debug snapshot updates and raw-data popup rendering.
- `content/store-assets.js`: Steam store asset URL extraction, cached cover access, and cover cache writes.
- `content/cover-load-flow.js`: visible cover lazy loading, cached-cover health checks, and retry refreshes.
- `content/price-load-flow.js`: original-price pending queue, visible lazy loads, and rate-limit retry state.
- `content/details-renderer.js`: list tabs, search/sort, table and cover-grid rendering, and copy-list table shaping.
- `content/compare-dialog.js`: multi-target comparison dialog rendering and price-range filtering.
- `content/summary-renderer.js`: family metadata, summary metrics, and target profile rendering.
- `content/copy-actions.js`: report, list, and game-name clipboard actions.
- `content/cache-actions.js`: auto-refresh toggle, store-cache clear, and cover reload actions.
- `content/poster-settings.js`: poster setting normalization, sort modes, and poster context factories.
- `content/shareability-flow.js`: Store shareability enrichment, background filtering, and progress rendering.
- `content/report-model.js`: report construction, target breakdowns, and split metric calculation.
- `content/poster-dialog.js`: poster settings dialog state, rendering, and confirmation actions.
- `content/library-compare.js`: target/current/family library classification before report construction.
- `content/history-store.js`: analysis input history, account-name cache, and history menu rendering.
- `content/analysis-session-store.js`: saved report restoration and debounced analysis-session persistence.
- `content/app.js`: in-page helper application logic.
- `background/`: service-worker modules for request allowlisting, HTTP proxying, and toolbar actions.
