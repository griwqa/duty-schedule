import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ProductionCalendar,
  ROLE,
  SHIFT,
  buildSchedule,
  countRole,
  ensureRoleCount,
  generateLinked,
  generateRotation,
  makeExtraEngineers,
  makeFiveDayEngineers,
  normalizeStaff,
  recalculateEngineer,
  validateSchedule,
} from "../core.js";

const reference = JSON.parse(
  readFileSync(fileURLToPath(new URL("./reference.json", import.meta.url)), "utf8"),
);

const names = ["Инженер A", "Инженер B", "Инженер C", "Инженер D"];

function calendar(year) {
  return new ProductionCalendar(reference.calendars[String(year)]);
}

function calendars(...years) {
  const result = {};
  for (const year of years) result[year] = calendar(year);
  return result;
}

function assertEngineers(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: row count`);
  expected.forEach((row, index) => {
    assert.equal(actual[index].name, row.name, `${label}: name ${index}`);
    assert.equal(actual[index].role, row.role, `${label}: role ${index}`);
    assert.deepEqual(
      actual[index].shifts,
      row.shifts,
      `${label}: shifts ${row.name}`,
    );
    assert.equal(
      actual[index].totalHours,
      row.total,
      `${label}: hours ${row.name}`,
    );
  });
}

function assertValidation(actual, expected, label) {
  assert.deepEqual(actual.issues, expected.issues, `${label}: issues`);
  assert.deepEqual(
    [...actual.issueDays].sort((a, b) => a - b),
    expected.days,
    `${label}: days`,
  );
}

assertEngineers(
  generateRotation({
    year: 2026,
    month: 11,
    engineers: names,
    anchorIso: "2026-11-01",
    calendar: calendar(2026),
    useHolidays: true,
    shiftHours: 24,
  }),
  reference.rotation_2026_11,
  "rotation 2026-11",
);

assertEngineers(
  generateRotation({
    year: 2026,
    month: 11,
    engineers: names,
    anchorIso: "2026-11-01",
    calendar: calendar(2026),
    useHolidays: false,
    shiftHours: 24,
  }),
  reference.rotation_holidays_off,
  "rotation without holidays",
);

assertEngineers(
  generateRotation({
    year: 2027,
    month: 1,
    engineers: names,
    anchorIso: "2026-11-01",
    calendar: calendar(2027),
    useHolidays: true,
    shiftHours: 24,
  }),
  reference.rotation_2027_01,
  "rotation 2027-01",
);

assertEngineers(
  generateLinked({
    year: 2026,
    month: 11,
    engineers: names,
    calendars: calendars(2026, 2027),
  }),
  reference.night_2026_11,
  "night 2026-11",
);

assertEngineers(
  generateLinked({
    year: 2027,
    month: 1,
    engineers: names,
    calendars: calendars(2026, 2027),
  }),
  reference.night_2027_01,
  "night 2027-01",
);

assertEngineers(
  generateLinked({
    year: 2026,
    month: 3,
    engineers: names.slice(0, 3),
    calendars: calendars(2026),
  }),
  reference.night_2026_03_three,
  "night 2026-03 three engineers",
);

assertEngineers(
  makeFiveDayEngineers(
    [
      { name: "Сотрудник A", position: "Ведущий" },
      { name: "Сотрудник B", position: "" },
    ],
    2027,
    2,
    calendar(2027),
    8,
  ),
  reference.five_day_2027_02,
  "five day 2027-02",
);

assertEngineers(
  makeExtraEngineers(["Доп. инженер A", "Доп. инженер B"], 2026, 11),
  reference.extra_2026_11,
  "extra 2026-11",
);

assert.equal(
  calendar(2026).getNormHours(2026, 11),
  reference.norm_2026_11,
  "norm 2026-11",
);
assert.equal(
  calendar(2027).getNormHours(2027, 2),
  reference.norm_2027_02,
  "norm 2027-02",
);

const broken = generateRotation({
  year: 2026,
  month: 11,
  engineers: names,
  anchorIso: "2026-11-01",
  calendar: calendar(2026),
});
broken[0].shifts[1] = SHIFT.DAILY;
broken[0].shifts[2] = SHIFT.DAILY;
recalculateEngineer(broken[0], 24, 24);
assertValidation(validateSchedule(broken), reference.validation, "validation");

const staff = normalizeStaff({
  engineers: [
    { name: "Инженер A", role: ROLE.DUTY, position: "Начальник смены" },
    { name: "Инженер B", role: ROLE.DUTY, position: "" },
    { name: "Инженер C", role: ROLE.DUTY, position: "" },
    { name: "Инженер D", role: ROLE.DUTY, position: "" },
    { name: "Сотрудник A", role: ROLE.FIVE_DAY, position: "Ведущий" },
    { name: "Доп. инженер A", role: ROLE.EXTRA, position: "" },
  ],
});
assert.equal(countRole(staff, ROLE.DUTY), 4);
assert.equal(countRole(staff, ROLE.FIVE_DAY), 1);
assert.equal(countRole(staff, ROLE.EXTRA), 1);

const grown = ensureRoleCount(staff, ROLE.EXTRA, 3);
assert.equal(countRole(grown, ROLE.EXTRA), 3);
assert.equal(countRole(staff, ROLE.EXTRA), 1, "ensure does not mutate input");
const grownNames = grown
  .filter((member) => member.role === ROLE.EXTRA)
  .map((member) => member.name);
assert.equal(new Set(grownNames).size, grownNames.length, "unique names");
assert.equal(grownNames[0], "Доп. инженер A", "existing member kept");

const trimmed = ensureRoleCount(staff, ROLE.DUTY, 2);
assert.equal(countRole(trimmed, ROLE.DUTY), 2);
assert.equal(countRole(trimmed, ROLE.FIVE_DAY), 1, "other roles kept");

const built = buildSchedule({
  staff,
  year: 2026,
  month: 11,
  mode: "rotation",
  anchorIso: "2026-11-01",
  calendars: calendars(2026, 2027),
});
assert.equal(built.engineers.length, 6);
assert.equal(built.rows.length, 6);
assert.equal(built.rows[0].name, "Инженер A");
assert.equal(built.rows[4].name, "Сотрудник A");
assert.equal(built.rows[5].name, "Доп. инженер A");
assert.equal(built.engineers[0].position, "Начальник смены");
assert.equal(built.engineers[4].role, ROLE.FIVE_DAY);
assert.equal(built.engineers[5].role, ROLE.EXTRA);
assert.equal(built.normHours, reference.norm_2026_11);
assert.deepEqual(
  built.engineers.slice(0, 4).map((engineer) => engineer.shifts),
  reference.rotation_2026_11.map((engineer) => engineer.shifts),
  "buildSchedule duty shifts match rotation",
);

const builtNight = buildSchedule({
  staff,
  year: 2026,
  month: 11,
  mode: "night",
  anchorIso: "2026-11-01",
  calendars: calendars(2026, 2027),
});
assert.deepEqual(
  builtNight.engineers.slice(0, 4).map((engineer) => engineer.shifts),
  reference.night_2026_11.map((engineer) => engineer.shifts),
  "buildSchedule night shifts match linked",
);

const missingMonth = buildSchedule({
  staff: staff.slice(0, 4),
  year: 2025,
  month: 12,
  mode: "rotation",
  anchorIso: "2026-11-01",
  calendars: calendars(2026),
});
assert.equal(missingMonth.engineers.length, 4);
assert.equal(missingMonth.engineers[0].shifts.length, 31);
assert.ok(
  missingMonth.engineers.every((engineer) =>
    engineer.shifts.every((shift) => shift === SHIFT.DAILY || shift === SHIFT.OFF),
  ),
  "fallback calendar keeps weekday/weekend split",
);

console.log("core.js: all checks passed");
