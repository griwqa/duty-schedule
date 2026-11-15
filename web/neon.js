const CONFIG_KEY = "grafik-neon-v1";

// Общая база выбирается один раз — по адресу страницы и не меняется во время
// работы: копия на Vercel обслуживает Neon через свой же прокси /api, остальные
// адреса (GitVerse Pages, GitHub Pages, локальный запуск) работают с Supabase
// напрямую. Переключения нет: не отвечает выбранная база — значит «нет связи»,
// на другую приложение не уходит, а правки между базами переносят вручную.
const SUPABASE_URL = "https://udxvjrnfvfkrkupsczzg.supabase.co";
const SUPABASE_KEY = "sb_publishable_J9A_stjFoYrBtPdOVuNkVA_f50jv88-";
const NEON_HOST = "duty-schedule-phi.vercel.app";

const REQUEST_MS = 20000;

function timeoutSignal(ms) {
  return typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : undefined;
}

function restError(status, data) {
  const message =
    (data && typeof data === "object" && (data.message || data.error)) ||
    (typeof data === "string" && data) ||
    `HTTP ${status}`;
  const error = new Error(String(message));
  error.status = status;
  return error;
}

async function request(url, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: timeoutSignal(REQUEST_MS),
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
  if (!response.ok) throw restError(response.status, data);
  return data;
}

// Пустая база (Data API отдаёт null) и ответ прокси сводятся к одному виду.
function unwrapRead(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { payload: null, updatedAt: null };
  }
  const payload =
    data.payload && typeof data.payload === "object" ? data.payload : null;
  return { payload, updatedAt: data.updated_at || data.updatedAt || null };
}

const supabaseHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

// Единственная база этой копии приложения: прокси на своём же адресе либо
// Supabase, который браузер видит напрямую с любого зеркала.
function currentStore() {
  if (typeof location !== "undefined" && location.hostname === NEON_HOST) {
    const base = `${location.origin}/api`;
    return {
      read: () => request(`${base}/schedule`).then(unwrapRead),
      write: (password, payload) =>
        request(`${base}/schedule`, {
          method: "POST",
          body: { password, payload },
        }).then((data) => ({ updatedAt: data?.updatedAt || null })),
    };
  }
  return {
    read: () =>
      request(`${SUPABASE_URL}/rest/v1/rpc/get_schedule`, {
        method: "POST",
        body: {},
        headers: supabaseHeaders,
      }).then(unwrapRead),
    write: (password, payload) =>
      request(`${SUPABASE_URL}/rest/v1/rpc/save_schedule`, {
        method: "POST",
        body: { p_password: password, p_payload: payload },
        headers: supabaseHeaders,
      }).then((data) => ({ updatedAt: data?.updated_at || null })),
  };
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
    // Пароль остаётся в памяти, если хранилище браузера недоступно.
  }
}

// Сетевой сбой без кода ответа означает одно: до сервера синхронизации не
// дошли. Другой базы у этой копии приложения нет, на неё она не уходит.
export async function neonLoadSchedule() {
  try {
    return await currentStore().read();
  } catch (error) {
    if (error.status) throw error;
    throw new Error("нет связи с сервером синхронизации");
  }
}

export async function neonSaveSchedule(config, payload) {
  if (!config?.password) {
    throw new Error("Не задан общий пароль");
  }
  try {
    return await currentStore().write(config.password, payload);
  } catch (error) {
    if (error.status) throw error;
    throw new Error("нет связи с сервером синхронизации");
  }
}
