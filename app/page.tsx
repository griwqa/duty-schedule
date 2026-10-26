import Link from 'next/link';
import { addEmployee, assignDuty, removeDuty, removeEmployee } from './actions';
import { query } from '@/lib/db';
import {
  addDays,
  formatDayNumber,
  formatWeekRange,
  fromISODate,
  parseWeekParam,
  toISODate,
  WEEKDAYS,
  weekDates,
} from '@/lib/dates';

export const dynamic = 'force-dynamic';

type Employee = { id: number; name: string };
type Shift = { duty_date: string; employee_id: number; name: string };

async function loadEmployees() {
  const result = await query<Employee>('SELECT id, name FROM employees ORDER BY lower(name)');
  return result.rows;
}

async function loadShifts(weekStart: string) {
  const weekEnd = toISODate(addDays(fromISODate(weekStart), 7));
  const result = await query<Shift>(
    `SELECT s.duty_date::text AS duty_date, s.employee_id, e.name
       FROM shifts s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.duty_date >= $1 AND s.duty_date < $2
      ORDER BY s.duty_date, lower(e.name)`,
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
  let shifts: Shift[] = [];
  let dbError: string | null = null;

  try {
    [employees, shifts] = await Promise.all([loadEmployees(), loadShifts(weekStart)]);
  } catch (error) {
    console.error(error);
    dbError = error instanceof Error ? error.message : 'Не удалось подключиться к базе данных.';
  }

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
                <button className="btn btn--primary" type="submit">
                  Добавить
                </button>
              </form>
            </div>
            {employees.length === 0 ? (
              <p className="hint">Добавьте сотрудников, чтобы назначать дежурства.</p>
            ) : (
              <ul className="chips">
                {employees.map((employee) => (
                  <li key={employee.id} className="chip">
                    <span>{employee.name}</span>
                    <form action={removeEmployee.bind(null, employee.id)}>
                      <button
                        className="chip__x"
                        type="submit"
                        aria-label={`Удалить ${employee.name}`}
                        title="Удалить сотрудника"
                      >
                        ×
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="week-scroll">
            <section className="week" aria-label="Неделя">
              {days.map((date, index) => {
                const dayShifts = shifts.filter((shift) => shift.duty_date === date);
                const assigned = new Set(dayShifts.map((shift) => shift.employee_id));
                const available = employees.filter((employee) => !assigned.has(employee.id));
                const isWeekend = index >= 5;
                const classNames = ['day'];
                if (isWeekend) classNames.push('day--weekend');
                if (date === today) classNames.push('day--today');

                return (
                  <article key={date} className={classNames.join(' ')}>
                    {date === today && <span className="day__today">сегодня</span>}
                    <header className="day__head">
                      <span className="day__wd">{WEEKDAYS[index]}</span>
                      <span className="day__date">{formatDayNumber(date)}</span>
                    </header>

                    <ul className="day__list">
                      {dayShifts.map((shift) => (
                        <li key={shift.employee_id} className="duty">
                          <span className="duty__name" title={shift.name}>
                            {shift.name}
                          </span>
                          <form action={removeDuty.bind(null, date, shift.employee_id)}>
                            <button
                              className="duty__x"
                              type="submit"
                              aria-label={`Снять ${shift.name} с ${date}`}
                              title="Снять с дежурства"
                            >
                              ×
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>

                    {available.length > 0 && (
                      <form className="day__add" action={assignDuty.bind(null, date)}>
                        <select
                          name="employeeId"
                          defaultValue=""
                          required
                          aria-label={`Назначить дежурного на ${date}`}
                        >
                          <option value="" disabled>
                            назначить
                          </option>
                          {available.map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.name}
                            </option>
                          ))}
                        </select>
                        <button className="day__submit" type="submit" aria-label="Назначить дежурного">
                          +
                        </button>
                      </form>
                    )}
                  </article>
                );
              })}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
