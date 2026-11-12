const CONFIG_KEY = "grafik-neon-v1";

function apiBase() {
  if (
    typeof location !== "undefined" &&
    location.hostname === "duty-schedule-phi.vercel.app"
  ) {
    return `${location.origin}/api`;
  }
  return "https://duty-schedule-phi.vercel.app/api";
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: timeoutSignal(20000),
  });
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
      (data && typeof data === "object" && data.error) ||
      (typeof data === "string" && data) ||
      `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function neonConfigured() {
  return true;
}

export function readNeonConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return {
      password: typeof saved?.password === "string" ? saved.password : "",
      autosave: saved?.autosave !== false,
      lastUpdatedAt:
        typeof saved?.lastUpdatedAt === "string" ? saved.lastUpdatedAt : "",
    };
  } catch {
    return { password: "", autosave: true, lastUpdatedAt: "" };
  }
}

export function writeNeonConfig(config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // The password stays in memory if storage is unavailable.
  }
}

export async function neonLoadSchedule() {
  const data = await apiRequest("/schedule");
  if (data === null || data === undefined) return null;
  return { payload: data.payload ?? null, updatedAt: data.updatedAt || null };
}

export async function neonSaveSchedule(config, payload) {
  if (!config?.password) {
    throw new Error("Не задан общий пароль");
  }
  const data = await apiRequest("/schedule", {
    method: "POST",
    body: { password: config.password, payload },
  });
  return { updatedAt: data?.updatedAt || null };
}
