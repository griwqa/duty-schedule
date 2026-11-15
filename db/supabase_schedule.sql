-- Общая база графика в Supabase Postgres (проект udxvjrnfvfkrkupsczzg).
--
-- Это порт db/neon_schedule.sql под Supabase. Отличия:
--   1. pgcrypto уже установлен в схеме extensions, поэтому search_path функций
--      включает extensions — иначе вызовы crypt() / gen_salt() не находятся.
--   2. Роли в Supabase называются anon и authenticated (в Neon — anonymous).
--   3. Хеш общего пароля не создаётся здесь: его копируют из Neon, чтобы один
--      и тот же пароль подходил к обеим базам (см. блок «Пароль» ниже).
--
-- Порядок настройки:
--   1. Создать проект на supabase.com и дождаться статуса healthy.
--   2. Выполнить этот файл целиком в SQL Editor.
--   3. Скопировать хеш из Neon и вставить его в Supabase (блок «Пароль»).
--   4. Скопировать из Project Settings → API anon key (или publishable key)
--      и URL проекта, заполнить SUPABASE_URL / SUPABASE_KEY в web/supabase.js.
--   5. CORS настраивать не нужно: Data API Supabase отвечает любому источнику,
--      поэтому браузер с любого зеркала ходит в базу напрямую.

create table if not exists public.schedule_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_secrets (
  id text primary key,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.schedule_state enable row level security;
alter table public.app_secrets enable row level security;

-- Прямой доступ к таблицам закрыт: работаем только через функции ниже.
revoke all on table public.schedule_state from public, anon, authenticated;
revoke all on table public.app_secrets from public, anon, authenticated;

-- Чтение ---------------------------------------------------------------------
create or replace function public.get_schedule()
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'payload', payload,
    'updated_at', updated_at
  )
  from public.schedule_state
  where id = 'schedule';
$$;

-- Запись ---------------------------------------------------------------------
create or replace function public.save_schedule(p_password text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_updated_at timestamptz;
begin
  select password_hash into v_hash
  from public.app_secrets
  where id = 'schedule';

  if v_hash is null then
    -- База ещё не выпущена: хеш пароля не записан, записывать нельзя.
    -- Код 53000 Data API отдаёт как HTTP 503 — это состояние базы, а не
    -- неверный пароль.
    raise exception 'schedule is not initialized' using errcode = '53000';
  end if;

  if p_password is null or crypt(p_password, v_hash) <> v_hash then
    -- Небольшая задержка замедляет перебор пароля.
    perform pg_sleep(0.5);
    raise exception 'invalid password' using errcode = '28P01';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  if octet_length(p_payload::text) > 1048576 then
    raise exception 'payload too large' using errcode = '54000';
  end if;

  insert into public.schedule_state (id, payload, updated_at)
  values ('schedule', p_payload, now())
  on conflict (id) do update
    set payload = excluded.payload,
        updated_at = now()
  returning updated_at into v_updated_at;

  return jsonb_build_object('ok', true, 'updated_at', v_updated_at);
end;
$$;

-- Права ----------------------------------------------------------------------
revoke all on function public.get_schedule() from public, anon, authenticated;
revoke all on function public.save_schedule(text, jsonb) from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant execute on function public.get_schedule() to anon, authenticated;
grant execute on function public.save_schedule(text, jsonb) to anon, authenticated;

-- Пароль ---------------------------------------------------------------------
-- Хеш переносится из Neon, поэтому пароль редактирования не меняется и подходит
-- к обеим базам. В Neon:
--   select password_hash from public.app_secrets where id = 'schedule';
-- В Supabase — вставить полученное значение вместо <hash> и выполнить:
--
-- insert into public.app_secrets (id, password_hash)
-- values ('schedule', '<hash>')
-- on conflict (id) do update
--   set password_hash = excluded.password_hash,
--       updated_at = now();
--
-- Если хеш недоступен, можно выпустить новый пароль (передайте его участникам)
-- и выполнить этот блок целиком, заменив CHANGE_ME:
--
-- insert into public.app_secrets (id, password_hash)
-- values ('schedule', crypt('CHANGE_ME', gen_salt('bf', 10)))
-- on conflict (id) do update
--   set password_hash = excluded.password_hash,
--       updated_at = now();
