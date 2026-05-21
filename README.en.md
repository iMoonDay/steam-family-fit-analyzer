# Steam Family Library Analyzer

A Tampermonkey userscript that analyzes a public Steam account against the Steam Family shared library of your currently signed-in Steam account. It helps estimate added games, duplicate games, and the original-price value of the added library.

## Screenshot

![Steam Family Library Analyzer screenshot](https://raw.githubusercontent.com/iMoonDay/steam-family-fit-analyzer/main/ScreenShot.en.png)

## Features

- Reads the Steam Family shared library of the signed-in account and analyzes the added games, duplicates, duplicate rate, and added value from one or more public Steam accounts.
- Supports SteamID64, Steam friend codes, `/profiles/<steamid64>`, `/id/<custom>`, and vanity names. Separate multiple accounts with spaces.
- Supports multi-target comparison, account exclusion, and synchronized metrics, lists, and global comparison results.
- Also reads the signed-in account's personal library to avoid counting already-owned games that are missing from the Family shared library as added games.
- Provides All, Family library, Added, Relatively added, and Duplicates lists with search, sorting, rule filters, list copying, and raw data viewing.
- Provides table, grid, and poster views with covers, localized names, original-name tooltips, prices, status, owners, and acquisition time.
- Supports original price, current price, and historical low price modes. Current prices and historical lows use separate caches; historical lows require an IsThereAnyDeal API key.
- Provides a global contribution comparison chart for target accounts and family members, with drill-down details.
- Supports analysis history, history deletion, profile-page auto-fill, and automatic family library refresh every 24 hours.
- Supports custom tooltips, fullscreen dialog, lazy initialization, a draggable snap-to-edge launcher, and optional Steam client protocol links.

## Installation

### Userscript (Tampermonkey)

1. Install Tampermonkey.
2. Open the Greasy Fork install page:
   <https://greasyfork.org/zh-CN/scripts/577825-steam-%E5%AE%B6%E5%BA%AD%E5%BA%93%E5%88%86%E6%9E%90%E5%99%A8>
3. Confirm installation in the Tampermonkey install page.

You can also install directly from GitHub:

1. Open the script file:
   <https://github.com/iMoonDay/steam-family-fit-analyzer/raw/main/script.user.js>
2. Confirm installation in the Tampermonkey install page.

## Usage

1. Sign in to Steam on the web.
2. Open `https://store.steampowered.com/` or any `https://steamcommunity.com/profiles/<steamid64>` page.
3. Click the "Family Analyzer" button on the right side of the page.
4. Click "Refresh family library" first.
5. Enter the public Steam account you want to analyze, then click "Analyze account".

## Notes

- The target account's game details must be public, otherwise the full library cannot be read.
- Added value is calculated using the currently selected price mode, and money is formatted according to the store region.
- Free or zero-price games are not counted as added games. Unpriced, delisted, or region-unavailable games are shown as `-`.
- Results come from Steam pages and APIs. Different Steam interfaces may use different scopes, so the result should be treated as a reference only.
- The script does not bypass Steam privacy restrictions. Historical low prices require your own IsThereAnyDeal API key.
- The script runs locally in your browser and does not upload your Steam data to any third-party server.

## Configurable Constants

The script keeps a few constants near the top that can be adjusted if needed:

- `FALLBACK_STORE_CC`: Store region used when it cannot be detected automatically. Default: `CN`.
- `FALLBACK_STORE_LANG`: Store language used when it cannot be detected automatically. Default: `schinese`.
- `APP_LOCALE`: Default UI language mode. Default: `auto`, which follows the current Steam page language. Chinese and English are supported, and the language can also be changed from the top-right switcher.
- `STORE_CACHE_TTL_MS`: Store item cache duration.
- `CURRENT_PRICE_CACHE_TTL_MS`: Current-price cache duration. Default: 1 day.
- `ORIGINAL_PRICE_BATCH_SIZE`: Number of apps per original-price batch.
- `ITAD_PRICE_BATCH_SIZE`: Number of apps per historical-low-price batch.
- `SHAREABILITY_BATCH_SIZE`: Number of apps per Family Sharing support batch.
- `FAMILY_POSTER_COLUMNS`: Number of cards per row when exporting family library posters.
- `COVER_RELOAD_BATCH_SIZE`: Number of covers processed per cover reload batch.
- `STORE_REQUEST_DELAY_MS`: Delay between store requests.
- `SEARCH_RENDER_DEBOUNCE_MS`: Delay before refreshing the list after search input stops.
- `AUTO_FAMILY_REFRESH_INTERVAL_MS`: Automatic family library refresh interval.

## License

MIT License
