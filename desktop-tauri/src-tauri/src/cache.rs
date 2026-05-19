use crate::{
    models::{AppSettings, CacheCoversOutput, CoverCacheItem, CoverCacheRequest, PriceInfo},
    steam::{self, StoreItemEnrichment},
};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const STORE_CACHE_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;
const PRICE_CACHE_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;
const COVER_CACHE_MAX_COUNT: i64 = 500;
const COVER_CACHE_MAX_BYTES: i64 = 300 * 1024 * 1024;

pub struct CacheStore {
    connection: Connection,
    cache_dir: PathBuf,
}

impl CacheStore {
    pub fn open(app: &AppHandle, settings: &AppSettings) -> Result<Self, String> {
        let cache_dir = crate::settings::cache_directory(app, settings)?;
        fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
        let connection = Connection::open(cache_dir.join("cache.sqlite3"))
            .map_err(|error| format!("打开缓存数据库失败：{error}"))?;
        let store = Self {
            connection,
            cache_dir,
        };
        store.migrate()?;
        Ok(store)
    }

    pub fn load_store_enrichment(
        &self,
        appids: &[String],
        settings: &AppSettings,
    ) -> Result<HashMap<String, StoreItemEnrichment>, String> {
        let context = cache_context(settings);
        let fresh_after = now_seconds() - STORE_CACHE_TTL_SECONDS;
        let mut result = HashMap::new();

        for appid in appids {
            let Some((
                mut localized_name,
                cover_url,
                cover_verified,
                family_sharing_supported,
                store_item_json,
            )) = self
                .connection
                .query_row(
                    "SELECT localized_name, cover_url, cover_verified, supported, COALESCE(store_item_json, '')
                     FROM store_cache
                     WHERE context = ?1 AND appid = ?2 AND updated_at >= ?3 AND supported IS NOT NULL",
                    params![context, appid, fresh_after],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)? != 0,
                            row.get::<_, i64>(3)? != 0,
                            row.get::<_, String>(4)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| format!("读取商店缓存失败：{error}"))?
            else {
                continue;
            };
            let price = self.load_price(appid, settings, "original")?;
            if localized_name.trim().is_empty() {
                localized_name = price
                    .as_ref()
                    .map(|price| price.localized_name.clone())
                    .unwrap_or_default();
            }
            if localized_name.trim().is_empty() {
                continue;
            }
            if family_sharing_supported && price.is_none() {
                continue;
            }
            let cached_cover_url = if cover_verified {
                cover_url
            } else {
                String::new()
            };
            let stored_item_cover_url = extract_cover_url_from_store_item_json(&store_item_json);
            let cover_url = if stored_item_cover_url.trim().is_empty() {
                cached_cover_url
            } else {
                stored_item_cover_url
            };
            if cover_url.trim().is_empty() {
                continue;
            }
            result.insert(
                appid.clone(),
                StoreItemEnrichment {
                    localized_name,
                    family_sharing_supported,
                    cover_url,
                    price,
                    store_item_json: String::new(),
                },
            );
        }

