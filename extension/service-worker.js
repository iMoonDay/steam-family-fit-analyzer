import { handleHttpRequest } from "./background/http-proxy.js";
import { openHelperPanel } from "./background/tab-actions.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "sffaHttpRequest") {
    return false;
  }

  handleHttpRequest(message.payload)
    .then(payload => sendResponse({ ok: true, payload }))
    .catch(error => sendResponse({
      ok: false,
      error: {
        message: error.message || String(error),
        status: Number(error.status || 0) || undefined,
        responseText: error.responseText || ""
      }
    }));

  return true;
});

chrome.action.onClicked.addListener(openHelperPanel);
