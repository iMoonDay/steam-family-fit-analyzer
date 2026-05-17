"use strict";

globalThis.SFFA_CREATE_HTTP_HELPERS = function createHttpHelpers(dependencies) {
  const {
    getRateLimitState,
    getStoreRequestDelayMs,
    getStoreRequestQueue,
    setRawData,
    setStoreRequestQueue,
    sffaExtensionRequest,
    t,
    window
  } = dependencies;

function requestJson(url) {
  return request(url, "json");
}

function requestStoreJson(url, rawDataPath) {
  const run = () => requestStoreJsonWithRetry(url, rawDataPath);
  const nextQueue = getStoreRequestQueue().then(run, run);
  setStoreRequestQueue(nextQueue);
  return nextQueue;
}

async function requestStoreJsonWithRetry(url, rawDataPath) {
  if (getRateLimitState().active) {
    throw createRateLimitError();
  }

  await sleep(getStoreRequestDelayMs());
  try {
    return await requestJson(url);
  } catch (error) {
    if (isHttp429(error)) {
      setRawData(`${rawDataPath}.rateLimited`, {
        reason: "HTTP 429",
        pausedAt: new Date().toISOString()
      });
      throw createRateLimitError();
    }
    throw error;
  }
}

function requestText(url) {
  return request(url, "text");
}

function request(url, responseType) {
  return new Promise((resolve, reject) => {
    const endpoint = describeRequestEndpoint(url);
    sffaExtensionRequest({
      method: "GET",
      url,
      anonymous: false,
      withCredentials: true,
      headers: {
        "Accept": responseType === "json" ? "application/json,text/javascript,*/*;q=0.1" : "application/xml,text/xml,text/html,*/*;q=0.1"
      },
      responseType: responseType === "json" ? "json" : "text",
      timeout: 30000,
      onload(response) {
        if (response.status < 200 || response.status >= 300) {
          setRawData(`requestFailures.${endpoint}`, {
            status: response.status,
            responseText: String(response.responseText || "").slice(0, 1000)
          });
          reject(createHttpError(response.status, `HTTP ${response.status}`));
          return;
        }
        if (responseType === "json") {
          if (response.response && typeof response.response === "object") {
            resolve(response.response);
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            setRawData(`requestFailures.${endpoint}`, {
              status: response.status,
              message: t("jsonParseFailed"),
              responseText: String(response.responseText || "").slice(0, 1000)
            });
            reject(new Error(t("jsonParseFailed")));
          }
        } else {
          resolve(response.responseText || String(response.response || ""));
        }
      },
      onerror() {
        setRawData(`requestFailures.${endpoint}`, {
          message: t("networkFailed")
        });
        reject(new Error(t("networkFailed")));
      },
      ontimeout() {
        setRawData(`requestFailures.${endpoint}`, {
          message: t("requestTimeout")
        });
        reject(new Error(t("requestTimeout")));
      }
    });
  });
}

function describeRequestEndpoint(url) {
  try {
    const parsed = new URL(url);
    const interfaceName = parsed.pathname.split("/").filter(Boolean)[0] || parsed.hostname;
    const methodName = parsed.pathname.split("/").filter(Boolean)[1] || "request";
    return `${parsed.hostname}.${interfaceName}.${methodName}`.replace(/[^\w.-]/g, "_");
  } catch (error) {
    return "unknown";
  }
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createRateLimitError() {
  const error = new Error(t("requestTooFast"));
  error.name = "SteamRateLimitError";
  error.isSteamRateLimit = true;
  return error;
}

function isRateLimitError(error) {
  return Boolean(error?.isSteamRateLimit) || isHttp429(error);
}

function isHttp429(error) {
  return Number(error?.status) === 429 || /HTTP\s*429/i.test(String(error?.message || ""));
}

function sleep(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}



  return {
    createHttpError,
    createRateLimitError,
    isHttp429,
    isRateLimitError,
    requestJson,
    requestStoreJson,
    requestText,
    sleep
  };
};
