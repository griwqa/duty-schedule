import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ProductionCalendar,
  ROLE,
  SHIFT,
  buildSchedule,
  calendarFromMonthWeekends,
  cleanMember,
  createEngineer,
  extraDutyTotals,
  mergeFiveDayShift,
  normalizeFiveDayShift,
  overtimePay,
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
  { weekday: 1, holiday: 0, substitute: 2 },
  "сутки считаются по типу дня, подмена — отдельной ставкой",
);
assert.deepEqual(
  extraDutyTotals(fiveDay, nov, 2026, 11, false),
  { weekday: 1, holiday: 0, substitute: 2 },
  "на подмену флаг праздников не влияет",
);

const dutySame = createEngineer("Инженер A", ROLE.DUTY);
dutySame.shifts = fiveDay.shifts.slice();
assert.deepEqual(
  extraDutyTotals(dutySame, nov, 2026, 11, true),
  { weekday: 0, holiday: 0, substitute: 0 },
  "сутки суточника — обычная смена, не подработка",
);

// Переработка: оклад / 176 ч × часы по дням × коэффициент.
const paid = createEngineer("Сотрудник B", ROLE.FIVE_DAY, "", "", 176_000);
paid.shifts = new Array(30).fill(SHIFT.OFF);
paid.overtimeByDay = new Array(30).fill(0);
paid.overtimeByDay[0] = 4;
paid.overtimeByDay[1] = 2;
recalculateEngineer(paid, 15, 24, 8);
assert.equal(paid.overtimeTotal, 6, "часы берутся только из отметок по дням");
assert.equal(overtimePay(paid, 1.5), 9_000, "176000 / 176 × 6 × 1,5");
assert.equal(overtimePay(paid, 1), 6_000, "коэффициент влияет на сумму");
assert.equal(overtimePay(createEngineer("Без оклада", ROLE.FIVE_DAY), 1.5), 0);

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

// Суточная пятидневщика дополняет дежурство суточника, а не спорит с ним.
const helper = createEngineer("Сотрудник B", ROLE.FIVE_DAY);
helper.shifts = [SHIFT.DAILY, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF];
assert.deepEqual(
  validateSchedule([duty, helper]).issues,
  [],
  "С суточника и пятидневщика в один день — не замечание",
);
const secondDuty = createEngineer("Инженер B", ROLE.DUTY);
secondDuty.shifts = [SHIFT.DAILY, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF, SHIFT.OFF];
assert.match(
  validateSchedule([duty, secondDuty, helper]).issues.join("; "),
  /день 1: на смене 2 чел/,
  "два суточника в один день по-прежнему замечание",
);

// Оклад — staff-свойство: доезжает до карточки через buildSchedule.
const staff = [
  cleanMember({ name: "Инженер A", salary: "150000" }),
  cleanMember({ name: "Сотрудник A", role: ROLE.FIVE_DAY, salary: 176000 }),
];
assert.equal(staff[0].salary, 150000, "строковый оклад становится числом");
assert.equal(cleanMember({ name: "Инженер B", salary: -5 }).salary, 0, "отрицательный оклад не хранится");
const built = buildSchedule({
  staff,
  year: 2026,
  month: 11,
  calendars: reference.calendars,
  anchorIso: "2026-11-01",
});
const builtFive = built.engineers.find((engineer) => engineer.role === ROLE.FIVE_DAY);
assert.equal(builtFive.salary, 176000, "оклад пятидневника попадает в график");

console.log("substitute.test: ok");
