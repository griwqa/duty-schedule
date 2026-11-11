export const ROLE = {
  DUTY: "duty",
  FIVE_DAY: "five_day",
  EXTRA: "extra",
};

export const ROLES = [ROLE.DUTY, ROLE.FIVE_DAY, ROLE.EXTRA];

export const ROLE_TITLES = {
  [ROLE.DUTY]: "Суточник",
  [ROLE.FIVE_DAY]: "5-дневный график",
  [ROLE.EXTRA]: "Доп. инженер (подмена)",
};

export const ROLE_PREFIXES = {
  [ROLE.DUTY]: "Инженер",
  [ROLE.FIVE_DAY]: "Сотрудник",
  [ROLE.EXTRA]: "Доп. инженер",
};

export const SHIFT = {
  NIGHT: "Н",
  DAILY: "С",
  OFF: "",
  MORNING: "У",
  DAY: "Д",
  EVENING: "В",
  OFFICE: "о",
  REMOTE: "у",
  TRIP: "в",
  VACATION: "Отп",
};

export const DEFAULT_NAMES = ["Инженер A", "Инженер B", "Инженер C"];

const DUTY_SHIFTS = new Set([SHIFT.NIGHT, SHIFT.DAILY]);

export const FIVE_DAY_BASE_SHIFTS = new Set([
  SHIFT.OFFICE,
  SHIFT.REMOTE,
  SHIFT.TRIP,
]);

export const FIVE_DAY_DUTY_SHIFTS = new Set([
  SHIFT.MORNING,
  SHIFT.EVENING,
  SHIFT.NIGHT,
]);

export function splitShift(shift) {
  return String(shift ?? "")
    .split("/")
    .filter(Boolean);
}

export function joinShift(parts) {
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    result.push(part);
  }
  return result.join("/");
}

export function shiftHas(shift, code) {
  return splitShift(shift).includes(code);
}

export function mergeFiveDayShift(current, choice) {
  const parts = splitShift(current);
  const base = parts.find((part) => FIVE_DAY_BASE_SHIFTS.has(part)) || "";
  const duty = parts.find((part) => FIVE_DAY_DUTY_SHIFTS.has(part)) || "";
  if (!choice) return SHIFT.OFF;
  if (FIVE_DAY_BASE_SHIFTS.has(choice)) {
    if (choice !== base) return joinShift([choice, duty]);
    return duty ? joinShift([duty]) : joinShift([base]);
  }
  if (FIVE_DAY_DUTY_SHIFTS.has(choice)) {
    if (choice !== duty) return joinShift([base, choice]);
    return base ? joinShift([base]) : joinShift([duty]);
  }
  return choice;
}

export function normalizeFiveDayShift(value) {
  const parts = splitShift(value);
  if (parts.includes(SHIFT.VACATION)) return SHIFT.VACATION;
  const base =
    parts.find((part) => FIVE_DAY_BASE_SHIFTS.has(part)) || "";
  const duty =
    parts.find((part) => FIVE_DAY_DUTY_SHIFTS.has(part)) || "";
  return joinShift([base, duty]);
}

