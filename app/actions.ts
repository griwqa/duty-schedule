'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { SHIFT_KINDS, type ShiftKind } from '@/lib/shifts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function addEmployee(formData: FormData) {
  const name = String(formData.get('name') ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!name || name.length > 120) {
    return;
  }

  await query('INSERT INTO employees (name) VALUES ($1)', [name]);
  revalidatePath('/');
}

export async function removeEmployee(employeeId: number) {
  if (!Number.isInteger(employeeId)) {
    return;
  }

  await query('DELETE FROM employees WHERE id = $1', [employeeId]);
  revalidatePath('/');
}

export async function toggleDuty(date: string, shiftKind: string, employeeId: number) {
  if (
    !ISO_DATE.test(date) ||
    !SHIFT_KINDS.includes(shiftKind as ShiftKind) ||
    !Number.isInteger(employeeId)
  ) {
    return;
  }

  const removed = await query(
    'DELETE FROM shifts WHERE duty_date = $1 AND shift_kind = $2 AND employee_id = $3',
    [date, shiftKind, employeeId],
  );

  if (removed.rowCount === 0) {
    await query(
      `INSERT INTO shifts (duty_date, shift_kind, employee_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (duty_date, shift_kind, employee_id) DO NOTHING`,
      [date, shiftKind, employeeId],
    );
  }

  revalidatePath('/');
}
