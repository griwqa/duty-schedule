const CONFIG_KEY = "grafik-neon-v1";

export const DEFAULT_NEON = {
  dataApiUrl:
    "https://ep-silent-meadow-a1wnczka.apirest.ap-southeast-1.aws.neon.tech/neondb/rest/v1",
  authUrl:
    "https://ep-silent-meadow-a1wnczka.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth",
  password: "",
  autosave: true,
  lastUpdatedAt: "",
};

export function normalizeDataApiUrl(raw) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  return /\/rest\/v1$/.test(value) ? value : `${value}/rest/v1`;
}

export function normalizeAuthUrl(raw) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

export function neonConfigured(config) {
  return Boolean(config?.dataApiUrl && config?.authUrl);
}

export function readNeonConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return {
      dataApiUrl: normalizeDataApiUrl(saved?.dataApiUrl || DEFAULT_NEON.dataApiUrl),
      authUrl: normalizeAuthUrl(saved?.authUrl || DEFAULT_NEON.authUrl),
      password: typeof saved?.password === "string" ? saved.password : "",
      autosave: saved?.autosave !== false,
      lastUpdatedAt:
        typeof saved?.lastUpdatedAt === "string" ? saved.lastUpdatedAt : "",
    };
  } catch {
    return { ...DEFAULT_NEON };
  }
}

export function writeNeonConfig(config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // The password stays in memory if storage is unavailable.
  }
}

let tokenCache = { value: "", expiresAt: 0, authUrl: "" };

function timeoutSignal(ms) {
  return typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function getAnonymousToken(authUrl) {
  const now = Date.now();
  if (
    tokenCache.value &&
    tokenCache.authUrl === authUrl &&
    tokenCache.expiresAt - 60_000 > now
  ) {
    return tokenCache.value;
  }
  const response = await fetch(`${authUrl}/token/anonymous`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: timeoutSignal(8000),
  });
  if (!response.ok) {
    throw new Error(`Auth ${response.status}`);
  }
  const data = await response.json();
  const token = data?.token;
  if (!token) {
    throw new Error("Auth endpoint returned no token");
  }
  const expires = Number(data.expires_at);
  const expiresAt =
    expires > 1e12
      ? expires
      : expires > 1e9
        ? expires * 1000
        : now + 10 * 60 * 1000;
  tokenCache = { value: token, expiresAt, authUrl };
  return token;
}

async function request(config, path, body) {
  const call = async () => {
    const token = await getAnonymousToken(config.authUrl);
    return fetch(`${normalizeDataApiUrl(config.dataApiUrl)}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal: timeoutSignal(15000),
    });
  };

  let response = await call();
  if (response.status === 401) {
    tokenCache = { value: "", expiresAt: 0, authUrl: "" };
    response = await call();
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message =
      (data && typeof data === "object" && (data.message || data.details)) ||
      (typeof data === "string" && data) ||
      `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function neonLoadSchedule(config) {
  const data = await request(config, "/rpc/get_schedule", {});
  if (data === null || data === undefined) return null;
  if (data.payload && typeof data.payload === "object") {
    return { payload: data.payload, updatedAt: data.updated_at || null };
  }
  return { payload: data, updatedAt: null };
}

export async function neonSaveSchedule(config, payload) {
  if (!config.password) {
    throw new Error("Не задан общий пароль");
  }
  const data = await request(config, "/rpc/save_schedule", {
    p_password: config.password,
    p_payload: payload,
  });
  return { updatedAt: data?.updated_at || null };
}
