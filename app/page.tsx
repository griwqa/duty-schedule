import Link from 'next/link';
import { addEmployee } from './actions';
import ScheduleGrid from './schedule-grid';
import SubmitButton from './submit-button';
import { query } from '@/lib/db';
import {
  addDays,
  formatWeekRange,
  fromISODate,
  parseWeekParam,
  toISODate,
  weekDates,
} from '@/lib/dates';

export const dynamic = 'force-dynamic';

type Employee = { id: number; name: string };
type Duty = { duty_date: string; shift_kind: string; employee_id: number };

async function loadEmployees() {
  const result = await query<Employee>('SELECT id, name FROM employees ORDER BY lower(name), id');
  return result.rows;
}

async function loadDuties(weekStart: string) {
  const weekEnd = toISODate(addDays(fromISODate(weekStart), 7));
  const result = await query<Duty>(
    `SELECT duty_date::text AS duty_date, shift_kind, employee_id
       FROM shifts
      WHERE duty_date >= $1 AND duty_date < $2`,
    [weekStart, weekEnd],
  );
  return result.rows;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const days = weekDates(weekStart);
  const today = toISODate(new Date());
  const prevWeek = toISODate(addDays(fromISODate(weekStart), -7));
  const nextWeek = toISODate(addDays(fromISODate(weekStart), 7));

  let employees: Employee[] = [];
  let duties: Duty[] = [];
  let dbError: string | null = null;

  try {
    [employees, duties] = await Promise.all([loadEmployees(), loadDuties(weekStart)]);
  } catch (error) {
    console.error(error);
    dbError = error instanceof Error ? error.message : 'Не удалось подключиться к базе данных.';
  }

  const filled = duties.map((duty) => `${duty.duty_date}|${duty.shift_kind}|${duty.employee_id}`);

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>График дежурств</h1>
          <p className="subtitle">{formatWeekRange(weekStart)}</p>
        </div>
        <nav className="weeknav" aria-label="Навигация по неделям">
          <Link className="btn" href={`/?week=${prevWeek}`} aria-label="Предыдущая неделя">
            ←
          </Link>
          <Link className="btn" href="/">
            Текущая неделя
          </Link>
          <Link className="btn" href={`/?week=${nextWeek}`} aria-label="Следующая неделя">
            →
          </Link>
        </nav>
      </header>

      {dbError ? (
        <section className="card notice">
          <h2>База данных не подключена</h2>
          <p>{dbError}</p>
          <ol>
            <li>
              В Vercel откройте <b>Storage → Create Database → Postgres</b> и подключите базу к проекту.
            </li>
            <li>
              Переменная <code>DATABASE_URL</code> появится автоматически — сделайте Redeploy.
            </li>
            <li>
              Локально создайте <code>.env.local</code> и скопируйте туда строку подключения из панели
              Neon.
            </li>
          </ol>
        </section>
      ) : (
        <>
          <section className="card employees">
            <div className="employees__head">
              <h2>Сотрудники</h2>
              <form className="employee-form" action={addEmployee}>
                <input
                  type="text"
                  name="name"
                  placeholder="Имя сотрудника"
                  maxLength={120}
                  required
                  aria-label="Имя сотрудника"
                />
                <SubmitButton className="btn btn--primary" pendingLabel="Добавляем…">
                  Добавить
                </SubmitButton>
              </form>
            </div>
            {employees.length === 0 ? (
              <p className="hint">Добавьте сотрудников, чтобы заполнять график.</p>
            ) : (
              <p className="hint">{employees.length} сотрудников в списке. Удалить можно по «×» в строке графика.</p>
            )}
          </section>

          {employees.length === 0 ? null : (
            <>
              <p className="hint">Нажмите на клетку, чтобы назначить или снять дежурство.</p>
              <ScheduleGrid employees={employees} days={days} today={today} filled={filled} />
            </>
          )}
        </>
      )}
    </main>
  );
}
