export const SHIFTS = [
  { kind: 'morning', label: 'утро' },
  { kind: 'evening', label: 'вечер' },
  { kind: 'night', label: 'ночь' },
] as const;

export type ShiftKind = (typeof SHIFTS)[number]['kind'];

export const SHIFT_KINDS: readonly ShiftKind[] = SHIFTS.map((shift) => shift.kind);
