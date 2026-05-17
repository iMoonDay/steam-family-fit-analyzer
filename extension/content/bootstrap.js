(async function bootstrapSteamFamilyGroupHelperContent() {
  "use strict";

  const PAGE_STATE_ATTRIBUTE = "data-sffa-extension-page-state";
  const PAGE_STATE_EVENT = "sffa-extension-page-state";
  const PAGE_STATE_REQUEST_EVENT = "sffa-extension-request-page-state";

  globalThis.sffaExtensionReady = createExtensionRuntime();

  async function createExtensionRuntime() {
    const storageCache = await loadStorage();
    const pageState = readPageState();

    window.addEventListener(PAGE_STATE_EVENT, () => {
      Object.assign(pageState, readPageState());
    });
    window.dispatchEvent(new Event(PAGE_STATE_REQUEST_EVENT));

    if (isExtensionContextAvailable()) {
      chrome.runtime.onMessage.addListener(message => {
        if (message?.type === "sffaOpenPanel") {
          document.dispatchEvent(new CustomEvent("sffa-extension-open"));
        }
      });
    }

    return {
      sffaExtensionDeleteValue: key => deleteValue(storageCache, key),
      sffaExtensionGetValue: (key, defaultValue) => getValue(storageCache, key, defaultValue),
      sffaExtensionPageState: pageState,
      sffaExtensionRequest,
      sffaExtensionSetValue: (key, value) => setValue(storageCache, key, value)
    };
  }

  function loadStorage() {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextAvailable()) {
        reject(createExtensionContextError());
        return;
      }
      try {
        chrome.storage.local.get(null, items => {
          const error = getRuntimeLastError();
          if (error) {
            reject(new Error(error.message || "Failed to load extension storage"));
            return;
          }
          resolve(items || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function readPageState() {
    const raw = document.documentElement.getAttribute(PAGE_STATE_ATTRIBUTE);
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw) || {};
    } catch (error) {
      console.warn("Steam Family Group Helper: failed to read page state", error);
      return {};
    }
  }

  function getValue(storageCache, key, defaultValue) {
    return Object.prototype.hasOwnProperty.call(storageCache, key)
      ? storageCache[key]
      : defaultValue;
  }

  function setValue(storageCache, key, value) {
    storageCache[key] = value;
    if (!isExtensionContextAvailable()) {
      return;
    }
    try {
      chrome.storage.local.set({ [key]: value }, () => {
        const error = getRuntimeLastError();
        if (error) {
          if (isExtensionContextError(error)) {
            return;
          }
          console.error("Steam Family Group Helper: failed to save extension storage", error);
        }
      });
    } catch (error) {
      if (!isExtensionContextError(error)) {
        console.warn("Steam Family Group Helper: failed to start extension storage save", error);
      }
    }
  }

  function deleteValue(storageCache, key) {
    delete storageCache[key];
    if (!isExtensionContextAvailable()) {
      return;
    }
    try {
      chrome.storage.local.remove(key, () => {
        const error = getRuntimeLastError();
        if (error) {
          if (isExtensionContextError(error)) {
            return;
          }
          console.error("Steam Family Group Helper: failed to delete extension storage", error);
        }
      });
    } catch (error) {
      if (!isExtensionContextError(error)) {
        console.warn("Steam Family Group Helper: failed to start extension storage delete", error);
      }
    }
  }

  function sffaExtensionRequest(options) {
    const requestOptions = options || {};
    let settled = false;
    let timeoutId = 0;

    if (Number(requestOptions.timeout) > 0) {
      timeoutId = window.setTimeout(() => {
        settled = true;
        requestOptions.ontimeout?.();
      }, Number(requestOptions.timeout));
    }

    if (!isExtensionContextAvailable()) {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      settled = true;
      requestOptions.onerror?.({ error: createExtensionContextError() });
      return;
    }

    try {
      chrome.runtime.sendMessage({
        type: "sffaHttpRequest",
        payload: {
          method: requestOptions.method || "GET",
          url: requestOptions.url,
          responseType: requestOptions.responseType === "json" ? "json" : "text",
          headers: requestOptions.headers || {}
        }
      }, response => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }

        const error = getRuntimeLastError();
        if (error) {
          requestOptions.onerror?.({ error });
          return;
        }

        if (!response?.ok) {
          const status = Number(response?.error?.status || 0);
          if (status) {
            requestOptions.onload?.({
              status,
              responseText: response?.error?.responseText || response?.error?.message || "",
              response: null
            });
            return;
          }
          requestOptions.onerror?.({ error: response?.error || new Error("Extension request failed") });
          return;
        }

        requestOptions.onload?.(response.payload || { status: 0, responseText: "", response: null });
      });
    } catch (error) {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      settled = true;
      requestOptions.onerror?.({ error });
    }
  }

  function isExtensionContextAvailable() {
    try {
      return Boolean(chrome?.runtime?.id && chrome?.storage?.local);
    } catch (error) {
      return false;
    }
  }

  function getRuntimeLastError() {
    try {
      return chrome.runtime.lastError || null;
    } catch (error) {
      return createExtensionContextError();
    }
  }

  function createExtensionContextError() {
    return new Error("Extension context invalidated. Reload the Steam page after reloading the extension.");
  }

  function isExtensionContextError(error) {
    const message = String(error?.message || error || "");
    return message.includes("Extension context invalidated");
  }
}()).catch(error => {
  console.error("Steam Family Group Helper content runtime failed to initialize", error);
});
