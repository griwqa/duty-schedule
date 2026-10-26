# График дежурств

Недельный график дежурств сотрудников: Next.js (App Router) + Postgres, без ORM.
Развёртывается на Vercel из GitHub-репозитория.

## Как устроено

- Сотрудники: `employees (id, name)`
- Дежурства: `shifts (duty_date, employee_id)`, уникальная пара «день + сотрудник»
- Таблицы создаются автоматически при первом запросе (`CREATE TABLE IF NOT EXISTS`)
- Мутации — через Server Actions, без отдельного API

## Локальный запуск

```bash
npm install
cp .env.example .env.local   # впишите свою строку подключения
npm run dev
```

Строка подключения подойдёт от Neon, Supabase или локального Postgres.
Для локальной базы без SSL используйте `postgresql://user:pass@localhost:5432/duty`.

## Публикация на Vercel

1. `git init && git add . && git commit -m "Duty schedule"` и запушьте в новый репозиторий на GitHub.
2. На [vercel.com/new](https://vercel.com/new) импортируйте репозиторий — фреймворк определится сам.
3. В проекте: **Storage → Create Database → Postgres** (Neon) → **Connect** к проекту.
4. Сделайте **Redeploy**. Переменная `DATABASE_URL` подставится автоматически.
5. Каждый `git push` в основную ветку — новый деплой, PR — preview-окружение.

## Ограничения

Аутентификации нет: у кого есть ссылка, тот может менять график.
Если нужно — закройте проект приватным доступом в Vercel (Deployment Protection)
или добавьте пароль на редактирование.
