# Steam Family Library Analyzer

A Tampermonkey userscript that analyzes a public Steam account against the Steam Family shared library of your currently signed-in Steam account. It helps estimate added games, duplicate games, and the original-price value of the added library.

## Usage Notice

- This tool is best used as a private reference. Please do not use the result to judge whether a friend, family member, or partner is "worth" adding to a Steam Family.
- Steam Family Sharing involves trust, member slots, region rules, cooldowns, and real relationships. Game count and price cannot represent the value of a relationship.
- Please respect other people's privacy settings. If a target account's game details are private, the script will not and cannot bypass that restriction.

## Screenshot

![Steam Family Library Analyzer screenshot](https://raw.githubusercontent.com/iMoonDay/steam-family-fit-analyzer/main/ScreenShot.en.png)

## Features

- Reads the Steam Family shared library of the current account.
- Supports SteamID64, `/profiles/<steamid64>`, `/id/<custom>`, and vanity names.
- Auto-fills the current profile account on `steamcommunity.com/profiles/<steamid64>` pages.
- Shows total games, family library size, progress, added games, duplicates, duplicate rate, and added value.
- Provides All, Family library, Added, Duplicates, and Search lists.
- Only counts games that support Steam Family Sharing.
- Shows original prices for added games according to the current store region.
- The UI follows the current Steam page language by default, can be changed from the top-right language switcher, and formats money according to the store region.
- Supports sortable table headers, search, copying the current list, copying the report, and viewing raw response data.
- Supports automatic background refresh of the family library every 24 hours. This can be disabled from the menu.

## Installation

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
- Added value uses original prices in the current store region and does not use current discount prices.
- Money is formatted according to the store region.
- Free or zero-price games are not counted as added games. Unpriced, delisted, or region-unavailable games are shown as `N/A`.
- Results come from Steam pages and APIs. Different Steam interfaces may use different scopes, so the result should be treated as a reference only.
- The script does not bypass Steam privacy restrictions and does not require you to manually enter a Steam Web API key.
- The script runs locally in your browser and does not upload your Steam data to any third-party server.

## Configurable Constants

The script keeps a few constants near the top that can be adjusted if needed:

- `FALLBACK_STORE_CC`: Store region used when it cannot be detected automatically. Default: `CN`.
- `FALLBACK_STORE_LANG`: Store language used when it cannot be detected automatically. Default: `schinese`.
- `APP_LOCALE`: Default UI language mode. Default: `auto`, which follows the current Steam page language. Chinese and English are supported, and the language can also be changed from the top-right switcher.
- `STORE_CACHE_TTL_MS`: Store item cache duration.
- `ORIGINAL_PRICE_BATCH_SIZE`: Number of apps per original-price batch.
- `SHAREABILITY_BATCH_SIZE`: Number of apps per Family Sharing support batch.
- `STORE_REQUEST_DELAY_MS`: Delay between store requests.
- `AUTO_FAMILY_REFRESH_INTERVAL_MS`: Automatic family library refresh interval.

## License

MIT License
