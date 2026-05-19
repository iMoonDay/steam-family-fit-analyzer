# 缓存设计

## 缓存原则

- 缓存不会影响结果正确性的低频数据。
- 不默认缓存会导致遗漏的高频输入数据。
- 缓存必须可清理、可过期、可按地区和语言隔离。
- 失败要显式暴露，不用旧数据静默掩盖关键错误。

## 推荐缓存

### 商店条目

用于本地化名、封面资源、家庭共享支持性、Steam 原价辅助。

建议 TTL：7 天。

缓存键：

```text
store_item:{country}:{language}:{appid}
```

读取时只把可直接用于当前分析的条目视为命中：

- 必须仍在 TTL 内，且 `supported` 已明确为布尔值。
- 必须有本地化名称；若商店条目名称为空，可使用同上下文原价缓存里的本地化名称补齐。
- `supported = true` 的游戏必须同时有同上下文、同 TTL 的原价缓存，避免新增价值和零价值过滤缺失。
- `supported = false` 的游戏不强制要求价格，因为它只用于不可共享过滤。
- `cover_url` 只有在 `cover_verified = true` 时才作为展示资源使用。

### 价格

原价和史低分开保存。

```text
price:{country}:{language}:{appid}:original
price:{country}:{language}:{appid}:historyLow
```

原价来源：Steam Store。

史低来源：ITAD Steam shop low，只按 Steam 店铺口径，不混全平台。

### 封面图片

缓存两层：

- SQLite 保存封面 URL 与元数据。
- 文件缓存目录保存图片 Blob。

文件键建议使用 URL hash，而不是只用 appid，因为同一个 appid 可能有不同尺寸和不同资源 URL。

```text
cover_meta:{country}:{language}:{appid}
cover_blob:{sha256(coverUrl)}
```

建议策略：

- 只缓存实际显示或导出过的封面。
- 最大数量 500 张或最大容量 300 MB。
- 按最近使用时间 LRU 清理。
- URL 变化时下载新图，不覆盖旧图直到清理。

## 不默认缓存

### 目标账号游戏库

不默认缓存。目标账号可能随时购买、退款、隐藏或公开库变化，缓存会导致新增游戏遗漏。

### 当前账号 owned appids

不默认缓存。它直接决定“是否已经拥有”，缓存会导致新增价值误判。

### 家庭库

可以缓存最近一次家庭库用于启动展示，但用户主动分析前建议提示刷新或自动检查刷新时间。家庭库变化会影响重复和新增判断，不能长期静默复用。

### Vanity URL 解析

默认可以不缓存。若后续要缓存，应只作为短 TTL 优化，并在解析失败时重新请求。

## SQLite 草案

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE store_cache (
  context TEXT NOT NULL,
  appid TEXT NOT NULL,
  localized_name TEXT NOT NULL DEFAULT '',
  supported INTEGER,
  store_item_json TEXT,
  cover_url TEXT NOT NULL DEFAULT '',
  cover_verified INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (context, appid)
);

CREATE TABLE price_cache (
  context TEXT NOT NULL,
  appid TEXT NOT NULL,
  mode TEXT NOT NULL,
  source TEXT NOT NULL,
  initial INTEGER,
  currency TEXT NOT NULL,
  localized_name TEXT NOT NULL DEFAULT '',
  is_free INTEGER NOT NULL DEFAULT 0,
  unavailable INTEGER NOT NULL DEFAULT 0,
  history_low_at TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (context, appid, mode)
);

CREATE TABLE cover_cache (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  file_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```
