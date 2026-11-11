-- Хранилище общего графика в Neon Postgres через Neon Data API.
--
-- Порядок настройки:
--   1. Создайте проект на neon.com и включите Data API на нужной ветке.
--   2. В Neon Console откройте SQL Editor и выполните этот файл целиком.
--   3. Замените CHANGE_ME на общий пароль и выполните блок «Пароль» ещё раз.
--   4. В настройках Data API добавьте источники CORS:
--        http://localhost:8765
--        https://gmarkov.gitverse.site
--   5. Скопируйте из Neon Console Data API URL и Auth URL в приложение
--      (кнопка «Neon» → поля подключения).
--
-- Чтение доступно всем, у кого есть ссылка на сайт: анонимный токен Data API
-- видит только результат get_schedule(). Запись требует общего пароля,
-- который проверяется внутри save_schedule().

create extension if not exists pgcrypto;

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
revoke all on table public.schedule_state from public;
revoke all on table public.app_secrets from public;

-- Пароль ---------------------------------------------------------------------
-- Замените CHANGE_ME на общий пароль. Повторный запуск блока меняет пароль.
insert into public.app_secrets (id, password_hash)
values ('schedule', crypt('CHANGE_ME', gen_salt('bf', 10)))
on conflict (id) do update
  set password_hash = excluded.password_hash,
      updated_at = now();

-- Чтение ---------------------------------------------------------------------
create or replace function public.get_schedule()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
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
set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_updated_at timestamptz;
begin
  select password_hash into v_hash
  from public.app_secrets
  where id = 'schedule';

  if v_hash is null
     or p_password is null
     or crypt(p_password, v_hash) <> v_hash then
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
revoke all on function public.get_schedule() from public;
revoke all on function public.save_schedule(text, jsonb) from public;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anonymous', 'anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant usage on schema public to %I', role_name);
      execute format(
        'grant execute on function public.get_schedule() to %I',
        role_name
      );
      execute format(
        'grant execute on function public.save_schedule(text, jsonb) to %I',
        role_name
      );
    end if;
  end loop;
end;
$$;
