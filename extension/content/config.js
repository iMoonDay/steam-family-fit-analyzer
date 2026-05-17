"use strict";

globalThis.SFFA_CONFIG = (() => {
// ===== 可按需修改的脚本参数 =====
// 改完下面这组常量后保存脚本即可生效；如果不确定含义，优先保持默认值。

// 无法从 Steam 页面识别商店地区时使用的兜底地区代码，例如 CN / US / JP。
const FALLBACK_STORE_CC = "CN";
// 无法从 Steam 页面识别商店语言时使用的兜底语言代码，例如 schinese / english / japanese。
const FALLBACK_STORE_LANG = "schinese";
// 脚本界面语言；auto 会根据当前 Steam 页面语言在中文和英文之间自动选择。
const APP_LOCALE = "auto";
// 本地存储键名；只有在你想主动清空旧缓存、与旧版本隔离时才需要修改。
const STORAGE_KEY = "steam_family_fit_analyzer_state_v1";
// 商店条目缓存有效期，单位毫秒；默认 7 天。
const STORE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 原价读取每批 App 的数量；调大可减少请求轮次，调小可降低单批压力。
const ORIGINAL_PRICE_BATCH_SIZE = 200;
// 家庭共享支持性检测每批 App 的数量；调大可更快，调小可更稳。
const SHAREABILITY_BATCH_SIZE = 150;
// 家庭封面图导出时每行显示的卡片数量；调大更密，调小更疏。
const FAMILY_POSTER_COLUMNS = 10;
const COVER_RELOAD_BATCH_SIZE = 24;
// 商店请求之间的间隔，单位毫秒；调大更稳，调小更快但更容易撞限流。
const STORE_REQUEST_DELAY_MS = 15;
// 搜索输入停止后再刷新表格的延迟，单位毫秒；用于避免大列表逐字重绘卡顿。
const SEARCH_RENDER_DEBOUNCE_MS = 220;
// 自动后台刷新家庭库的间隔，单位毫秒；默认 24 小时。
const AUTO_FAMILY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
// 最近一次分析结果缓存键名。
const ANALYSIS_HISTORY_KEY = `${STORAGE_KEY}_analysis_v1`;
// 分析输入历史缓存键名；只保存输入值与账号名称缓存，不保存分析结果。
const ANALYSIS_INPUT_HISTORY_KEY = `${STORAGE_KEY}_analysis_history_v2`;
const MAX_ANALYSIS_HISTORY_ITEMS = 12;
// Steam 商店分类中“家庭共享”特性的分类 ID。
const FAMILY_SHARING_CATEGORY_ID = 62;
// 普通用户 SteamID64 = 该基数 + Steam 好友码 / 账号 ID（accountid）。
const STEAMID64_INDIVIDUAL_BASE = 76561197960265728n;
const MAX_STEAM_ACCOUNT_ID = 4294967295n;
const MAX_STEAM_ACCOUNT_ID_LENGTH = String(MAX_STEAM_ACCOUNT_ID).length;
const COMPARE_PRICE_RANGES = Object.freeze([
  { key: "0-48", label: "¥0-¥48", min: 0, max: 4800 },
  { key: "48-98", label: "¥48-¥98", min: 4800, max: 9800 },
  { key: "98-198", label: "¥98-¥198", min: 9800, max: 19800 },
  { key: "198+", label: "¥198+", min: 19800, max: Infinity }
]);
const COMPARE_QUALITY_LEVELS = Object.freeze([
  { key: "veryLow", max: 4800 },
  { key: "low", max: 9800 },
  { key: "medium", max: 19800 },
  { key: "high", max: 29800 },
  { key: "veryHigh", max: Infinity }
]);
const REPORT_LIST_TABS = Object.freeze(["all", "new", "relativeNew", "overlap"]);
const STEAM_LANGUAGE_ALIASES = parseI18nEntries("english=english|en=english|en-us=english|en-gb=english|schinese=schinese|zh-cn=schinese|zh-hans=schinese|tchinese=tchinese|zh-tw=tchinese|zh-hk=tchinese|japanese=japanese|ja=japanese|ja-jp=japanese|koreana=koreana|ko=koreana|ko-kr=koreana|german=german|de=german|de-de=german|french=french|fr=french|fr-fr=french|italian=italian|it=italian|spanish=spanish|es=spanish|es-es=spanish|brazilian=brazilian|pt-br=brazilian|russian=russian|ru=russian");
const STORE_ITEM_ASSET_BASE_URL = "https://shared.fastly.steamstatic.com/store_item_assets/";
const FAMILY_POSTER_SORT_MODES = Object.freeze([
  "data",
  "titleAsc",
  "titleDesc",
  "appidAsc",
  "appidDesc",
  "priceDesc",
  "priceAsc",
  "acquiredDesc",
  "acquiredAsc",
  "ownerCountDesc",
  "ownerCountAsc",
  "hasCoverFirst",
  "noCoverFirst"
]);
const LIST_POSTER_BASE_SORT_MODES = Object.freeze([
  "current",
  "titleAsc",
  "titleDesc",
  "appidAsc",
  "appidDesc"
]);
const FAMILY_POSTER_WIDTH = 2000;
const FAMILY_POSTER_PADDING = 32;
const FAMILY_POSTER_GAP = 12;
const FAMILY_POSTER_CARD_WIDTH = 180;
const FAMILY_POSTER_CARD_ASPECT_RATIO = 1.5;
const FAMILY_POSTER_HEADER_HEIGHT = 120;
const FAMILY_POSTER_MAX_HEIGHT = 30000;
const FAMILY_POSTER_IMAGE_CONCURRENCY = 8;


function parseI18nEntries(rawEntries) {
  const localeMap = {};
  String(rawEntries || "").split("|").filter(Boolean).forEach(entry => {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`本地化条目格式无效：${entry}`);
    }
    assignI18nValue(localeMap, entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1));
  });
  return localeMap;
}

