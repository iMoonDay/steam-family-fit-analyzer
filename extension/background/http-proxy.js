import { REQUEST_ALLOWLIST } from "./request-allowlist.js";

export async function handleHttpRequest(payload = {}) {
  const url = String(payload.url || "");
  const responseType = payload.responseType === "json" ? "json" : "text";
  const headers = payload.headers && typeof payload.headers === "object" ? payload.headers : {};

  assertAllowedRequest(url);

  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers
  });
  const responseText = await response.text();

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.responseText = responseText;
    throw error;
  }

  return {
    status: response.status,
    responseText,
    response: responseType === "json" ? parseJsonResponse(responseText) : responseText
  };
}

function parseJsonResponse(responseText) {
  try {
    return responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    return null;
  }
}

function assertAllowedRequest(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new Error("Invalid request URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS requests are allowed");
  }

  const rule = REQUEST_ALLOWLIST.find(item => item.host === url.hostname);
  if (!rule) {
    throw new Error(`Blocked request URL: ${url.hostname}${url.pathname}`);
  }

  const exactAllowed = Array.isArray(rule.exactPaths) && rule.exactPaths.includes(url.pathname);
  const prefixAllowed = Array.isArray(rule.pathPrefixes) && rule.pathPrefixes.some(prefix => url.pathname.startsWith(prefix));
  if (!exactAllowed && !prefixAllowed) {
    throw new Error(`Blocked request URL: ${url.hostname}${url.pathname}`);
  }
}
