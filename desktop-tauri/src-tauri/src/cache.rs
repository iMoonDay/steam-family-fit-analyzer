use crate::{
    models::{AppSettings, PriceInfo},
    steam::StoreItemEnrichment,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const STORE_CACHE_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;
const PRICE_CACHE_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;

pub struct CacheStore {
    connection: Connection,
}

impl CacheStore {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let cache_dir = app_cache_dir(app)?;
        fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
        let connection = Connection::open(cache_dir.join("cache.sqlite3"))
            .map_err(|error| format!("打开缓存数据库失败：{error}"))?;
        let store = Self { connection };
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
            let Some(cover_url) = self
                .connection
                .query_row(
                    "SELECT cover_url FROM store_cache WHERE context = ?1 AND appid = ?2 AND updated_at >= ?3",
                    params![context, appid, fresh_after],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| format!("读取商店缓存失败：{error}"))?
            else {
                continue;
            };
            let price = self.load_price(appid, settings, "original")?;
            result.insert(appid.clone(), StoreItemEnrichment { cover_url, price });
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
                "INSERT INTO store_cache (context, appid, cover_url, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(context, appid) DO UPDATE SET
                   cover_url = excluded.cover_url,
                   updated_at = excluded.updated_at",
                params![context, appid, item.cover_url, updated_at],
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

    pub fn clear_all(&self) -> Result<(), String> {
        self.connection
            .execute_batch(
                "
                DELETE FROM price_cache;
                DELETE FROM store_cache;
                ",
            )
            .map_err(|error| format!("清理缓存失败：{error}"))
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
                ",
            )
            .map_err(|error| format!("初始化缓存数据库失败：{error}"))
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

fn app_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|error| error.to_string())
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

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
