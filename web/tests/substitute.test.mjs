import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ProductionCalendar,
  ROLE,
  SHIFT,
  createEngineer,
  extraDutyTotals,
  mergeFiveDayShift,
  normalizeFiveDayShift,
  recalculateEngineer,
  shiftHoursValue,
  validateSchedule,
} from "../core.js";

const reference = JSON.parse(
  readFileSync(fileURLToPath(new URL("./reference.json", import.meta.url)), "utf8"),
);

const nov = new ProductionCalendar(reference.calendars["2026"]);

const novDay = { weekday: "2026-11-02", weekend: "2026-11-01", holiday: "2026-11-04" };
const indexOf = (iso) => Number(iso.slice(8, 10)) - 1;
assert.ok(
  !nov.isWeekend(novDay.weekday) && !nov.isHoliday(novDay.weekday),
  "2026-11-02 is a plain weekday",
);
assert.ok(nov.isWeekend(novDay.weekend), "2026-11-01 is a weekend");
assert.ok(
  nov.isHoliday(novDay.holiday) && !nov.isWeekend(novDay.holiday),
  "2026-11-04 is a weekday holiday",
);

const fiveDay = createEngineer("Сотрудник A", ROLE.FIVE_DAY);
fiveDay.shifts = new Array(30).fill(SHIFT.OFF);
fiveDay.shifts[indexOf(novDay.weekday)] = SHIFT.DAILY;
fiveDay.shifts[indexOf(novDay.weekend)] = SHIFT.SUBSTITUTE;
fiveDay.shifts[indexOf(novDay.holiday)] = `${SHIFT.OFFICE}/${SHIFT.SUBSTITUTE}`;
recalculateEngineer(fiveDay, 15, 24, 8);
assert.equal(fiveDay.dailyCount, 1, "one extra duty shift");
assert.equal(fiveDay.substituteCount, 2, "two substitutes");
assert.equal(fiveDay.totalHours, 24 + 24 + 8 + 24, "подмена считается полными сутками");
assert.equal(shiftHoursValue(`${SHIFT.OFFICE}/${SHIFT.SUBSTITUTE}`, 15, 24, 8), 32);

assert.deepEqual(
  extraDutyTotals(fiveDay, nov, 2026, 11, true),
  { weekday: 1, holiday: 2 },
  "праздник считается по ставке выходного",
);
assert.deepEqual(
  extraDutyTotals(fiveDay, nov, 2026, 11, false),
  { weekday: 2, holiday: 1 },
  "без учёта праздников будний праздник оплачивается как будни",
);

const dutySame = createEngineer("Инженер A", ROLE.DUTY);
dutySame.shifts = fiveDay.shifts.slice();
assert.deepEqual(
  extraDutyTotals(dutySame, nov, 2026, 11, true),
  { weekday: 0, holiday: 0 },
  "сутки суточника — обычная смена, не подработка",
);

assert.equal(
  mergeFiveDayShift(SHIFT.OFFICE, SHIFT.SUBSTITUTE),
  `${SHIFT.OFFICE}/${SHIFT.SUBSTITUTE}`,
  "подмена добавляется второй частью к офису",
);
assert.equal(mergeFiveDayShift(`${SHIFT.OFFICE}/${SHIFT.SUBSTITUTE}`, SHIFT.SUBSTITUTE), SHIFT.OFFICE);
assert.equal(normalizeFiveDayShift(`${SHIFT.OFFICE}/${SHIFT.EVENING}`), SHIFT.OFFICE, "вечер больше не дежурство");

const duty = createEngineer("Инженер A", ROLE.DUTY);
duty.shifts = [SHIFT.DAILY, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF];
const cover = createEngineer("Сотрудник A", ROLE.FIVE_DAY);
cover.shifts = [SHIFT.SUBSTITUTE, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF];
assert.deepEqual(
  validateSchedule([duty, cover]).issues,
  [],
  "подмена вместо суточника — не конфликт",
);
const rival = createEngineer("Доп. инженер A", ROLE.EXTRA);
rival.shifts = [SHIFT.SUBSTITUTE, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF];
assert.match(
  validateSchedule([duty, cover, rival]).issues.join("; "),
  /день 1: подмена у 2 чел/,
  "две подмены в один день — замечание",
);

console.log("substitute.test: ok");