function assignI18nValue(target, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) {
    throw new Error("本地化键不能为空");
  }
  let cursor = target;
  parts.slice(0, -1).forEach(part => {
    cursor[part] = cursor[part] && typeof cursor[part] === "object" ? cursor[part] : {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
}

const STORE_CC_TO_LOCALE = parseI18nEntries("US=en-US|GB=en-GB|AU=en-AU|CA=en-CA|MX=es-MX|JP=ja-JP|KR=ko-KR|CN=zh-CN|TW=zh-TW|HK=zh-HK|SG=en-SG|NZ=en-NZ|DE=de-DE|FR=fr-FR|IT=it-IT|ES=es-ES|NL=nl-NL|BE=nl-BE|AT=de-AT|FI=fi-FI|IE=en-IE|PT=pt-PT|GR=el-GR|BR=pt-BR|RU=ru-RU|TR=tr-TR|IN=en-IN|ZA=en-ZA|PL=pl-PL|NO=nb-NO|SE=sv-SE|DK=da-DK|CH=de-CH|CL=es-CL|CO=es-CO|PE=es-PE|PH=en-PH|ID=id-ID|MY=ms-MY|TH=th-TH|VN=vi-VN|UA=uk-UA|AR=es-AR|SA=ar-SA|AE=ar-AE|IL=he-IL|KZ=kk-KZ|UY=es-UY|CR=es-CR|KW=ar-KW|QA=ar-QA|EU=en-IE");
const STORE_CC_TO_CURRENCY = parseI18nEntries("US=USD|CA=CAD|MX=MXN|BR=BRL|GB=GBP|EU=EUR|DE=EUR|FR=EUR|IT=EUR|ES=EUR|NL=EUR|BE=EUR|AT=EUR|FI=EUR|IE=EUR|PT=EUR|GR=EUR|JP=JPY|KR=KRW|CN=CNY|TW=TWD|HK=HKD|SG=SGD|AU=AUD|NZ=NZD|RU=RUB|TR=TRY|IN=INR|ZA=ZAR|PL=PLN|NO=NOK|SE=SEK|DK=DKK|CH=CHF|CL=CLP|CO=COP|PE=PEN|PH=PHP|ID=IDR|MY=MYR|TH=THB|VN=VND|UA=UAH|AR=ARS|SA=SAR|AE=AED|IL=ILS|KZ=KZT|UY=UYU|CR=CRC|KW=KWD|QA=QAR");


  return Object.freeze({
    FALLBACK_STORE_CC,
    FALLBACK_STORE_LANG,
    APP_LOCALE,
    STORAGE_KEY,
    STORE_CACHE_TTL_MS,
    ORIGINAL_PRICE_BATCH_SIZE,
    SHAREABILITY_BATCH_SIZE,
    FAMILY_POSTER_COLUMNS,
    COVER_RELOAD_BATCH_SIZE,
    STORE_REQUEST_DELAY_MS,
    SEARCH_RENDER_DEBOUNCE_MS,
    AUTO_FAMILY_REFRESH_INTERVAL_MS,
    ANALYSIS_HISTORY_KEY,
    ANALYSIS_INPUT_HISTORY_KEY,
    MAX_ANALYSIS_HISTORY_ITEMS,
    FAMILY_SHARING_CATEGORY_ID,
    STEAMID64_INDIVIDUAL_BASE,
    MAX_STEAM_ACCOUNT_ID,
    MAX_STEAM_ACCOUNT_ID_LENGTH,
    COMPARE_PRICE_RANGES,
    COMPARE_QUALITY_LEVELS,
    REPORT_LIST_TABS,
    STEAM_LANGUAGE_ALIASES,
    STORE_ITEM_ASSET_BASE_URL,
    FAMILY_POSTER_SORT_MODES,
    LIST_POSTER_BASE_SORT_MODES,
    FAMILY_POSTER_WIDTH,
    FAMILY_POSTER_PADDING,
    FAMILY_POSTER_GAP,
    FAMILY_POSTER_CARD_WIDTH,
    FAMILY_POSTER_CARD_ASPECT_RATIO,
    FAMILY_POSTER_HEADER_HEIGHT,
    FAMILY_POSTER_MAX_HEIGHT,
    FAMILY_POSTER_IMAGE_CONCURRENCY,
    STORE_CC_TO_LOCALE,
    STORE_CC_TO_CURRENCY
  });
})();
