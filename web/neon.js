const CONFIG_KEY = "grafik-neon-v1";

// Основная общая база — Supabase Postgres. Браузер вызывает RPC-функции
// напрямую: Data API сам раздаёт CORS, поэтому прокси для работы не нужен.
const SUPABASE_URL = "https://udxvjrnfvfkrkupsczzg.supabase.co";
const SUPABASE_KEY = "sb_publishable_J9A_stjFoYrBtPdOVuNkVA_f50jv88-";

// Резервное зеркало — прокси на Vercel поверх Neon. Пока в основной базе нет
// сохранённого графика, приложение читает данные оттуда, поэтому перенос не
// теряет ни одной правки.
const SYNC_ENDPOINTS = ["https://duty-schedule-phi.vercel.app/api"];

// Новая HTTPS-сессия до основной базы иногда устанавливается десятки секунд,
// и ждать этого нет смысла: за 9 секунд отвечают оба варианта — «база жива»
// или «берём резервное зеркало».
const PRIMARY_READ_MS = 9000;
const REQUEST_MS = 20000;

// Куда уходит запись: основная база, если она ответила на чтение (даже пустым
// результатом), иначе то зеркало, откуда прочитали график. Так сессия всегда
// пишет в одинstore и копии не расходятся внутри одного входа.
let writeTarget = null;

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
  // Неверный пароль отвечает 401 (прокси) или 403 (Data API, код 28P01).
  error.invalidPassword = /invalid password/i.test(error.message);
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

function proxyBases() {
  const bases = [];
  if (
    typeof location !== "undefined" &&
    location.hostname === "duty-schedule-phi.vercel.app"
  ) {
    bases.push(`${location.origin}/api`);
  }
  for (const base of SYNC_ENDPOINTS) {
    if (!bases.includes(base)) bases.push(base);
  }
  return bases;
}

function primaryEndpoint() {
  return {
    label: "primary",
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

function mirrorEndpoints() {
  return proxyBases().map((base) => ({
    label: "mirror",
    read: () => request(`${base}/schedule`).then(unwrapRead),
    write: (password, payload) =>
      request(`${base}/schedule`, {
        method: "POST",
        body: { password, payload },
      }).then((data) => ({ updatedAt: data?.updatedAt || null })),
  }));
}

// Ошибка по таймауту отличается от ошибки базы: она не считается «зеркало
// сломано», а только означает, что основная база не успела ответить.
async function withTimeout(promise, ms) {
  if (typeof AbortSignal === "undefined" || !AbortSignal.timeout) return promise;
  let timer = 0;
  try {
    return await Promise.race([
      promise.finally(() => {
        window.clearTimeout(timer);
        timer = 0;
      }),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => {
          const error = new Error("timeout");
          error.timeout = true;
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
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

export async function neonLoadSchedule() {
  const mirrors = mirrorEndpoints();
  let primaryError = null;
  let primaryRead = null;

  try {
    primaryRead = await withTimeout(primaryEndpoint().read(), PRIMARY_READ_MS);
    writeTarget = primaryEndpoint();
  } catch (error) {
    primaryError = error;
  }

  // Основная база ответила с графиком — других источников не нужно.
  if (primaryRead?.payload) {
    return { ...primaryRead, mirror: false };
  }

  let mirrorError = null;
  let mirrorEmpty = null;
  for (const mirror of mirrors) {
    try {
      const result = await mirror.read();
      if (result.payload) {
        // Перенос: основная база пуста, данные ещё только в резерве.
        // Пишем в ту базу, которая ответила на чтение.
        if (primaryRead) writeTarget = primaryEndpoint();
        else writeTarget = mirror;
        return { ...result, mirror: !primaryRead };
      }
      if (!mirrorEmpty) mirrorEmpty = result;
    } catch (error) {
      mirrorError = error;
    }
  }

  // Обе базы пусты — это нормальное состояние до первого сохранения.
  if (primaryRead) return { ...primaryRead, mirror: false };
  if (mirrorEmpty) {
    writeTarget = mirrors[0] || primaryEndpoint();
    return { ...mirrorEmpty, mirror: false };
  }

  // Наружу отдаём только ответ сервера: сетевой сбой без кода означает лишь
  // одно — до сервера синхронизации не дошли.
  if (primaryError?.status && !primaryError.timeout) throw primaryError;
  if (mirrorError?.status) throw mirrorError;
  throw new Error("нет связи с сервером синхронизации");
}

export async function neonSaveSchedule(config, payload) {
  if (!config?.password) {
    throw new Error("Не задан общий пароль");
  }
  const first = writeTarget || primaryEndpoint();
  const order = [first, ...mirrorEndpoints().filter((m) => m !== first)];
  if (first.label !== "primary") order.push(primaryEndpoint());

  let lastError = null;
  for (const endpoint of order) {
    try {
      const result = await endpoint.write(config.password, payload);
      writeTarget = endpoint;
      return result;
    } catch (error) {
      // Неверный пароль и кривой запрос означает конец: на других адресах
      // пароль тот же, поэтому просить войти заново нужно сразу.
      if (error.status === 400 || error.invalidPassword) throw error;
      lastError = error;
    }
  }
  if (lastError?.status) throw lastError;
  throw new Error("нет связи с сервером синхронизации");
}
