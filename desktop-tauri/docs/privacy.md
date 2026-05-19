# 隐私说明

## 数据存储

本应用**完全离线运行**，所有数据存储在你的电脑本地，不会上传到任何第三方服务器。

### 存储位置

| 数据类型 | 存储位置 | 内容 |
|---------|---------|------|
| 应用配置 | 系统应用配置目录 `settings.json` | Steam Web API Key、ITAD API Key、SteamID64、家庭库 Access Token、地区/语言偏好、缓存目录路径 |
| 分析缓存 | 应用缓存目录（SQLite 数据库 + 文件） | 游戏商店信息（名称、封面 URL）、价格数据、封面图片文件 |
| 分析结果 | 仅内存，不持久化 | 当前分析报告（关闭页面即丢弃） |

### 配置目录

- Windows：`%APPDATA%/com.imonday.steam-family-fit-analyzer/`
- macOS：`~/Library/Application Support/com.imonday.steam-family-fit-analyzer/`
- Linux：`~/.config/com.imonday.steam-family-fit-analyzer/`

### 缓存目录

- 默认路径为系统标准缓存目录。
- 可在配置页修改路径，或恢复默认。

## 网络请求

应用在以下场景会发起网络请求：

| 请求目标 | 用途 | 传输数据 |
|---------|------|---------|
| `api.steampowered.com` | Steam Web API（玩家信息、游戏库、家庭库） | 你提供的 Steam Web API Key、SteamID64、家庭库 Access Token |
| `store.steampowered.com` | Steam 商店 API（游戏名称、价格、封面 URL、家庭共享支持性） | 商店地区、语言偏好 |
| `api.isthereanydeal.com` | ITAD API（史低价格查询） | 你提供的 ITAD API Key |
| Steam CDN | 下载游戏封面图片 | 无（公开图片资源） |

### 不会发送的数据

- **分析结果**不会上传到任何地方。
- **目标账号的完整游戏列表**不会被发送到 Steam 以外的服务。
- **不会**在你的电脑上运行任何远程代码。
- **不会**收集任何遥测、诊断或使用统计。

## 缓存数据

### 缓存内容

- 游戏商店信息：名称、封面 URL、家庭共享支持性标签。
- 价格信息：原价（来自 Steam 商店）、史低价（来自 ITAD，如已配置）。
- 封面图片：PNG 格式的游戏封面缩略图。

### 缓存策略

- 商店信息和价格缓存保留 **7 天**，超期自动失效。
- 封面图片最多保留 **500 张**，超出时删除最久未使用的。
- 目标账号的游戏库**不会被缓存**，每次分析重新请求以确保准确性。

### 清除缓存

在配置页点击「清除缓存」可立即删除所有缓存数据。缓存仅用于加速分析，清除后不影响功能。

## 第三方服务

本应用依赖以下第三方服务完成分析：

| 服务 | 隐私政策 |
|------|---------|
| Steam Web API | [Steam 隐私政策](https://store.steampowered.com/privacy_agreement/) |
| IsThereAnyDeal | [ITAD 隐私政策](https://isthereanydeal.com/privacy/) |

## 配置导出/导入

- 导出配置文件（JSON）包含所有设置，**包括 API Key 和 Access Token**。
- 请将导出的配置文件妥善保管，不要分享给他人。
- 导入配置会覆盖当前所有设置，请确认来源可信。

## 开源与透明

本应用源代码在 [GitHub](https://github.com/anomalyco/steam-family-fit-analyzer) 完全公开。你可以自行审查代码，确认其行为符合上述声明。

如有隐私相关疑问，请在 GitHub Issues 提出。
