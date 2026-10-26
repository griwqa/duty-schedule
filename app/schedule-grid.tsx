'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { removeEmployee, toggleDuty } from './actions';
import { formatDayNumber, WEEKDAYS } from '@/lib/dates';
import { SHIFTS } from '@/lib/shifts';

type Employee = { id: number; name: string };

type SlotChange = { key: string; on: boolean };

export default function ScheduleGrid({
  employees,
  days,
  today,
  filled,
}: {
  employees: Employee[];
  days: string[];
  today: string;
  filled: string[];
}) {
  const [, startTransition] = useTransition();
  const [optimisticFilled, applyOptimistic] = useOptimistic<string[], SlotChange>(
    filled,
    (keys, change) =>
      change.on
        ? keys.includes(change.key)
          ? keys
          : [...keys, change.key]
        : keys.filter((key) => key !== change.key),
  );
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const filledSet = new Set(optimisticFilled);
  const busy = pendingSlots.length > 0 || removingId !== null;

  function handleToggle(date: string, shiftKind: string, employeeId: number) {
    const key = `${date}|${shiftKind}|${employeeId}`;
    if (busy) return;
    const on = !filledSet.has(key);

    setPendingSlots((slots) => [...slots, key]);
    startTransition(async () => {
      applyOptimistic({ key, on });
      try {
        await toggleDuty(date, shiftKind, employeeId);
      } finally {
        setPendingSlots((slots) => slots.filter((slot) => slot !== key));
      }
    });
  }

  function handleRemove(employeeId: number) {
    if (busy) return;
    setRemovingId(employeeId);
    startTransition(async () => {
      try {
        await removeEmployee(employeeId);
      } finally {
        setRemovingId(null);
      }
    });
  }

  return (
    <div className="schedule-scroll" aria-busy={busy}>
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
                  <button
                    type="button"
                    className="schedule__remove"
                    onClick={() => handleRemove(employee.id)}
                    disabled={busy}
                    aria-label={`Удалить ${employee.name}`}
                    title="Удалить сотрудника"
                  >
                    {removingId === employee.id ? <span className="spinner spinner--sm" /> : '×'}
                  </button>
                </div>
              </th>
              {days.flatMap((date) =>
                SHIFTS.map((shift, shiftIndex) => {
                  const key = `${date}|${shift.kind}|${employee.id}`;
                  const on = filledSet.has(key);
                  const pending = pendingSlots.includes(key);
                  const classes = ['slot'];
                  if (shiftIndex === 0) classes.push('slot--day-start');
                  if (date === today) classes.push('slot--today');
                  if (on) classes.push('slot--on');
                  if (pending) classes.push('slot--pending');
                  const label = `${on ? 'Снять' : 'Назначить'} ${employee.name} — ${shift.label}, ${formatDayNumber(date)}`;

                  return (
                    <td key={key} className={classes.join(' ')}>
                      <button
                        type="button"
                        className="slot__btn"
                        onClick={() => handleToggle(date, shift.kind, employee.id)}
                        disabled={busy}
                        aria-pressed={on}
                        aria-label={label}
                        title={label}
                      >
                        {pending ? (
                          <span className="spinner spinner--sm" aria-hidden="true" />
                        ) : on ? (
                          <span className="slot__dot" aria-hidden="true" />
                        ) : null}
                      </button>
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
