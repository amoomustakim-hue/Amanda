const cachePrefix = "Amanda-cache:";

function storageKey(key) {
  return `${cachePrefix}${key}`;
}

export function readCache(key) {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeCache(key, value) {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // ignore storage quota and private-mode failures
  }
}

export function clearCache(key) {
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // ignore storage failures
  }
}

export function clearCacheGroup(keys) {
  keys.forEach(clearCache);
}

async function parseJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof data.error === "string" && data.error ? data.error : "Request failed.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function fetchCachedJson(url, options = {}) {
  const {
    cacheKey = url,
    ttlMs = 60_000,
    redirectOnUnauthorized = true,
  } = options;

  const cached = readCache(cacheKey);
  const now = Date.now();

  if (cached?.payload && cached.expiresAt > now) {
    return cached.payload;
  }

  const headers = {};
  if (cached?.etag) {
    headers["If-None-Match"] = cached.etag;
  }

  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers,
    });

    if (response.status === 304 && cached?.payload) {
      const refreshed = {
        ...cached,
        expiresAt: now + ttlMs,
      };
      writeCache(cacheKey, refreshed);
      return refreshed.payload;
    }

    if (response.status === 401 && redirectOnUnauthorized) {
      window.location.href = "/login";
      return null;
    }

    const payload = await parseJsonResponse(response);
    writeCache(cacheKey, {
      etag: response.headers.get("etag"),
      expiresAt: now + ttlMs,
      payload,
    });
    return payload;
  } catch (error) {
    if (cached?.payload) {
      return cached.payload;
    }
    throw error;
  }
}

export async function postJson(url, body, options = {}) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers || {}),
    },
    body: JSON.stringify(body || {}),
  });

  if (response.status === 401 && options.redirectOnUnauthorized !== false) {
    window.location.href = "/login";
    return null;
  }

  return parseJsonResponse(response);
}

export function formatShortTime(isoString) {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