const DAY_MS = 86400000;

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dayNumber(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function isoDate(year, month, day) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export function isoWeekday(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export class ProductionCalendar {
  constructor(data = null) {
    this.days = new Map();
    if (data) this.loadFromDict(data);
  }

  loadFromDict(data) {
    for (const [iso, info] of Object.entries(data || {})) {
      this.days.set(iso, {
        weekend: Boolean(info?.weekend),
        holiday: Boolean(info?.holiday),
        short: Boolean(info?.short),
      });
    }
  }

  has(iso) {
    return this.days.has(iso);
  }

  isWeekend(iso) {
    const record = this.days.get(iso);
    if (record) return record.weekend;
    const wd = isoWeekday(iso);
    return wd === 0 || wd === 6;
  }

  isHoliday(iso) {
    return Boolean(this.days.get(iso)?.holiday);
  }

  isShort(iso) {
    return Boolean(this.days.get(iso)?.short);
  }

  getNormHours(year, month) {
    let norm = 0;
    const total = daysInMonth(year, month);
    for (let day = 1; day <= total; day += 1) {
      const iso = isoDate(year, month, day);
      if (this.isWeekend(iso) || this.isHoliday(iso)) continue;
      norm += 8;
      if (this.isShort(iso)) norm -= 1;
    }
    return norm;
  }
}

export function calendarFromMonthWeekends(year, month) {
  const data = {};
  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day += 1) {
    const iso = isoDate(year, month, day);
    const wd = isoWeekday(iso);
    data[iso] = { weekend: wd === 0 || wd === 6, holiday: false, short: false };
  }
  return new ProductionCalendar(data);
}

function letter(index) {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

export function cleanMember(raw) {
  const role = ROLES.includes(raw?.role) ? raw.role : ROLE.DUTY;
  let name = String(raw?.name ?? "").trim();
  const position = String(raw?.position ?? "").trim();
  const phone = String(raw?.phone ?? "").trim();
  if (!name) name = `${ROLE_PREFIXES[role]} A`;
  return { name, role, position, phone };
}

export function normalizeStaff(raw) {
  if (Array.isArray(raw?.engineers)) {
    const staff = raw.engineers
      .filter((item) => item && typeof item === "object")
      .map(cleanMember);
    if (staff.length) return staff;
  } else if (Array.isArray(raw?.names) || Array.isArray(raw?.extra)) {
    const staff = [];
    for (const name of raw.names || []) {
      staff.push(cleanMember({ name }));
    }
    for (const name of raw.extra || []) {
      staff.push(cleanMember({ name, role: ROLE.EXTRA }));
    }
    if (staff.length) return staff;
  }
  return DEFAULT_NAMES.map((name) => cleanMember({ name }));
}

export function countRole(staff, role) {
  return staff.filter((member) => member.role === role).length;
}

export function defaultName(role, members, allMembers) {
  const prefix = ROLE_PREFIXES[role];
  const used = new Set(allMembers.map((member) => member.name));
  let index = members.length;
  while (used.has(`${prefix} ${letter(index)}`)) index += 1;
  return `${prefix} ${letter(index)}`;
}

export function ensureRoleCount(staff, role, count) {
  const result = [...staff];
  let members = result.filter((member) => member.role === role);
  if (members.length > count) {
    const keep = new Set(members.slice(0, count));
    const filtered = result.filter(
      (member) => member.role !== role || keep.has(member),
    );
    return filtered;
  }
  while (members.length < count) {
    const member = {
      name: defaultName(role, members, result),
      role,
      position: "",
      phone: "",
    };
    result.push(member);
    members.push(member);
  }
  return result;
}

export function createEngineer(name, role = ROLE.DUTY, position = "", phone = "") {
  return {
    name,
    role,
    position,
    phone,
    shifts: [],
    overtimeHours: 0,
    overtimeByDay: [],
    overtimeTotal: 0,
    totalHours: 0,
    nightCount: 0,
    dailyCount: 0,
    vacationDays: 0,
    officeCount: 0,
    remoteCount: 0,
    tripCount: 0,
  };
}

export function recalculateEngineer(
  engineer,
  nightHours,
  dailyHours,
  workdayHours = 8,
) {
  engineer.totalHours = 0;
  engineer.nightCount = 0;
  engineer.dailyCount = 0;
  engineer.vacationDays = 0;
  engineer.officeCount = 0;
  engineer.remoteCount = 0;
  engineer.tripCount = 0;
  for (const value of engineer.shifts) {
    for (const shift of splitShift(value)) {
      if (shift === SHIFT.NIGHT) {
        engineer.nightCount += 1;
        engineer.totalHours += nightHours;
      } else if (shift === SHIFT.DAILY) {
        engineer.dailyCount += 1;
        engineer.totalHours += dailyHours;
      } else if (shift === SHIFT.VACATION) {
        engineer.vacationDays += 1;
      } else if (shift === SHIFT.OFFICE) {
        engineer.officeCount += 1;
        engineer.totalHours += workdayHours;
      } else if (shift === SHIFT.REMOTE) {
        engineer.remoteCount += 1;
        engineer.totalHours += workdayHours;
      } else if (shift === SHIFT.TRIP) {
        engineer.tripCount += 1;
        engineer.totalHours += workdayHours;
      }
    }
  }
  let overtimeTotal = Number(engineer.overtimeHours);
  if (!Number.isFinite(overtimeTotal) || overtimeTotal < 0) overtimeTotal = 0;
  if (Array.isArray(engineer.overtimeByDay)) {
    for (const value of engineer.overtimeByDay) {
      const hours = Number(value);
      if (Number.isFinite(hours) && hours > 0) overtimeTotal += hours;
    }
  }
  engineer.overtimeTotal = overtimeTotal;
  if (overtimeTotal > 0) engineer.totalHours += overtimeTotal;
  return engineer;
}

export function generateRotation({
  year,
  month,
  engineers,
  anchorIso,
  shiftHours = 24,
  startIndex = null,
}) {
  if (!engineers.length) return [];
  const count = engineers.length;
  const anchorNumber = dayNumber(
    Number(anchorIso.slice(0, 4)),
    Number(anchorIso.slice(5, 7)),
    Number(anchorIso.slice(8, 10)),
  );
  const total = daysInMonth(year, month);
  const result = engineers.map((name) => {
    const engineer = createEngineer(name);
    engineer.shifts = new Array(total).fill(SHIFT.OFF);
    return engineer;
  });

  for (let day = 1; day <= total; day += 1) {
    const offset = dayNumber(year, month, day) - anchorNumber;
    const index = Number.isInteger(startIndex)
      ? (((startIndex + day - 1) % count) + count) % count
      : ((offset % count) + count) % count;
    result[index].shifts[day - 1] = SHIFT.DAILY;
  }

  for (const engineer of result) {
    recalculateEngineer(engineer, shiftHours, shiftHours);
  }
  return result;
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function minBy(items, keyFn) {
  let best = items[0];
  let bestKey = keyFn(best);
  for (let i = 1; i < items.length; i += 1) {
    const key = keyFn(items[i]);
    if (compareKeys(key, bestKey) < 0) {
      best = items[i];
      bestKey = key;
    }
  }
  return best;
}

export class ScheduleGenerator {
  constructor({
    year,
    month,
    engineers,
    calendar = null,
    nightHours = 15,
    dailyHours = 24,
    useHolidays = true,
    prevOnDuty = {},
  }) {
    this.year = year;
    this.month = month;
    this.calendar = calendar || new ProductionCalendar();
    this.nightHours = nightHours;
    this.dailyHours = dailyHours;
    this.useHolidays = useHolidays;
    this.prevOnDuty = prevOnDuty;
    this.engineers = engineers.map((name) => createEngineer(name));
    this.daysInMonth = daysInMonth(year, month);
  }

  generate() {
    const workdays = [];
    const holidays = [];
    for (let day = 1; day <= this.daysInMonth; day += 1) {
      const iso = isoDate(this.year, this.month, day);
      const isOff =
        this.calendar.isWeekend(iso) ||
        (this.useHolidays && this.calendar.isHoliday(iso));
      (isOff ? holidays : workdays).push(day);
    }

    for (const engineer of this.engineers) {
      engineer.shifts = new Array(this.daysInMonth).fill(SHIFT.OFF);
      engineer.totalHours = 0;
      engineer.nightCount = 0;
      engineer.dailyCount = 0;
    }

    for (const day of workdays) {
      const engineer = this.pickForNight(day - 1);
      this.assign(engineer, day - 1, SHIFT.NIGHT, this.nightHours);
    }

    for (const day of holidays) {
      const engineer = this.pickForDaily(day - 1);
      this.assign(engineer, day - 1, SHIFT.DAILY, this.dailyHours);
    }

    this.balance();
    return this.engineers;
  }

  assign(engineer, dayIndex, shift, hours) {
    engineer.shifts[dayIndex] = shift;
    engineer.totalHours += hours;
    if (shift === SHIFT.NIGHT) engineer.nightCount += 1;
    else if (shift === SHIFT.DAILY) engineer.dailyCount += 1;
  }

  unassign(engineer, dayIndex) {
    const shift = engineer.shifts[dayIndex];
    if (shift === SHIFT.OFF) return;
    if (shift === SHIFT.NIGHT) {
      engineer.nightCount -= 1;
      engineer.totalHours -= this.nightHours;
    } else if (shift === SHIFT.DAILY) {
      engineer.dailyCount -= 1;
      engineer.totalHours -= this.dailyHours;
    }
    engineer.shifts[dayIndex] = SHIFT.OFF;
  }

  hasAdjacentDuty(engineer, dayIndex) {
    if (dayIndex === 0 && this.prevOnDuty[engineer.name]) return true;
    for (const adjacent of [dayIndex - 1, dayIndex + 1]) {
      if (
        adjacent >= 0 &&
        adjacent < this.daysInMonth &&
        engineer.shifts[adjacent] !== SHIFT.OFF
      ) {
        return true;
      }
    }
    return false;
  }

  pickForNight(dayIndex) {
    const free = this.engineers.filter(
      (engineer) => engineer.shifts[dayIndex] === SHIFT.OFF,
    );
    const noAdjacent = free.filter(
      (engineer) => !this.hasAdjacentDuty(engineer, dayIndex),
    );
    const pool = noAdjacent.length ? noAdjacent : free;
    return minBy(pool, (engineer) => [
      engineer.totalHours,
      engineer.nightCount,
      engineer.name,
    ]);
  }

  pickForDaily(dayIndex) {
    const free = this.engineers.filter(
      (engineer) => engineer.shifts[dayIndex] === SHIFT.OFF,
    );
    const noAdjacent = free.filter(
      (engineer) => !this.hasAdjacentDuty(engineer, dayIndex),
    );
    const pool = noAdjacent.length ? noAdjacent : free;
    return minBy(pool, (engineer) => [
      engineer.dailyCount,
      engineer.totalHours,
      engineer.name,
    ]);
  }

  shiftHoursValue(shift) {
    if (shift === SHIFT.NIGHT) return this.nightHours;
    if (shift === SHIFT.DAILY) return this.dailyHours;
    return 0;
  }

  canTake(engineer, dayIndex) {
    return (
      engineer.shifts[dayIndex] === SHIFT.OFF &&
      !this.hasAdjacentDuty(engineer, dayIndex)
    );
  }

  balance() {
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const ordered = [...this.engineers].sort(
        (a, b) => a.totalHours - b.totalHours,
      );
      const low = ordered[0];
      const high = ordered[ordered.length - 1];
      const diff = high.totalHours - low.totalHours;
      if (diff < this.nightHours) break;

      const candidates = [];
      high.shifts.forEach((shift, index) => {
        if (shift === SHIFT.OFF) return;
        if (!this.canTake(low, index)) return;
        const hours = this.shiftHoursValue(shift);
        if (hours > diff + 0.1) return;
        const newDiff = Math.abs(
          high.totalHours - hours - (low.totalHours + hours),
        );
        if (newDiff >= diff) return;
        candidates.push({ hours, negNewDiff: -newDiff, index, shift });
      });

      if (!candidates.length) {
        if (!this.trySwap(low, high)) break;
        continue;
      }

      candidates.sort(
        (a, b) =>
          b.hours - a.hours ||
          b.negNewDiff - a.negNewDiff ||
          b.index - a.index,
      );
      const { index, shift } = candidates[0];
      this.unassign(high, index);
      this.assign(low, index, shift, this.shiftHoursValue(shift));
    }
  }

  trySwap(low, high) {
    let best = null;
    high.shifts.forEach((shiftHigh, i) => {
      if (shiftHigh === SHIFT.OFF) return;
      const hoursHigh = this.shiftHoursValue(shiftHigh);
      low.shifts.forEach((shiftLow, j) => {
        if (shiftLow === SHIFT.OFF) return;
        if (i === j) return;
        const hoursLow = this.shiftHoursValue(shiftLow);
        if (hoursHigh <= hoursLow) return;
        if (high.shifts[j] !== SHIFT.OFF) return;
        if (low.shifts[i] !== SHIFT.OFF) return;

        this.unassign(high, i);
        this.unassign(low, j);
        const ok = this.canTake(low, i) && this.canTake(high, j);
        this.assign(high, i, shiftHigh, hoursHigh);
        this.assign(low, j, shiftLow, hoursLow);
        if (!ok) return;

        const newHigh = high.totalHours - hoursHigh + hoursLow;
        const newLow = low.totalHours - hoursLow + hoursHigh;
        const newDiff = Math.abs(newHigh - newLow);
        const oldDiff = Math.abs(high.totalHours - low.totalHours);
        if (newDiff < oldDiff - 0.1) {
          const gain = oldDiff - newDiff;
          if (best === null || gain > best.gain) {
            best = { gain, i, j, shiftHigh, shiftLow };
          }
        }
      });
    });

    if (best === null) return false;

    const { i, j, shiftHigh, shiftLow } = best;
    const hoursHigh = this.shiftHoursValue(shiftHigh);
    const hoursLow = this.shiftHoursValue(shiftLow);
    this.unassign(high, i);
    this.unassign(low, j);
    this.assign(low, i, shiftHigh, hoursHigh);
    this.assign(high, j, shiftLow, hoursLow);
    return true;
  }
}

export function lastDayOnDuty(engineers) {
  if (!engineers.length) return {};
  const last = engineers[0].shifts.length - 1;
  const result = {};
  for (const engineer of engineers) {
    result[engineer.name] = engineer.shifts[last] !== SHIFT.OFF;
  }
  return result;
}

export function generateLinked({
  year,
  month,
  engineers,
  calendars,
  nightHours = 15,
  dailyHours = 24,
  useHolidays = true,
}) {
  let startYear = year;
  while (calendars[startYear - 1]) startYear -= 1;

  let prev = {};
  let result = [];
  let yy = startYear;
  let mm = 1;
  while (yy < year || (yy === year && mm <= month)) {
    const generator = new ScheduleGenerator({
      year: yy,
      month: mm,
      engineers,
      calendar: calendars[yy],
      nightHours,
      dailyHours,
      useHolidays,
      prevOnDuty: prev,
    });
    result = generator.generate();
    prev = lastDayOnDuty(result);
    if (mm === 12) {
      yy += 1;
      mm = 1;
    } else {
      mm += 1;
    }
  }
  return result;
}

export function makeFiveDayEngineers(
  members,
  year,
  month,
  calendar,
  workdayHours = 8,
) {
  const total = daysInMonth(year, month);
  return members.map((member) => {
    const engineer = createEngineer(
      member.name,
      ROLE.FIVE_DAY,
      member.position,
      member.phone,
    );
    engineer.shifts = [];
    for (let day = 1; day <= total; day += 1) {
      const iso = isoDate(year, month, day);
      const off = calendar.isWeekend(iso) || calendar.isHoliday(iso);
      engineer.shifts.push(off ? SHIFT.OFF : SHIFT.OFFICE);
    }
    recalculateEngineer(engineer, workdayHours, workdayHours, workdayHours);
    return engineer;
  });
}

export function makeExtraEngineers(names, year, month) {
  const total = daysInMonth(year, month);
  return names.map((name) => {
    const engineer = createEngineer(name, ROLE.EXTRA);
    engineer.shifts = new Array(total).fill(SHIFT.OFF);
    return engineer;
  });
}

export function validateSchedule(engineers) {
  const issues = [];
  const issueDays = new Set();
  const duty = engineers.filter((engineer) => engineer.role === ROLE.DUTY);
  if (!duty.length) return { issues, issueDays };

  const days = duty[0].shifts.length;
  for (let i = 0; i < days; i += 1) {
    const onDuty = duty.filter((engineer) =>
      DUTY_SHIFTS.has(engineer.shifts[i]),
    );
    if (onDuty.length > 1) {
      issueDays.add(i + 1);
      issues.push(`день ${i + 1}: на смене ${onDuty.length} чел.`);
    }
  }

  for (const engineer of duty) {
    for (let i = 0; i < engineer.shifts.length - 1; i += 1) {
      if (
        DUTY_SHIFTS.has(engineer.shifts[i]) &&
        DUTY_SHIFTS.has(engineer.shifts[i + 1])
      ) {
        issues.push(`${engineer.name}: смены подряд ${i + 1}–${i + 2}`);
        issueDays.add(i + 1);
        issueDays.add(i + 2);
      }
    }
  }

  return { issues, issueDays };
}

function asCalendar(value) {
  if (value instanceof ProductionCalendar) return value;
  return new ProductionCalendar(value || {});
}

export function buildSchedule({
  staff,
  year,
  month,
  mode = "rotation",
  anchorIso,
  calendars = {},
  useHolidays = true,
  nightHours = 15,
  dailyHours = 24,
  workdayHours = 8,
  rotationStartIndex = null,
  prevOnDuty = null,
}) {
  const dutyMembers = staff.filter((member) => member.role === ROLE.DUTY);
  const fiveMembers = staff.filter((member) => member.role === ROLE.FIVE_DAY);
  const extraMembers = staff.filter((member) => member.role === ROLE.EXTRA);

  const chain = {};
  for (const [key, value] of Object.entries(calendars)) {
    chain[Number(key)] = asCalendar(value);
  }

  const firstIso = isoDate(year, month, 1);
  let calendar = chain[year];
  if (!calendar || !calendar.has(firstIso)) {
    calendar = calendarFromMonthWeekends(year, month);
  }
  chain[year] = calendar;

  let main;
  if (mode === "rotation") {
    main = generateRotation({
      year,
      month,
      engineers: dutyMembers.map((member) => member.name),
      anchorIso,
      shiftHours: dailyHours,
      startIndex: rotationStartIndex,
    });
  } else {
    const engineers = dutyMembers.map((member) => member.name);
    if (prevOnDuty && typeof prevOnDuty === "object") {
      main = new ScheduleGenerator({
        year,
        month,
        engineers,
        calendar,
        nightHours,
        dailyHours,
        useHolidays,
        prevOnDuty,
      }).generate();
    } else {
      main = generateLinked({
        year,
        month,
        engineers,
        calendars: chain,
        nightHours,
        dailyHours,
        useHolidays,
      });
    }
  }

  main.forEach((engineer, index) => {
    engineer.position = dutyMembers[index]?.position || "";
    engineer.phone = dutyMembers[index]?.phone || "";
  });

  const five = makeFiveDayEngineers(
    fiveMembers,
    year,
    month,
    calendar,
    workdayHours,
  );
  const extras = makeExtraEngineers(
    extraMembers.map((member) => member.name),
    year,
    month,
  );
  extras.forEach((engineer, index) => {
    engineer.position = extraMembers[index]?.position || "";
    engineer.phone = extraMembers[index]?.phone || "";
  });

  const engineers = [...main, ...five, ...extras];
  return {
    engineers,
    rows: [...dutyMembers, ...fiveMembers, ...extraMembers],
    normHours: calendar.getNormHours(year, month),
    calendar,
  };
}

export function engineerStats(engineers) {
  return engineers.filter((engineer) => engineer.role !== ROLE.EXTRA);
}

export function shiftHoursValue(shift, nightHours = 15, dailyHours = 24, workdayHours = 8) {
  let total = 0;
  for (const part of splitShift(shift)) {
    if (part === SHIFT.NIGHT) total += nightHours;
    else if (part === SHIFT.DAILY) total += dailyHours;
    else if (
      part === SHIFT.OFFICE ||
      part === SHIFT.REMOTE ||
      part === SHIFT.TRIP
    ) {
      total += workdayHours;
    }
  }
  return total;
}