        Ok(result)
    }

    pub fn save_store_enrichment(
        &mut self,
        enrichment: &HashMap<String, StoreItemEnrichment>,
        settings: &AppSettings,
    ) -> Result<(), String> {
        let tx = self
            .connection
            .transaction()
            .map_err(|error| format!("写入商店缓存失败：{error}"))?;
        let context = cache_context(settings);
        let updated_at = now_seconds();

        for (appid, item) in enrichment {
            tx.execute(
                "INSERT INTO store_cache (context, appid, localized_name, supported, store_item_json, cover_url, cover_verified, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(context, appid) DO UPDATE SET
                   localized_name = CASE
                     WHEN excluded.localized_name <> '' THEN excluded.localized_name
                     ELSE store_cache.localized_name
                   END,
                   supported = excluded.supported,
                   store_item_json = CASE
                     WHEN excluded.store_item_json <> '' THEN excluded.store_item_json
                     ELSE store_cache.store_item_json
                   END,
                   cover_url = CASE
                     WHEN excluded.cover_url <> '' THEN excluded.cover_url
                     ELSE store_cache.cover_url
                   END,
                   cover_verified = CASE
                     WHEN excluded.cover_url <> '' THEN 1
                     ELSE store_cache.cover_verified
                   END,
                   updated_at = MAX(store_cache.updated_at, excluded.updated_at)",
                params![
                    context,
                    appid,
                    item.localized_name,
                    i64::from(item.family_sharing_supported),
                    item.store_item_json,
                    item.cover_url,
                    i64::from(!item.cover_url.trim().is_empty()),
                    updated_at
                ],
            )
            .map_err(|error| format!("写入商店缓存失败：{error}"))?;
            if let Some(price) = &item.price {
                save_price_with_connection(&tx, appid, settings, "original", price)?;
            }
        }

        tx.commit()
            .map_err(|error| format!("提交商店缓存失败：{error}"))
    }

    pub fn load_prices(
        &self,
        appids: &[String],
        settings: &AppSettings,
        mode: &str,
    ) -> Result<HashMap<String, PriceInfo>, String> {
        let mut result = HashMap::new();
        for appid in appids {
            if let Some(price) = self.load_price(appid, settings, mode)? {
                result.insert(appid.clone(), price);
            }
        }
        Ok(result)
    }

    pub fn save_prices(
        &mut self,
        prices: &HashMap<String, PriceInfo>,
        settings: &AppSettings,
        mode: &str,
    ) -> Result<(), String> {
        let tx = self
            .connection
            .transaction()
            .map_err(|error| format!("写入价格缓存失败：{error}"))?;
        for (appid, price) in prices {
            save_price_with_connection(&tx, appid, settings, mode, price)?;
        }
        tx.commit()
            .map_err(|error| format!("提交价格缓存失败：{error}"))
    }

    pub fn allow_cover_asset_scope(&self, app: &AppHandle) -> Result<(), String> {
        app.asset_protocol_scope()
            .allow_directory(self.cover_dir(), true)
            .map_err(|error| format!("开放封面缓存读取权限失败：{error}"))
    }

    pub async fn cache_covers(
        &mut self,
        client: &reqwest::Client,
        settings: &AppSettings,
        covers: &[CoverCacheRequest],
    ) -> CacheCoversOutput {
        let mut output = CacheCoversOutput {
            covers: Vec::new(),
            warnings: Vec::new(),
        };
        let mut unique_covers = BTreeMap::<String, (String, bool)>::new();
        for cover in covers {
            if cover.appid.trim().is_empty()
                || (!cover.url.trim().is_empty() && !is_cacheable_cover_url(&cover.url))
            {
                continue;
            }
            let entry = unique_covers
                .entry(cover.appid.trim().to_string())
                .or_insert_with(|| (cover.url.trim().to_string(), false));
            if entry.0.is_empty() && !cover.url.trim().is_empty() {
                entry.0 = cover.url.trim().to_string();
            }
            entry.1 = entry.1 || cover.force;
        }
        let appids = unique_covers.keys().cloned().collect::<Vec<_>>();
        let batch_candidates =
            match steam::fetch_store_cover_candidates_batch(client, &appids, settings).await {
                Ok(candidates) => candidates,
                Err(error) => {
                    output
                        .warnings
                        .push(format!("批量封面信息获取失败：{error}"));
                    HashMap::new()
                }
            };

        for (appid, (url, force)) in unique_covers {
            let fetched_urls = batch_candidates.get(&appid).cloned().unwrap_or_default();
            match self
                .cache_cover(client, settings, &appid, &url, &fetched_urls, force)
                .await
            {
                Ok(Some(item)) => output.covers.push(item),
                Ok(None) => {}
                Err(error) => output.warnings.push(error),
            }
        }

        if let Err(error) = self.prune_cover_cache() {
            output.warnings.push(error);
        }
        output
    }

    pub fn clear_all(&self) -> Result<(), String> {
        self.connection
            .execute_batch(
                "
                DELETE FROM cover_cache;
                DELETE FROM price_cache;
                DELETE FROM store_cache;
                ",
            )
            .map_err(|error| format!("清理缓存失败：{error}"))?;
        let cover_dir = self.cover_dir();
        if cover_dir.exists() {
            fs::remove_dir_all(&cover_dir).map_err(|error| format!("清理封面缓存失败：{error}"))?;
        }
        Ok(())
    }

    fn migrate(&self) -> Result<(), String> {
        self.connection
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS store_cache (
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

                CREATE TABLE IF NOT EXISTS price_cache (
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

                CREATE TABLE IF NOT EXISTS cover_cache (
                  url_hash TEXT PRIMARY KEY,
                  url TEXT NOT NULL,
                  file_path TEXT NOT NULL,
                  byte_size INTEGER NOT NULL,
                  last_used_at INTEGER NOT NULL,
                  created_at INTEGER NOT NULL
                );
                ",
            )
            .map_err(|error| format!("初始化缓存数据库失败：{error}"))?;
        ensure_column(
            &self.connection,
            "store_cache",
            "store_item_json",
            "ALTER TABLE store_cache ADD COLUMN store_item_json TEXT",
        )?;
        ensure_column(
            &self.connection,
            "store_cache",
            "cover_verified",
            "ALTER TABLE store_cache ADD COLUMN cover_verified INTEGER NOT NULL DEFAULT 0",
        )?;
        Ok(())
    }

    async fn cache_cover(
        &mut self,
        client: &reqwest::Client,
        settings: &AppSettings,
        appid: &str,
        url: &str,
        fetched_urls: &[String],
        force: bool,
    ) -> Result<Option<CoverCacheItem>, String> {
        let mut errors = Vec::new();
        let mut candidate_urls = cover_candidate_urls(appid, url);
        for fetched_url in fetched_urls {
            push_unique_cover_url(&mut candidate_urls, fetched_url);
        }
        let initial_candidate_count = candidate_urls.len();
        for candidate_url in candidate_urls.clone() {
            let url_hash = cover_url_hash(&candidate_url);
            if !force {
                if let Some(file_path) = self.load_cover_path(&url_hash, &candidate_url)? {
                    return Ok(Some(CoverCacheItem {
                        appid: appid.to_string(),
                        url: candidate_url,
                        file_path,
                    }));
                }
            }

            match self
                .download_and_store_cover(client, appid, &candidate_url, &url_hash)
                .await
            {
                Ok(item) => return Ok(Some(item)),
                Err(error) => errors.push(error),
            }
        }

        match fetch_missing_cover_candidates(client, settings, appid, !fetched_urls.is_empty())
            .await
        {
            Ok(fetched_urls) => {
                for fetched_url in fetched_urls {
                    push_unique_cover_url(&mut candidate_urls, &fetched_url);
                }
            }
            Err(error) => errors.push(error),
        }
        for candidate_url in candidate_urls.into_iter().skip(initial_candidate_count) {
            let url_hash = cover_url_hash(&candidate_url);
            if !force {
                if let Some(file_path) = self.load_cover_path(&url_hash, &candidate_url)? {
                    return Ok(Some(CoverCacheItem {
                        appid: appid.to_string(),
                        url: candidate_url,
                        file_path,
                    }));
                }
            }

            match self
                .download_and_store_cover(client, appid, &candidate_url, &url_hash)
                .await
            {
                Ok(item) => return Ok(Some(item)),
                Err(error) => errors.push(error),
            }
        }

        Err(errors
            .into_iter()
            .next()
            .unwrap_or_else(|| format!("封面下载失败：{appid}：没有可用封面地址")))
    }

    async fn download_and_store_cover(
        &mut self,
        client: &reqwest::Client,
        appid: &str,
        url: &str,
        url_hash: &str,
    ) -> Result<CoverCacheItem, String> {
        let response = client.get(url).send().await.map_err(|error| {
            let ctx = format!("封面下载：{appid}");
            crate::error::AppError::from_reqwest(error, &ctx).to_string()
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(crate::error::AppError::from_http_status(
                status,
                &format!("封面下载：{appid}"),
            )
            .to_string());
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("封面读取失败：{appid}：{error}"))?;
        if bytes.is_empty() {
            return Err(format!("封面下载失败：{appid}：空响应"));
        }

        let cover_dir = self.cover_dir();
        fs::create_dir_all(&cover_dir).map_err(|error| format!("创建封面缓存目录失败：{error}"))?;
        let file_path = cover_dir.join(format!("{}{}", url_hash, cover_extension(url)));
        fs::write(&file_path, bytes.as_ref())
            .map_err(|error| format!("写入封面缓存失败：{error}"))?;
        let file_path_text = file_path.to_string_lossy().to_string();
        let now = now_seconds();
        self.connection
            .execute(
                "INSERT INTO cover_cache (url_hash, url, file_path, byte_size, last_used_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(url_hash) DO UPDATE SET
                   url = excluded.url,
                   file_path = excluded.file_path,
                   byte_size = excluded.byte_size,
                   last_used_at = excluded.last_used_at",
                params![
                    url_hash,
                    url,
                    file_path_text,
                    i64::try_from(bytes.len()).unwrap_or(i64::MAX),
                    now,
                    now
                ],
            )
            .map_err(|error| format!("写入封面缓存索引失败：{error}"))?;

        Ok(CoverCacheItem {
            appid: appid.to_string(),
            url: url.to_string(),
            file_path: file_path.to_string_lossy().to_string(),
        })
    }

    fn load_cover_path(&self, url_hash: &str, url: &str) -> Result<Option<String>, String> {
        let cached = self
            .connection
            .query_row(
                "SELECT file_path FROM cover_cache WHERE url_hash = ?1 AND url = ?2",
                params![url_hash, url],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("读取封面缓存索引失败：{error}"))?;
        let Some(file_path) = cached else {
            return Ok(None);
        };
        if !PathBuf::from(&file_path).exists() {
            self.connection
                .execute(
                    "DELETE FROM cover_cache WHERE url_hash = ?1",
                    params![url_hash],
                )
                .map_err(|error| format!("清理失效封面缓存失败：{error}"))?;
            return Ok(None);
        }
        self.connection
            .execute(
                "UPDATE cover_cache SET last_used_at = ?1 WHERE url_hash = ?2",
                params![now_seconds(), url_hash],
            )
            .map_err(|error| format!("更新封面缓存时间失败：{error}"))?;
        Ok(Some(file_path))
    }
    fn prune_cover_cache(&self) -> Result<(), String> {
        let mut rows = self
            .connection
            .prepare(
                "SELECT url_hash, file_path, byte_size
                 FROM cover_cache
                 ORDER BY last_used_at DESC, created_at DESC",
            )
            .map_err(|error| format!("读取封面缓存清理列表失败：{error}"))?;
        let entries = rows
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|error| format!("读取封面缓存清理列表失败：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取封面缓存清理列表失败：{error}"))?;

        let mut total_bytes = 0_i64;
        let mut kept_count = 0_i64;
        let mut stale_hashes = Vec::new();
        for (url_hash, file_path, byte_size) in entries {
            kept_count += 1;
            total_bytes = total_bytes.saturating_add(byte_size.max(0));
            if kept_count > COVER_CACHE_MAX_COUNT || total_bytes > COVER_CACHE_MAX_BYTES {
                let _ = fs::remove_file(file_path);
                stale_hashes.push(url_hash);
            }
        }

        for url_hash in stale_hashes {
            self.connection
                .execute(
                    "DELETE FROM cover_cache WHERE url_hash = ?1",
                    params![url_hash],
                )
                .map_err(|error| format!("清理封面缓存索引失败：{error}"))?;
        }
        Ok(())
    }

    fn cover_dir(&self) -> PathBuf {
        self.cache_dir.join("covers")
    }

    fn load_price(
        &self,
        appid: &str,
        settings: &AppSettings,
        mode: &str,
    ) -> Result<Option<PriceInfo>, String> {
        let context = cache_context(settings);
        let fresh_after = now_seconds() - PRICE_CACHE_TTL_SECONDS;
        self.connection
            .query_row(
                "SELECT initial, currency, localized_name, source, is_free, unavailable, history_low_at
                 FROM price_cache
                 WHERE context = ?1 AND appid = ?2 AND mode = ?3 AND updated_at >= ?4",
                params![context, appid, mode, fresh_after],
                |row| {
                    Ok(PriceInfo {
                        initial: row.get(0)?,
                        currency: row.get(1)?,
                        localized_name: row.get(2)?,
                        source: row.get(3)?,
                        is_free: row.get::<_, i64>(4)? != 0,
                        unavailable: row.get::<_, i64>(5)? != 0,
                        history_low_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("读取价格缓存失败：{error}"))
    }
}

fn save_price_with_connection(
    connection: &Connection,
    appid: &str,
    settings: &AppSettings,
    mode: &str,
    price: &PriceInfo,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO price_cache (
               context, appid, mode, source, initial, currency, localized_name,
               is_free, unavailable, history_low_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(context, appid, mode) DO UPDATE SET
               source = excluded.source,
               initial = excluded.initial,
               currency = excluded.currency,
               localized_name = excluded.localized_name,
               is_free = excluded.is_free,
               unavailable = excluded.unavailable,
               history_low_at = excluded.history_low_at,
               updated_at = excluded.updated_at",
            params![
                cache_context(settings),
                appid,
                mode,
                price.source.as_str(),
                price.initial,
                price.currency.as_str(),
                price.localized_name.as_str(),
                if price.is_free { 1_i64 } else { 0_i64 },
                if price.unavailable { 1_i64 } else { 0_i64 },
                price.history_low_at.as_str(),
                now_seconds()
            ],
        )
        .map_err(|error| format!("写入价格缓存失败：{error}"))?;
    Ok(())
}

fn cache_context(settings: &AppSettings) -> String {
    format!(
        "{}:{}",
        normalized_store_country(settings.store_country.as_str()),
        settings.locale.trim()
    )
}

fn normalized_store_country(country: &str) -> String {
    let normalized = country.trim().to_uppercase();
    if normalized.len() == 2 {
        normalized
    } else {
        "CN".to_string()
    }
}

fn extract_cover_url_from_store_item_json(store_item_json: &str) -> String {
    let Ok(item) = serde_json::from_str::<serde_json::Value>(store_item_json) else {
        return String::new();
    };
    steam::extract_store_card_cover_url(&item)
}

async fn fetch_missing_cover_candidates(
    client: &reqwest::Client,
    settings: &AppSettings,
    appid: &str,
    already_used_store_batch: bool,
) -> Result<Vec<String>, String> {
    if already_used_store_batch {
        return steam::fetch_appdetails_cover_candidates(client, appid, settings).await;
    }
    steam::fetch_store_cover_candidates(client, appid, settings).await
}

fn ensure_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    alter_sql: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(|error| format!("检查缓存表结构失败：{error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("检查缓存表结构失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("检查缓存表结构失败：{error}"))?;
    if columns.iter().any(|column| column == column_name) {
        return Ok(());
    }
    connection
        .execute(alter_sql, [])
        .map_err(|error| format!("迁移缓存表结构失败：{error}"))?;
    Ok(())
}

fn is_cacheable_cover_url(url: &str) -> bool {
    let normalized = url.trim().to_lowercase();
    normalized.starts_with("https://") || normalized.starts_with("http://")
}

fn cover_candidate_urls(appid: &str, primary_url: &str) -> Vec<String> {
    let mut urls = Vec::new();
    push_unique_cover_url(&mut urls, primary_url);
    if appid.chars().all(|char| char.is_ascii_digit()) {
        push_unique_cover_url(
            &mut urls,
            &format!(
                "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900_2x.jpg"
            ),
        );
        push_unique_cover_url(
            &mut urls,
            &format!(
                "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
            ),
        );
        push_unique_cover_url(
            &mut urls,
            &format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg"),
        );
        push_unique_cover_url(
            &mut urls,
            &format!(
                "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_616x353.jpg"
            ),
        );
        push_unique_cover_url(
            &mut urls,
            &format!(
                "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_231x87.jpg"
            ),
        );
    }
    urls
}

fn push_unique_cover_url(urls: &mut Vec<String>, url: &str) {
    let normalized = url.trim();
    if !is_cacheable_cover_url(normalized) || urls.iter().any(|item| item == normalized) {
        return;
    }
    urls.push(normalized.to_string());
}

fn cover_url_hash(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.trim().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn cover_extension(url: &str) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or("").to_lowercase();
    if path.ends_with(".png") {
        ".png"
    } else if path.ends_with(".webp") {
        ".webp"
    } else if path.ends_with(".gif") {
        ".gif"
    } else {
        ".jpg"
    }
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
