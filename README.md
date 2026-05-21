# Steam 家庭库分析器

一个 Tampermonkey 用户脚本，用来基于当前登录 Steam 账号的家庭组共享库，分析指定公开 Steam 账号加入后可能带来的新增游戏、重复游戏和新增价值。

## 截图

![Steam 家庭库分析器截图](https://raw.githubusercontent.com/iMoonDay/steam-family-fit-analyzer/main/ScreenShot.png)

## 功能

- 读取当前登录账号的 Steam 家庭组共享库，并分析一个或多个公开 Steam 账号加入后的新增游戏、重复游戏、重复率和新增价值。
- 支持 SteamID64、Steam 好友码、`/profiles/<steamid64>`、`/id/<custom>` 和 vanity 名称；多个账号可用空格分隔。
- 支持多目标账号对比，可勾选排除账号，并在指标、列表和全局对比中同步生效。
- 自动读取当前登录账号个人库，避免把已拥有但未进入家庭共享库的游戏误算为新增。
- 提供全部、家庭库、新增、相对新增、重复等列表，并支持搜索、排序、规则筛选、复制列表和查看原始数据。
- 提供表格、网格、海报三种视图；游戏可显示封面、本地化名称、原名提示、价格、状态、拥有者和入库时间。
- 支持原价、当前价、史低价三种价格口径；当前价和史低价可独立缓存，史低价需要配置 IsThereAnyDeal API Key。
- 支持全局贡献对比，用直方图查看目标账号和家庭成员的游戏贡献量，并可下钻查看详情。
- 支持分析历史、删除历史记录、自动填入当前资料页账号、每 24 小时自动后台刷新家庭库。
- 支持自定义悬浮提示、全屏弹窗、懒加载启动、可拖动吸附的入口按钮，以及可选的 Steam 客户端协议打开链接。

## 安装

### 用户脚本版（Tampermonkey）

1. 安装 Tampermonkey。
2. 打开 GreasyFork 页面安装：
   <https://greasyfork.org/zh-CN/scripts/577825-steam-%E5%AE%B6%E5%BA%AD%E5%BA%93%E5%88%86%E6%9E%90%E5%99%A8>
3. Tampermonkey 会弹出安装页面，确认安装即可。

也可以直接从 GitHub 安装：

1. 打开脚本文件：
   <https://github.com/iMoonDay/steam-family-fit-analyzer/raw/main/script.user.js>
2. Tampermonkey 会弹出安装页面，确认安装即可。

## 使用

1. 登录 Steam 网页版。
2. 打开 `https://store.steampowered.com/` 或任意 `https://steamcommunity.com/profiles/<steamid64>` 页面。
3. 点击右侧的“家庭库分析”按钮。
4. 先点“刷新家庭库”。
5. 输入要分析的公开 Steam 账号，点击“分析账号”。

## 说明

- 目标账号的游戏详情必须公开，否则无法获取完整游戏库。
- 新增价值会按当前选择的价格口径统计，金额格式会根据商店地区显示。
- 免费或零价游戏不计入新增；无价格、下架或区域不可售游戏会显示为 `-`。
- 统计结果来自 Steam 页面和接口，不同接口的口径可能不完全一致，结果仅供参考。
- 脚本不绕过 Steam 隐私限制；Steam 史低价功能需要自行配置 IsThereAnyDeal API Key。
- 脚本只在浏览器本地运行，不会把你的 Steam 数据上传到第三方服务器。

## 可调整配置

脚本开头保留了一组常量，可按需要修改：

- `FALLBACK_STORE_CC`：无法自动识别时使用的商店地区，默认 `CN`。
- `FALLBACK_STORE_LANG`：无法自动识别时使用的商店语言，默认 `schinese`。
- `APP_LOCALE`：界面语言默认模式，默认 `auto`，会跟随当前 Steam 页面语言，支持中文和英文；也可在右上角直接切换。
- `STORE_CACHE_TTL_MS`：商店条目缓存时间。
- `CURRENT_PRICE_CACHE_TTL_MS`：当前价缓存时间，默认 1 天。
- `ORIGINAL_PRICE_BATCH_SIZE`：原价读取每批数量。
- `ITAD_PRICE_BATCH_SIZE`：史低价读取每批数量。
- `SHAREABILITY_BATCH_SIZE`：共享支持性检测每批数量。
- `FAMILY_POSTER_COLUMNS`：家庭库海报导出时每行显示的卡片数量。
- `COVER_RELOAD_BATCH_SIZE`：重载封面时每批处理数量。
- `STORE_REQUEST_DELAY_MS`：商店请求间隔。
- `SEARCH_RENDER_DEBOUNCE_MS`：搜索输入停止后刷新列表的延迟。
- `AUTO_FAMILY_REFRESH_INTERVAL_MS`：自动刷新家庭库间隔。

## 授权

MIT License
