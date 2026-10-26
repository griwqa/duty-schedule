import Link from 'next/link';
import { addEmployee, removeEmployee, toggleDuty } from './actions';
import { query } from '@/lib/db';
import { SHIFTS } from '@/lib/shifts';
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

  const filled = new Set(duties.map((duty) => `${duty.duty_date}|${duty.shift_kind}|${duty.employee_id}`));

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
              <p className="hint">Добавьте сотрудников, чтобы заполнять график.</p>
            ) : (
              <p className="hint">{employees.length} сотрудников в списке. Удалить можно по «×» в строке графика.</p>
            )}
          </section>

          {employees.length === 0 ? null : (
            <>
              <p className="hint">Нажмите на клетку, чтобы назначить или снять дежурство.</p>
              <div className="schedule-scroll">
                <table className="schedule">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="schedule__emp schedule__corner" scope="col">
                        Сотрудник
                      </th>
                      {days.map((date, index) => {
                        const classes = ['schedule__day'];
                        if (index >= 5) classes.push('schedule__day--weekend');
                        if (date === today) classes.push('schedule__day--today');
                        return (
                          <th key={date} colSpan={SHIFTS.length} className={classes.join(' ')} scope="col">
                            <span className="schedule__wd">{WEEKDAYS[index]}</span>
                            <span className="schedule__date">{formatDayNumber(date)}</span>
                            {date === today && <span className="schedule__badge">сегодня</span>}
                          </th>
                        );
                      })}
                    </tr>
                    <tr>
                      {days.flatMap((date) =>
                        SHIFTS.map((shift, shiftIndex) => (
                          <th
                            key={`${date}-${shift.kind}`}
                            className={`schedule__shift ${shiftIndex === 0 ? 'schedule__day-start' : ''}`}
                            scope="col"
                          >
                            {shift.label}
                          </th>
                        )),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((employee) => (
                      <tr key={employee.id}>
                        <th scope="row" className="schedule__emp">
                          <div className="schedule__emp-inner">
                            <span className="schedule__name" title={employee.name}>
                              {employee.name}
                            </span>
                            <form action={removeEmployee.bind(null, employee.id)}>
                              <button
                                className="schedule__remove"
                                type="submit"
                                aria-label={`Удалить ${employee.name}`}
                                title="Удалить сотрудника"
                              >
                                ×
                              </button>
                            </form>
                          </div>
                        </th>
                        {days.flatMap((date) =>
                          SHIFTS.map((shift, shiftIndex) => {
                            const on = filled.has(`${date}|${shift.kind}|${employee.id}`);
                            const classes = ['slot'];
                            if (shiftIndex === 0) classes.push('slot--day-start');
                            if (date === today) classes.push('slot--today');
                            if (on) classes.push('slot--on');
                            const label = `${on ? 'Снять' : 'Назначить'} ${employee.name} — ${shift.label}, ${formatDayNumber(date)}`;

                            return (
                              <td key={`${date}-${shift.kind}-${employee.id}`} className={classes.join(' ')}>
                                <form action={toggleDuty.bind(null, date, shift.kind, employee.id)}>
                                  <button
                                    type="submit"
                                    className="slot__btn"
                                    aria-pressed={on}
                                    aria-label={label}
                                    title={label}
                                  >
                                    {on && <span className="slot__dot" aria-hidden="true" />}
                                  </button>
                                </form>
                              </td>
                            );
                          }),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
