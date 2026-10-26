import { Pool, type QueryResultRow } from 'pg';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  duty_date DATE NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE (duty_date, employee_id)
);

CREATE INDEX IF NOT EXISTS shifts_duty_date_idx ON shifts (duty_date);
`;

const globalForDb = globalThis as unknown as {
  pgPool?: Pool;
  schemaReady?: Promise<void>;
};

function getConnectionString() {
  return (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    ''
  );
}

function getPool() {
  if (globalForDb.pgPool) {
    return globalForDb.pgPool;
  }

  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL не задан. Подключите Postgres в Vercel или укажите строку подключения в .env.local.',
    );
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  globalForDb.pgPool = new Pool({
    connectionString,
    max: 3,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });

  return globalForDb.pgPool;
}

function ensureSchema() {
  if (!globalForDb.schemaReady) {
    globalForDb.schemaReady = getPool()
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((error) => {
        globalForDb.schemaReady = undefined;
        throw error;
      });
  }

  return globalForDb.schemaReady;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  const pool = getPool();
  await ensureSchema();
  return pool.query<T>(text, params);
}
