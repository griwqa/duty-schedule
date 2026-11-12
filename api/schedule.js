const ALLOWED_ORIGINS = new Set([
  "https://gmarkov.gitverse.site",
  "https://griwqa.github.io",
  "https://duty-schedule-phi.vercel.app",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

const NEON_DATA_API =
  process.env.NEON_DATA_API_URL ||
  "https://ep-silent-meadow-a1wnczka.apirest.ap-southeast-1.aws.neon.tech/neondb/rest/v1";
const NEON_AUTH_URL =
  process.env.NEON_AUTH_URL ||
  "https://ep-silent-meadow-a1wnczka.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth";

let tokenCache = { value: "", expiresAt: 0 };

async function getAnonymousToken() {
  const now = Date.now();
  if (tokenCache.value && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.value;
  }
  const response = await fetch(`${NEON_AUTH_URL}/token/anonymous`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Neon auth ${response.status}`);
  }
  const data = await response.json();
  if (!data?.token) {
    throw new Error("Neon auth returned no token");
  }
  const expires = Number(data.expires_at);
  tokenCache = {
    value: data.token,
    expiresAt:
      expires > 1e12
        ? expires
        : expires > 1e9
          ? expires * 1000
          : now + 10 * 60 * 1000,
  };
  return tokenCache.value;
}

async function rpc(proc, args) {
  const call = async () => {
    const token = await getAnonymousToken();
    return fetch(`${NEON_DATA_API}/rpc/${proc}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args ?? {}),
      cache: "no-store",
    });
  };
  let response = await call();
  if (response.status === 401) {
    tokenCache = { value: "", expiresAt: 0 };
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
      `Neon HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status === 401 || response.status === 403 ? 401 : 502;
    throw error;
  }
  return data;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method === "GET") {
    try {
      const data = await rpc("get_schedule", {});
      if (data && typeof data === "object" && data.payload) {
        res
          .status(200)
          .json({ payload: data.payload, updatedAt: data.updated_at || null });
      } else {
        res.status(200).json({ payload: data ?? null, updatedAt: null });
      }
    } catch (error) {
      res
        .status(error.status || 502)
        .json({ error: error.message || "Не удалось загрузить график" });
    }
    return;
  }
  if (req.method === "POST") {
    const { password, payload } = req.body || {};
    if (typeof password !== "string" || !password) {
      res.status(400).json({ error: "Не задан общий пароль" });
      return;
    }
    if (!payload || typeof payload !== "object") {
      res.status(400).json({ error: "Пустой график" });
      return;
    }
    try {
      const data = await rpc("save_schedule", {
        p_password: password,
        p_payload: payload,
      });
      res.status(200).json({ updatedAt: data?.updated_at || null });
    } catch (error) {
      res
        .status(error.status || 502)
        .json({ error: error.message || "Не удалось сохранить график" });
    }
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}
