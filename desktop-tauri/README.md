# Steam Family Fit Analyzer Desktop

这是把 `script.user.js` 迁移为独立桌面程序的路线 2 子项目。当前已经进入可用 alpha 阶段，核心分析链路和主要结果页已经跑通。

默认技术路线：Tauri + Web 前端 + Rust 命令层。

Electron 可作为备选路线，但除非后续明确需要 Node 生态内建能力，否则优先 Tauri：安装包更小、运行开销更低、本地文件与系统能力边界更清晰。

## 目标

- 保留现有脚本的核心能力：家庭库分析、目标账号对比、家庭共享过滤、价格统计、史低价、封面海报导出。
- 从浏览器脚本迁移为独立桌面应用，减少对 Steam 页面环境和 Tampermonkey API 的依赖。
- 把请求、缓存、分析计算、UI 展示拆开，避免后续功能继续堆在单文件脚本里。

## 非目标

- 不默认缓存目标账号游戏库和当前账号 owned appids，避免游戏库变化导致遗漏。
- 不绕过 Steam 登录与权限限制。
- 不在第一阶段做云同步、多人账号管理、自动后台监控。

## 当前已实现

- Vite/TypeScript 前端入口。
- 桌面三页结构：分析、结果、配置。
- 工具型桌面首屏：历史分析、目标账号输入、输入标准化预览。
- Tauri Rust 命令层：
  - `get_app_status`
  - `load_settings`
  - `save_settings`
  - `export_settings`
  - `import_settings`
  - `clear_cache`
  - `open_cache_directory`
  - `save_png_file`
  - `cache_covers`
  - `auto_detect_steam_config`
  - `start_browser_config_callback`
  - `analyze_preview`
  - `analyze_target`
  - `refresh_report_prices`
- 设置文件持久化到系统应用配置目录。
- 配置导入/导出、缓存目录管理和清缓存。
- 浏览器预览 fallback：不在 Tauri 环境时使用 `localStorage`。
- 真实 Steam Web API 链路：
  - 解析 SteamID64、好友码、个人主页 URL、自定义 ID。
  - 拉取玩家摘要和公开游戏库。
  - 在填写当前 SteamID64 时，拉取当前账号 owned appids 并计算已拥有重叠。
  - 读取家庭库 access token 和家庭组 ID，并在分析时合并家庭库。
- 商店侧数据链路：
  - 读取商店本地化名、封面和家庭共享支持性。
  - 读取原价与 IsThereAnyDeal 史低价。
  - 按地区/语言与价格模式分桶缓存。
- 结果页能力：
  - 表格/封面视图切换。
  - 搜索、排序、复制报告、复制列表、复制游戏名。
  - 多账号勾选计入/排除后动态重算当前统计、列表和复制报告。
  - 单游戏刷新封面、批量重载封面、列表封面图导出。
  - 结果状态包含新增、重复、相对新增、当前账号已拥有、不可共享、无价格价值。

## 当前未迁移

- 多账号对比弹窗的完整交互。
- 家庭库独立列表页。
- 家庭库封面图导出。
- 原始返回数据窗口。
- 自动 24 小时家庭库刷新。
- 脚本内 Steam 页面侧边按钮形态的入口。

## 运行

```powershell
npm install
npm run tauri:dev
```

只预览前端：

```powershell
npm install
npm run dev
```

## 子项目文件

- [src/main.ts](src/main.ts)：前端工作台入口。
- [src/services/desktop.ts](src/services/desktop.ts)：Tauri 命令调用与浏览器预览 fallback。
- [src/core/input.ts](src/core/input.ts)：第一批可抽离纯函数。
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs)：Rust 命令层入口。
- [docs/01-requirements.md](docs/01-requirements.md)：需求边界与链路检查。
- [docs/02-architecture.md](docs/02-architecture.md)：桌面端架构、模块拆分和数据流。
- [docs/03-migration-plan.md](docs/03-migration-plan.md)：从脚本迁移到 Tauri 的阶段计划。
- [docs/04-cache-design.md](docs/04-cache-design.md)：缓存策略，尤其是价格、封面与不应默认缓存的数据。

## 推荐落地顺序

1. 补多账号对比弹窗。
2. 补家庭库独立列表页与家庭库封面导出。
3. 补原始返回数据窗口和自动家庭库刷新。
4. 再做英文 UI 和更细的桌面体验打磨。
