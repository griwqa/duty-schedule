'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function addEmployee(formData: FormData) {
  const name = String(formData.get('name') ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!name || name.length > 120) {
    return;
  }

  await query('INSERT INTO employees (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  revalidatePath('/');
}

export async function removeEmployee(employeeId: number) {
  if (!Number.isInteger(employeeId)) {
    return;
  }

  await query('DELETE FROM employees WHERE id = $1', [employeeId]);
  revalidatePath('/');
}

export async function assignDuty(date: string, formData: FormData) {
  const employeeId = Number(formData.get('employeeId'));

  if (!ISO_DATE.test(date) || !Number.isInteger(employeeId)) {
    return;
  }

  await query(
    'INSERT INTO shifts (duty_date, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [date, employeeId],
  );
  revalidatePath('/');
}

export async function removeDuty(date: string, employeeId: number) {
  if (!ISO_DATE.test(date) || !Number.isInteger(employeeId)) {
    return;
  }

  await query('DELETE FROM shifts WHERE duty_date = $1 AND employee_id = $2', [date, employeeId]);
  revalidatePath('/');
}
