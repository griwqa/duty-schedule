import {
  ProductionCalendar,
  ROLE,
  ROLE_TITLES,
  SHIFT,
  buildSchedule,
  calendarFromMonthWeekends,
  countRole,
  createEngineer,
  daysInMonth,
  defaultName,
  engineerStats,
  ensureRoleCount,
  isoDate,
  isoWeekday,
  mergeFiveDayShift,
  normalizeFiveDayShift,
  normalizeStaff,
  recalculateEngineer,
  shiftHas,
  splitShift,
  validateSchedule,
} from "./core.js";
import {
  neonConfigured,
  neonLoadSchedule,
  neonSaveSchedule,
  normalizeAuthUrl,
  normalizeDataApiUrl,
  readNeonConfig,
  writeNeonConfig,
} from "./neon.js";

const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const DOW_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const STORAGE_KEY = "grafik-web-v1";
const MAX_DUTY = 20;
const MAX_EXTRA = 20;
const MODE_ROTATION = "rotation";
const MODE_NIGHT = "night_weekend";

const SHIFT_CLASS = {
  [SHIFT.NIGHT]: "shift-night",
  [SHIFT.DAILY]: "shift-daily",
  [SHIFT.MORNING]: "shift-morning",
  [SHIFT.DAY]: "shift-day",
  [SHIFT.EVENING]: "shift-evening",
  [SHIFT.OFFICE]: "shift-office",
  [SHIFT.REMOTE]: "shift-remote",
  [SHIFT.TRIP]: "shift-trip",
  [SHIFT.VACATION]: "shift-vacation",
};

const SHIFT_FILL = {
  [SHIFT.NIGHT]: ["#4472C4", "#FFFFFF"],
  [SHIFT.DAILY]: ["#ED7D31", "#FFFFFF"],
  [SHIFT.MORNING]: ["#70AD47", "#FFFFFF"],
  [SHIFT.DAY]: ["#FFC000", "#111827"],
  [SHIFT.EVENING]: ["#7030A0", "#FFFFFF"],
  [SHIFT.OFFICE]: ["#DEEBF7", "#111827"],
  [SHIFT.REMOTE]: ["#E2EFDA", "#111827"],
  [SHIFT.TRIP]: ["#FCE4D6", "#111827"],
  [SHIFT.VACATION]: ["#00B0F0", "#FFFFFF"],
};

const NAME_FILL = {
  [ROLE.DUTY]: "#D9E1F2",
  [ROLE.FIVE_DAY]: "#E2EFDA",
  [ROLE.EXTRA]: "#E4DFEC",
};

const CELL_OPTIONS = {
  [ROLE.DUTY]: [
    [SHIFT.DAILY, "Суточная (С)"],
    [SHIFT.NIGHT, "Ночная (Н)"],
    [SHIFT.OFFICE, "Офис (о)"],
    [SHIFT.REMOTE, "Удалёнка (у)"],
    [SHIFT.TRIP, "Выезд (в)"],
    [SHIFT.VACATION, "Отпуск (Отп)"],
    [SHIFT.OFF, "Выходной (—)"],
  ],
  [ROLE.EXTRA]: [
    [SHIFT.MORNING, "Утро (У)"],
    [SHIFT.DAY, "День (Д)"],
    [SHIFT.EVENING, "Вечер (В)"],
    [SHIFT.VACATION, "Отпуск (Отп)"],
    [SHIFT.OFF, "Выходной (—)"],
  ],
  [ROLE.FIVE_DAY]: [
    [SHIFT.OFFICE, "Офис (о)"],
    [SHIFT.REMOTE, "Удалёнка (у)"],
    [SHIFT.TRIP, "Выезд (в)"],
    [SHIFT.MORNING, "Утро (У)"],
    [SHIFT.EVENING, "Вечер (В)"],
    [SHIFT.NIGHT, "Ночная (Н)"],
    [SHIFT.VACATION, "Отпуск (Отп)"],
    [SHIFT.OFF, "Выходной (—)"],
  ],
};

const ROLE_ORDER = [ROLE.DUTY, ROLE.FIVE_DAY, ROLE.EXTRA];

const DUTY_SHIFT_SET = new Set([SHIFT.NIGHT, SHIFT.DAILY]);

const ROLE_SHIFT_SETS = {
  [ROLE.DUTY]: new Set([
    SHIFT.OFF,
    SHIFT.DAILY,
    SHIFT.NIGHT,
    SHIFT.OFFICE,
    SHIFT.REMOTE,
    SHIFT.TRIP,
    SHIFT.VACATION,
  ]),
  [ROLE.FIVE_DAY]: new Set([
    SHIFT.OFF,
    SHIFT.OFFICE,
    SHIFT.REMOTE,
    SHIFT.TRIP,
    SHIFT.MORNING,
    SHIFT.EVENING,
    SHIFT.NIGHT,
    SHIFT.VACATION,
  ]),
  [ROLE.EXTRA]: new Set([
    SHIFT.OFF,
    SHIFT.MORNING,
    SHIFT.DAY,
    SHIFT.EVENING,
    SHIFT.VACATION,
  ]),
};

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function todayIso() {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function formatDateRu(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "";
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function formatNumber(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatSigned(value) {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}`;
}

function formatStamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function defaultSettings() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    mode: MODE_ROTATION,
    anchor: todayIso(),
    useHolidays: true,
    nightHours: 15,
    dailyHours: 24,
    workdayHours: 8,
    dutyCount: 4,
    extraCount: 0,
  };
}

function sanitizeCalendarData(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const result = {};
  for (const [iso, info] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    if (!info || typeof info !== "object" || Array.isArray(info)) continue;
    result[iso] = {
      weekend: Boolean(info.weekend),
      holiday: Boolean(info.holiday),
      short: Boolean(info.short),
    };
  }
  return Object.keys(result).length ? result : null;
}

function normalizeSettings(raw, staff) {
  const base = defaultSettings();
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = { ...base, ...source };
  settings.year = clampInt(settings.year, 2020, 2100, base.year);
  settings.month = clampInt(settings.month, 1, 12, base.month);
  settings.mode = settings.mode === MODE_NIGHT ? MODE_NIGHT : MODE_ROTATION;
  settings.anchor = /^\d{4}-\d{2}-\d{2}$/.test(settings.anchor || "")
    ? settings.anchor
    : base.anchor;
  settings.useHolidays = settings.useHolidays !== false;
  settings.nightHours = clampNumber(settings.nightHours, 1, 24, 15);
  settings.dailyHours = clampNumber(settings.dailyHours, 1, 24, 24);
  settings.workdayHours = clampNumber(settings.workdayHours, 1, 24, 8);
  settings.dutyCount = clampInt(settings.dutyCount, 2, MAX_DUTY, 4);
  settings.extraCount = clampInt(settings.extraCount, 0, MAX_EXTRA, 0);
  if (staff) {
    settings.dutyCount = Math.max(2, countRole(staff, ROLE.DUTY));
    settings.extraCount = countRole(staff, ROLE.EXTRA);
  }
  return settings;
}

const state = {
  staff: [],
  settings: defaultSettings(),
  calendarData: {},
  customCalendars: {},
  calendarManifest: undefined,
  schedule: null,
  schedules: {},
  source: "local",
  dirty: false,
  neon: readNeonConfig(),
  neonUpdatedAt: "",
  neonDirty: false,
  neonSaving: false,
  neonReady: false,
  neonError: "",
  neonTimer: 0,
  revision: 0,
  navToken: 0,
  generation: null,
  validation: { issues: [], issueDays: new Set() },
  selected: null,
  dragSource: null,
  dropCell: null,
  busy: false,
  fetchFailed: false,
};

const els = {};

function cacheElements() {
  const ids = [
    "btn-export",
    "btn-settings",
    "btn-calendar",
    "btn-add",
    "load-state",
    "app-badge",
    "in-month",
    "in-year",
    "in-duty-count",
    "in-extra-count",
    "in-mode",
    "in-anchor",
    "in-holidays",
    "anchor-field",
    "conditions",
    "calendar-note",
    "schedule-table",
    "schedule-wrap",
    "validation",
    "stats-body",
    "stats-summary",
    "toast-container",
    "cell-menu",
    "calendar-file",
    "engineer-dialog",
    "engineer-form",
    "engineer-title",
    "eng-name",
    "eng-role",
    "eng-position",
    "eng-phone",
    "eng-overtime",
    "eng-overtime-field",
    "eng-secondary-actions",
    "eng-regenerate",
    "eng-vacation",
    "eng-delete",
    "eng-cancel",
    "vacation-panel",
    "vac-start",
    "vac-end",
    "vac-apply",
    "vac-cancel",
    "vac-hint",
    "overtime-dialog",
    "overtime-form",
    "overtime-subject",
    "overtime-hours",
    "overtime-remove",
    "overtime-cancel",
    "settings-dialog",
    "settings-form",
    "set-night",
    "set-daily",
    "set-workday",
    "set-cancel",
    "neon-dialog",
    "neon-form",
    "neon-data-url",
    "neon-auth-url",
    "neon-password",
    "neon-autosave",
    "neon-status",
    "neon-load",
    "neon-save",
    "neon-close",
  ];
  for (const id of ids) {
    const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    els[key] = document.getElementById(id);
  }
  els.scheduleWrap = document.querySelector(".schedule-wrap");
}

function toast(message, type = "info", duration = 3400) {
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : type === "success" ? "success" : ""}`.trim();
  node.textContent = message;
  els.toastContainer.append(node);
  window.setTimeout(() => node.remove(), duration);
}

function setBadge(source) {
  els.appBadge.textContent =
    source === "neon"
      ? "Веб-версия · данные в Neon"
      : "Веб-версия · локальные данные";
}

function updateStatus() {
  if (state.busy) {
    els.loadState.textContent = "Обновление…";
    return;
  }
  const parts = [];
  if (state.source === "neon") {
    parts.push(state.neonSaving ? "запись в Neon…" : "источник: Neon");
    if (state.neonUpdatedAt) parts.push(formatStamp(state.neonUpdatedAt));
    if (state.neonDirty) parts.push("не сохранено в Neon");
  } else {
    parts.push("источник: браузер");
    if (state.neon.password) parts.push("Neon подключён");
  }
  if (state.dirty && state.source !== "neon") parts.push("ручные правки");
  els.loadState.textContent = parts.join(" · ");
}

function setBusy(busy) {
  state.busy = busy;
  document.body.classList.toggle("busy", busy);
  updateStatus();
}

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mergeCustomCalendars(raw) {
  if (!raw || typeof raw !== "object") return;
  for (const [key, value] of Object.entries(raw)) {
    const year = Number(key);
    const clean = sanitizeCalendarData(value);
    if (!clean || !Number.isFinite(year)) continue;
    state.customCalendars[year] = clean;
    state.calendarData[year] = clean;
  }
}

function isValidScheduleEntry(value) {
  return Boolean(
    value &&
      Number.isFinite(Number(value.year)) &&
      Number.isFinite(Number(value.month)) &&
      Array.isArray(value.engineers),
  );
}

function loadArchivedSchedules(saved) {
  state.schedules = {};
  const raw = saved?.schedules;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const value of Object.values(raw)) {
      if (!isValidScheduleEntry(value)) continue;
      const year = Number(value.year);
      const month = Number(value.month);
      state.schedules[monthKey(year, month)] = {
        year,
        month,
        mode: value.mode,
        anchorIso: value.anchorIso,
        manual: Boolean(value.manual),
        engineers: value.engineers,
      };
    }
  }
  if (isValidScheduleEntry(saved?.schedule)) {
    const schedule = saved.schedule;
    const year = Number(schedule.year);
    const month = Number(schedule.month);
    state.schedules[monthKey(year, month)] = {
      year,
      month,
      mode: schedule.mode,
      anchorIso: schedule.anchorIso,
      manual: Boolean(schedule.manual ?? saved.dirty),
      engineers: schedule.engineers,
    };
  }
}

function localManualSchedules(saved) {
  const result = new Map();
  if (saved?.schedules && typeof saved.schedules === "object") {
    for (const value of Object.values(saved.schedules)) {
      if (!isValidScheduleEntry(value) || !value.manual) continue;
      result.set(monthKey(Number(value.year), Number(value.month)), value);
    }
  }
  if (isValidScheduleEntry(saved?.schedule)) {
    const schedule = saved.schedule;
    if (Boolean(schedule.manual ?? saved.dirty)) {
      result.set(monthKey(Number(schedule.year), Number(schedule.month)), {
        ...schedule,
        manual: true,
      });
    }
  }
  return result;
}

async function applySavedState(saved, source) {
  if (saved?.customCalendars) mergeCustomCalendars(saved.customCalendars);

  let staffSource = null;
  if (Array.isArray(saved?.staff) && saved.staff.length) {
    staffSource = { engineers: saved.staff };
  } else {
    try {
      const response = await fetch("./data/engineers.json", { cache: "no-store" });
      if (response.ok) staffSource = await response.json();
    } catch {
      state.fetchFailed = true;
    }
  }
  state.staff = normalizeStaff(staffSource);
  state.settings = normalizeSettings(saved?.settings, state.staff);
  loadArchivedSchedules(saved);
  syncControls();
  updateCalendarNote();

  setBusy(true);
  try {
    await ensureCalendarsAround(state.settings.year);
  } finally {
    setBusy(false);
  }

  state.source = source;
  state.neonDirty = false;
  setBadge(source);
  const ok = await activateMonth();
  if (!ok) {
    state.schedule = null;
    renderAll();
  }
  state.source = source;
  setBadge(source);
  updateCalendarNote();
  updateStatus();
  writeStorage();
}

function hasManualSchedules() {
  if (state.dirty) return true;
  return Object.values(state.schedules).some((saved) => saved?.manual);
}

function refreshNeonDialog() {
  if (!els.neonStatus) return;
  const config = state.neon;
  const lines = [];
  if (!neonConfigured(config)) {
    lines.push("Укажите Data API URL и Auth URL из Neon Console.");
  } else {
    lines.push(`Data API: ${config.dataApiUrl}`);
    lines.push(
      state.neonUpdatedAt
        ? `Последнее сохранение: ${formatStamp(state.neonUpdatedAt)}`
        : "В этом браузере ещё нет сохранённых данных.",
    );
    if (!config.password) {
      lines.push("Введите общий пароль — без него правки не сохранятся в Neon.");
    }
  }
  if (state.neonError) lines.push(`Ошибка: ${state.neonError}`);
  els.neonStatus.textContent = lines.join("\n");
}

function openNeonDialog() {
  els.neonDataUrl.value = state.neon.dataApiUrl;
  els.neonAuthUrl.value = state.neon.authUrl;
  els.neonPassword.value = state.neon.password;
  els.neonAutosave.checked = state.neon.autosave;
  refreshNeonDialog();
  if (!els.neonDialog.open) els.neonDialog.showModal();
  if (!state.neon.password) {
    window.setTimeout(() => els.neonPassword.focus(), 0);
  }
}

function applyNeonFormConfig() {
  state.neon = {
    dataApiUrl: normalizeDataApiUrl(els.neonDataUrl.value),
    authUrl: normalizeAuthUrl(els.neonAuthUrl.value),
    password: els.neonPassword.value,
    autosave: els.neonAutosave.checked,
    lastUpdatedAt: state.neonUpdatedAt || state.neon.lastUpdatedAt || "",
  };
  writeNeonConfig(state.neon);
  refreshNeonDialog();
  return state.neon;
}

async function readNeonState({ silent = false } = {}) {
  if (!neonConfigured(state.neon)) {
    if (!silent) {
      openNeonDialog();
      toast("Укажите Data API URL и Auth URL Neon.", "info");
    }
    return false;
  }
  if (hasManualSchedules() && !silent) {
    const ok = window.confirm(
      "В одном из месяцев есть ручные правки. Загрузить данные из Neon?\nРучные правки будут потеряны.",
    );
    if (!ok) return false;
  }

  setBusy(true);
  let result;
  try {
    result = await neonLoadSchedule(state.neon);
    state.neonError = "";
  } catch (error) {
    state.neonError = error.message;
    if (!silent) {
      toast(`Не удалось загрузить из Neon: ${error.message}`, "error", 8000);
    }
    return false;
  } finally {
    setBusy(false);
    refreshNeonDialog();
  }

  if (!result?.payload) {
    if (!silent) {
      toast(
        "В Neon пока нет сохранённого графика. Нажмите «Сохранить в Neon».",
        "info",
        6000,
      );
    }
    return false;
  }

  await applySavedState(result.payload, "neon");
  state.neonUpdatedAt = result.updatedAt || new Date().toISOString();
  state.neon.lastUpdatedAt = state.neonUpdatedAt;
  writeNeonConfig(state.neon);
  updateStatus();
  refreshNeonDialog();
  if (!silent) toast("График загружен из Neon.", "success");
  return true;
}

async function saveToNeon({ silent = false } = {}) {
  if (!state.schedule) {
    if (!silent) toast("Сначала сформируйте график.", "error");
    return false;
  }
  if (!neonConfigured(state.neon) || !state.neon.password) {
    openNeonDialog();
    if (!silent) toast("Укажите адреса Neon и общий пароль.", "info");
    return false;
  }
  if (state.busy) return false;

  const revision = state.revision;
  state.neonSaving = true;
  setBusy(true);
  let result;
  try {
    result = await neonSaveSchedule(state.neon, {
      ...statePayload(),
      dirty: false,
    });
    state.neonError = "";
  } catch (error) {
    state.neonError = error.message;
    const invalidPassword = /invalid password/i.test(error.message);
    if (invalidPassword) {
      state.neon.password = "";
      writeNeonConfig(state.neon);
    }
    const message = invalidPassword
      ? "Неверный пароль для записи в Neon. Введите его заново."
      : `Не удалось сохранить в Neon: ${error.message}`;
    toast(message, "error", 8000);
    if (invalidPassword) openNeonDialog();
    return false;
  } finally {
    state.neonSaving = false;
    setBusy(false);
    refreshNeonDialog();
  }

  state.source = "neon";
  state.neonUpdatedAt = result?.updatedAt || new Date().toISOString();
  state.neon.lastUpdatedAt = state.neonUpdatedAt;
  writeNeonConfig(state.neon);
  if (state.revision === revision) {
    state.neonDirty = false;
  } else {
    scheduleNeonSave();
  }
  setBadge("neon");
  updateStatus();
  writeStorage();
  if (!silent) toast("График сохранён в Neon.", "success");
  return true;
}

function scheduleNeonSave() {
  if (!state.neonReady) return;
  if (!state.neon.autosave || !state.neon.password) return;
  if (!neonConfigured(state.neon) || !state.neonDirty) return;
  if (state.neonTimer) window.clearTimeout(state.neonTimer);
  state.neonTimer = window.setTimeout(() => {
    state.neonTimer = 0;
    if (!state.neonDirty) return;
    if (state.busy) {
      scheduleNeonSave();
      return;
    }
    saveToNeon({ silent: true });
  }, 1600);
}

function markNeonDirty() {
  state.neonDirty = true;
  state.revision += 1;
  updateStatus();
  scheduleNeonSave();
}

function monthKey(year, month) {
  return `${year}-${pad2(month)}`;
}

function serializeSchedule(schedule = state.schedule, manual = state.dirty) {
  if (!schedule) return null;
  return {
    year: schedule.year,
    month: schedule.month,
    mode: schedule.mode,
    anchorIso: schedule.anchorIso,
    manual: Boolean(manual),
    engineers: schedule.engineers.map((engineer) => ({
      name: engineer.name,
      role: engineer.role,
      position: engineer.position,
      shifts: [...engineer.shifts],
      overtimeHours: Number(engineer.overtimeHours) || 0,
      overtimeByDay: Array.isArray(engineer.overtimeByDay)
        ? engineer.overtimeByDay.map((value) => Number(value) || 0)
        : [],
    })),
  };
}

function archiveActiveSchedule() {
  if (!state.schedule) return;
  const key = monthKey(state.schedule.year, state.schedule.month);
  state.schedules[key] = serializeSchedule();
}

function statePayload() {
  archiveActiveSchedule();
  return {
    staff: state.staff,
    settings: state.settings,
    customCalendars: state.customCalendars,
    schedule: serializeSchedule(),
    schedules: state.schedules,
    dirty: state.dirty,
    updatedAt: new Date().toISOString(),
  };
}

function writeStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(statePayload()));
  } catch {
    toast("Не удалось сохранить данные в браузере.", "error");
  }
}

function buildMonthOptions() {
  for (let month = 1; month <= 12; month += 1) {
    const option = document.createElement("option");
    option.value = String(month);
    option.textContent = MONTHS_RU[month - 1];
    els.inMonth.append(option);
  }
}

function orderedStaff(staff = state.staff) {
  return ROLE_ORDER.flatMap((role) =>
    staff.filter((member) => member.role === role),
  );
}

function syncControls() {
  const settings = state.settings;
  els.inMonth.value = String(settings.month);
  els.inYear.value = String(settings.year);
  els.inDutyCount.value = String(Math.max(2, countRole(state.staff, ROLE.DUTY)));
  els.inExtraCount.value = String(countRole(state.staff, ROLE.EXTRA));
  els.inMode.value = settings.mode;
  els.inAnchor.value = settings.anchor;
  els.inHolidays.checked = settings.useHolidays;
  els.anchorField.hidden = settings.mode !== MODE_ROTATION;
}

function readControls() {
  const settings = state.settings;
  return {
    year: clampInt(els.inYear.value, 2020, 2100, settings.year),
    month: clampInt(els.inMonth.value, 1, 12, settings.month),
    dutyCount: clampInt(els.inDutyCount.value, 2, MAX_DUTY, 4),
    extraCount: clampInt(els.inExtraCount.value, 0, MAX_EXTRA, 0),
    mode: els.inMode.value === MODE_NIGHT ? MODE_NIGHT : MODE_ROTATION,
    anchor: /^\d{4}-\d{2}-\d{2}$/.test(els.inAnchor.value)
      ? els.inAnchor.value
      : todayIso(),
    useHolidays: els.inHolidays.checked,
    nightHours: settings.nightHours,
    dailyHours: settings.dailyHours,
    workdayHours: settings.workdayHours,
  };
}

function effectiveCalendar(year, month) {
  const data = state.calendarData[year];
  if (data && Object.prototype.hasOwnProperty.call(data, isoDate(year, month, 1))) {
    return new ProductionCalendar(data);
  }
  return calendarFromMonthWeekends(year, month);
}

function chainCalendars(year) {
  const calendars = {};
  for (const value of [year - 1, year, year + 1]) {
    const data = state.calendarData[value];
    if (data) calendars[value] = new ProductionCalendar(data);
  }
  return calendars;
}

async function ensureCalendarManifest() {
  if (state.calendarManifest !== undefined) return;
  try {
    const response = await fetch("./data/calendars.json", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.years)) {
        state.calendarManifest = new Set(
          data.years.map((year) => Number(year)).filter(Number.isFinite),
        );
        return;
      }
    }
  } catch {
    // Manifest is optional; fall back to probing year files.
  }
  state.calendarManifest = null;
}

async function ensureCalendarsAround(year) {
  await ensureCalendarManifest();
  const years = [year - 1, year, year + 1];
  await Promise.all(
    years.map(async (value) => {
      if (state.calendarData[value]) return;
      if (state.customCalendars[value]) {
        state.calendarData[value] = state.customCalendars[value];
        return;
      }
      if (state.calendarManifest && !state.calendarManifest.has(value)) return;
      try {
        const response = await fetch(`./data/calendar_${value}.json`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const clean = sanitizeCalendarData(await response.json());
        if (clean) state.calendarData[value] = clean;
      } catch {
        state.fetchFailed = true;
      }
    }),
  );
}

function updateCalendarNote() {
  const year = state.settings.year;
  const custom = state.customCalendars[year];
  const data = state.calendarData[year];
  let text;
  if (custom) {
    text = `Производственный календарь ${year}: загружен пользовательский JSON.`;
  } else if (data) {
    text = `Производственный календарь ${year}: праздники и сокращённые дни учтены.`;
  } else {
    text = `Для ${year} нет файла data/calendar_${year}.json — используются только суббота и воскресенье.`;
  }
  if (!data && state.fetchFailed) {
    text +=
      " Если страница открыта с диска, запустите локальный сервер: python -m http.server.";
  }
  els.calendarNote.textContent = text;
}

function normalizeShifts(raw, total, role) {
  const allowed = ROLE_SHIFT_SETS[role] || ROLE_SHIFT_SETS[ROLE.DUTY];
  const shifts = Array.isArray(raw) ? raw.slice(0, total) : [];
  while (shifts.length < total) shifts.push(SHIFT.OFF);
  return shifts.map((value) => {
    const shift = String(value ?? "");
    if (!shift) return SHIFT.OFF;
    if (shift === "П") {
      return role === ROLE.DUTY ? SHIFT.DAILY : SHIFT.OFF;
    }
    if (role === ROLE.FIVE_DAY) return normalizeFiveDayShift(shift);
    return allowed.has(shift) ? shift : SHIFT.OFF;
  });
}

function runtimeSchedule(saved, calendar) {
  const year = Number(saved.year);
  const month = Number(saved.month);
  const total = daysInMonth(year, month);
  const byName = new Map();
  for (const item of saved.engineers || []) {
    if (item && typeof item.name === "string") byName.set(item.name, item);
  }
  const rows = orderedStaff();
  const engineers = rows.map((member) => {
    const item = byName.get(member.name);
    const engineer = createEngineer(
      member.name,
      member.role,
      member.position,
      member.phone,
    );
    engineer.shifts = normalizeShifts(item?.shifts, total, member.role);
    engineer.overtimeHours = Math.max(0, Number(item?.overtimeHours) || 0);
    const overtimeByDay = Array.isArray(item?.overtimeByDay)
      ? item.overtimeByDay
      : [];
    engineer.overtimeByDay = Array.from({ length: total }, (_, index) =>
      Math.max(0, Math.min(24, Number(overtimeByDay[index]) || 0)),
    );
    recalculateEngineer(
      engineer,
      state.settings.nightHours,
      state.settings.dailyHours,
      state.settings.workdayHours,
    );
    return engineer;
  });
  return {
    year,
    month,
    mode: saved.mode || state.settings.mode,
    anchorIso: saved.anchorIso || state.settings.anchor,
    engineers,
    rows,
    normHours: calendar.getNormHours(year, month),
    calendar,
  };
}

function restoreSavedSchedule(saved) {
  if (!isValidScheduleEntry(saved)) return false;
  const calendar = effectiveCalendar(saved.year, saved.month);
  state.schedule = runtimeSchedule(saved, calendar);
  state.dirty = Boolean(saved.manual);
  if (saved.mode === MODE_ROTATION || saved.mode === MODE_NIGHT) {
    state.settings.mode = saved.mode;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(saved.anchorIso || "")) {
    state.settings.anchor = saved.anchorIso;
  }
  return true;
}

function continuationFromPrevious(year, month) {
  const current = monthKey(year, month);
  let previous = null;
  for (const [key, saved] of Object.entries(state.schedules)) {
    if (key >= current || !isValidScheduleEntry(saved)) continue;
    if (!previous || key > previous.key) previous = { key, saved };
  }
  if (!previous) return { rotationStartIndex: null, prevOnDuty: null };

  const total = daysInMonth(previous.saved.year, previous.saved.month);
  const last = total - 1;
  const duty = previous.saved.engineers.filter(
    (item) => item?.role === ROLE.DUTY,
  );
  const onDuty = new Set(
    duty
      .filter(
        (item) =>
          Array.isArray(item.shifts) && DUTY_SHIFT_SET.has(item.shifts[last]),
      )
      .map((item) => item.name),
  );
  const dutyNames = orderedStaff()
    .filter((member) => member.role === ROLE.DUTY)
    .map((member) => member.name);
  const prevOnDuty = {};
  for (const name of dutyNames) prevOnDuty[name] = onDuty.has(name);
  const onIndex = duty.findIndex((item) => onDuty.has(item.name));
  const rotationStartIndex =
    onIndex >= 0 && duty.length ? (onIndex + 1) % duty.length : null;
  return { rotationStartIndex, prevOnDuty };
}

async function generateMonth({ notify = false } = {}) {
  if (state.generation) {
    try {
      await state.generation;
    } catch {
      // The previous generation failed; try this month anyway.
    }
  }
  const task = runGenerateMonth({ notify });
  state.generation = task;
  try {
    return await task;
  } finally {
    if (state.generation === task) state.generation = null;
  }
}

async function runGenerateMonth({ notify }) {
  const year = state.settings.year;
  const month = state.settings.month;
  const { mode, anchor: anchorIso, useHolidays, nightHours, dailyHours, workdayHours } =
    state.settings;
  setBusy(true);
  try {
    await ensureCalendarsAround(year);
    if (state.settings.year !== year || state.settings.month !== month) return false;
    const previousOvertime = new Map();
    if (state.schedule && state.schedule.year === year && state.schedule.month === month) {
      for (const engineer of state.schedule.engineers) {
        previousOvertime.set(engineer.name, {
          overtimeHours: Number(engineer.overtimeHours) || 0,
          overtimeByDay: Array.isArray(engineer.overtimeByDay)
            ? [...engineer.overtimeByDay]
            : [],
        });
      }
    }
    const { rotationStartIndex, prevOnDuty } = continuationFromPrevious(year, month);
    const result = buildSchedule({
      staff: state.staff,
      year,
      month,
      mode,
      anchorIso,
      calendars: chainCalendars(year),
      useHolidays,
      nightHours,
      dailyHours,
      workdayHours,
      rotationStartIndex,
      prevOnDuty,
    });
    if (state.settings.year !== year || state.settings.month !== month) return false;

    if (previousOvertime.size) {
      const total = daysInMonth(year, month);
      for (const engineer of result.engineers) {
        const kept = previousOvertime.get(engineer.name);
        if (!kept) continue;
        engineer.overtimeHours = kept.overtimeHours;
        engineer.overtimeByDay = Array.from({ length: total }, (_, index) =>
          Math.max(0, Math.min(24, Number(kept.overtimeByDay[index]) || 0)),
        );
        recalculateEngineer(
          engineer,
          nightHours,
          dailyHours,
          workdayHours,
        );
      }
    }

    state.schedule = {
      year,
      month,
      mode,
      anchorIso,
      engineers: result.engineers,
      rows: result.rows,
      normHours: result.normHours,
      calendar: result.calendar,
    };
    state.dirty = false;
    archiveActiveSchedule();
    if (state.source !== "neon" || !neonConfigured(state.neon)) {
      state.source = "local";
    }
    setBadge(state.source);
    syncControls();
    renderAll();
    updateCalendarNote();
    markNeonDirty();
    writeStorage();
    if (notify) {
      toast(
        `График на ${MONTHS_RU[month - 1]} ${year} сформирован автоматически на основе предыдущего месяца.`,
        "success",
        4800,
      );
    }
    return true;
  } catch (error) {
    console.error(error);
    toast(`Не удалось сформировать график: ${error.message}`, "error");
    return false;
  } finally {
    setBusy(false);
  }
}

async function activateMonth({ notify = false } = {}) {
  const { year, month } = state.settings;
  const saved = state.schedules[monthKey(year, month)];
  if (saved && restoreSavedSchedule(saved)) {
    syncControls();
    renderAll();
    updateCalendarNote();
    return true;
  }
  return generateMonth({ notify });
}

async function onPeriodChange() {
  const token = (state.navToken += 1);
  const previous = { ...state.settings };
  Object.assign(state.settings, readControls());
  archiveActiveSchedule();
  const key = monthKey(state.settings.year, state.settings.month);
  const existed = Boolean(state.schedules[key]);
  const ok = await activateMonth({ notify: !existed });
  if (token !== state.navToken) return;
  if (!ok) {
    state.settings = previous;
    syncControls();
    return;
  }
  updateStatus();
  writeStorage();
}

async function onSettingsChange() {
  const next = readControls();
  const countsChanged =
    next.dutyCount !== state.settings.dutyCount ||
    next.extraCount !== state.settings.extraCount;
  const generationChanged =
    next.mode !== state.settings.mode ||
    next.useHolidays !== state.settings.useHolidays;
  Object.assign(state.settings, next);
  if (countsChanged) {
    state.staff = ensureRoleCount(
      state.staff,
      ROLE.DUTY,
      state.settings.dutyCount,
    );
    state.staff = ensureRoleCount(
      state.staff,
      ROLE.EXTRA,
      state.settings.extraCount,
    );
    state.settings.dutyCount = Math.max(2, countRole(state.staff, ROLE.DUTY));
    state.settings.extraCount = countRole(state.staff, ROLE.EXTRA);
    syncSchedulesWithStaff();
  }
  if (generationChanged && state.schedule && !state.dirty) {
    const ok = await generateMonth();
    if (ok) {
      toast(
        countsChanged
          ? "Список сотрудников обновлён, график пересобран."
          : "Условия применены: график пересобран без ручных правок.",
        "success",
      );
    }
    return;
  }
  syncControls();
  renderAll();
  updateCalendarNote();
  markNeonDirty();
  writeStorage();
  if (generationChanged && state.dirty) {
    toast(
      "В этом месяце есть ручные правки, поэтому график не пересобран. Новые условия применятся к следующему месяцу.",
      "info",
      5600,
    );
  } else if (countsChanged) {
    toast("Список сотрудников обновлён, смены сохранены.", "success");
  } else {
    toast("Условия сохранены.", "info", 3200);
  }
}

function syncSchedulesWithStaff() {
  const staff = orderedStaff();
  for (const [key, saved] of Object.entries(state.schedules)) {
    if (!isValidScheduleEntry(saved)) continue;
    const total = daysInMonth(saved.year, saved.month);
    const byName = new Map(
      (saved.engineers || [])
        .filter((item) => item?.name)
        .map((item) => [item.name, item]),
    );
    state.schedules[key] = {
      ...saved,
      engineers: staff.map((member) => {
        const item = byName.get(member.name);
        return {
          name: member.name,
          role: member.role,
          position: member.position || "",
          shifts: normalizeShifts(item?.shifts, total, member.role),
          overtimeHours: Math.max(0, Number(item?.overtimeHours) || 0),
          overtimeByDay: Array.from({ length: total }, (_, index) =>
            Math.max(
              0,
              Math.min(24, Number(item?.overtimeByDay?.[index]) || 0),
            ),
          ),
        };
      }),
    };
  }
  if (state.schedule) {
    archiveActiveSchedule();
    const key = monthKey(state.schedule.year, state.schedule.month);
    restoreSavedSchedule(state.schedules[key]);
  }
}

function recalculateActiveSchedule() {
  if (!state.schedule) return;
  for (const engineer of state.schedule.engineers) {
    recalculateEngineer(
      engineer,
      state.settings.nightHours,
      state.settings.dailyHours,
      state.settings.workdayHours,
    );
  }
}

function renderAll() {
  if (!state.schedule) return;
  const validation = validateSchedule(state.schedule.engineers);
  state.validation = validation;
  renderSchedule(validation.issueDays);
  renderStats();
  renderValidation(validation);
  renderConditions();
  updateStatus();
}

function shiftTooltip(role) {
  if (role === ROLE.EXTRA) {
    return "Доп. инженер: правый клик — У (утро), Д (день), В (вечер), Отп (отпуск), переработка или выходной. Перетаскивание обменивает значения между датами.";
  }
  if (role === ROLE.FIVE_DAY) {
    return "5-дневный график: база — о (офис), у (удалёнка), в (выезд); дежурство — У, В, Н; Отп — отпуск. Если в дне уже есть база, дежурство добавляется второй частью: о/В; повторный выбор части в совмещённом дне убирает её. Правый клик → «Переработка» — часы сверх смены. Перетаскивание обменивает значения между датами.";
  }
  return "Суточник: правый клик — С, Н, о (офис), у (удалёнка), в (выезд), Отп (отпуск), переработка или выходной. Праздники — обычные сутки, в ячейке отмечены звёздочкой. Перетаскивание обменивает значения между датами.";
}

function shiftCellContent(shift, { holiday = false, overtime = 0 } = {}) {
  const parts = splitShift(shift);
  let html = esc(shift);
  let style = "";
  if (parts.length > 1) {
    const baseFill = SHIFT_FILL[parts[0]];
    const dutyFill = SHIFT_FILL[parts[1]];
    const baseColor = baseFill ? baseFill[0] : "#ffffff";
    const dutyColor = dutyFill ? dutyFill[0] : "#ffffff";
    html =
      `<span class="combo-part">${esc(parts[0])}</span>` +
      '<span class="combo-sep">/</span>' +
      `<span class="combo-part combo-duty">${esc(parts[1])}</span>`;
    style = ` style="background:linear-gradient(90deg, ${baseColor} 0 48%, ${dutyColor} 52% 100%)"`;
  }
  if (holiday) {
    html += '<span class="cell-mark cell-holiday" aria-hidden="true">★</span>';
  }
  if (overtime > 0) {
    html += `<span class="cell-mark cell-ot" aria-hidden="true">+${esc(formatNumber(overtime))}</span>`;
  }
  return { html, style };
}

function renderSchedule(issueDays) {
  const schedule = state.schedule;
  if (!schedule) return;
  const total = daysInMonth(schedule.year, schedule.month);
  const calendar = schedule.calendar;
  const engineers = schedule.engineers;

  let html = "<thead><tr><th class=\"name-head\">Инженер</th>";
  for (let day = 1; day <= total; day += 1) {
    const issue = issueDays.has(day);
    const iso = isoDate(schedule.year, schedule.month, day);
    const holiday = calendar.isHoliday(iso);
    const title = [
      holiday ? "Праздничный день" : "",
      issue ? "Проверьте покрытие дня или смены подряд" : "",
    ]
      .filter(Boolean)
      .join(". ");
    html += `<th class="day-head${holiday ? " holiday" : ""}${issue ? " issue" : ""}" title="${esc(title)}">${day}</th>`;
  }
  html += "</tr></thead><tbody>";

  for (let row = 0; row < engineers.length; row += 1) {
    const engineer = engineers[row];
    const roleTitle = ROLE_TITLES[engineer.role] || "";
    const metaParts = [engineer.position, engineer.phone].filter(Boolean);
    const meta = metaParts.length ? metaParts.join(" · ") : roleTitle;
    const nameTitle = [
      `${roleTitle}${engineer.position ? ` · ${engineer.position}` : ""}`,
      engineer.phone ? `Телефон: ${engineer.phone}` : "",
      "Нажмите, чтобы изменить роль, телефон и должность.",
    ]
      .filter(Boolean)
      .join("\n");
    html += "<tr>";
    html += `<th class="name-cell role-${esc(engineer.role)}" data-row="${row}" tabindex="0" title="${esc(nameTitle)}"><span class="name-main">${esc(engineer.name)}</span><span class="name-meta">${esc(meta)}</span></th>`;

    for (let day = 1; day <= total; day += 1) {
      const iso = isoDate(schedule.year, schedule.month, day);
      const shift = engineer.shifts[day - 1] || SHIFT.OFF;
      const parts = splitShift(shift);
      const combo = parts.length > 1;
      const holiday = calendar.isHoliday(iso);
      const overtime = Number(engineer.overtimeByDay?.[day - 1]) || 0;
      const weekend = !shift && calendar.isWeekend(iso);
      const classes = [
        "shift-cell",
        SHIFT_CLASS[shift] || "",
        combo ? "shift-combo" : "",
        weekend ? "is-weekend" : "",
        holiday ? "is-holiday" : "",
        overtime > 0 ? "has-overtime" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const content = shiftCellContent(shift, { holiday, overtime });
      const title = [
        holiday ? "Праздничный день" : "",
        overtime > 0 ? `Переработка +${formatNumber(overtime)} ч` : "",
        shiftTooltip(engineer.role),
      ]
        .filter(Boolean)
        .join(". ");
      html += `<td class="${classes}"${content.style} data-row="${row}" data-col="${day}" draggable="true" tabindex="-1" title="${esc(title)}">${content.html}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody><tfoot><tr><th class=\"name-cell dow-name\">Д.Н.</th>";
  for (let day = 1; day <= total; day += 1) {
    const iso = isoDate(schedule.year, schedule.month, day);
    const holiday = calendar.isHoliday(iso);
    const weekend = calendar.isWeekend(iso);
    const dow = DOW_RU[(isoWeekday(iso) + 6) % 7];
    const classes = ["dow-cell", holiday ? "holiday" : weekend ? "weekend" : ""]
      .filter(Boolean)
      .join(" ");
    html += `<td class="${classes}" title="${holiday ? "Праздничный день" : ""}">${dow}</td>`;
  }
  html += "</tr></tfoot>";

  els.scheduleTable.innerHTML = html;
  if (state.selected) {
    const { row, col } = state.selected;
    const selected = els.scheduleTable.querySelector(
      `.shift-cell[data-row="${row}"][data-col="${col}"]`,
    );
    if (selected) selected.classList.add("selected");
    else state.selected = null;
  }
}

function renderStats() {
  const schedule = state.schedule;
  const engineers = engineerStats(schedule.engineers);
  const norm = schedule.normHours;
  if (!engineers.length) {
    els.statsBody.innerHTML =
      '<tr><td colspan="8" class="loading-cell">Нет сотрудников для статистики.</td></tr>';
    els.statsSummary.textContent = "";
    return;
  }

  let total = 0;
  let html = "";
  for (const engineer of engineers) {
    const overtime = engineer.totalHours - norm;
    const color = Math.abs(overtime) <= 2 ? "ok" : overtime > 2 ? "bad" : "warn";
    total += engineer.totalHours;
    html += "<tr>";
    html += `<td>${esc(engineer.name)}</td>`;
    html += `<td>${engineer.nightCount}</td>`;
    html += `<td>${engineer.dailyCount}</td>`;
    html += `<td>${engineer.vacationDays}</td>`;
    html += `<td>${engineer.officeCount + engineer.remoteCount + engineer.tripCount}</td>`;
    html += `<td class="${color}"><b>${Math.round(engineer.totalHours)}</b></td>`;
    html += `<td>${formatNumber(engineer.overtimeTotal || 0)}</td>`;
    html += `<td class="${color}"><b>${formatSigned(overtime)}</b></td>`;
    html += "</tr>";
  }
  els.statsBody.innerHTML = html;
  const deviation = total - norm * engineers.length;
  els.statsSummary.innerHTML =
    `Норма месяца: <b>${Math.round(norm)} ч</b> &nbsp;·&nbsp; ` +
    `Итого: <b>${Math.round(total)} ч</b> &nbsp;·&nbsp; ` +
    `Отклонение от нормы: <b>${formatSigned(deviation)} ч</b>`;
}

function renderValidation(validation) {
  if (!validation.issues.length) {
    els.validation.className = "validation ok";
    els.validation.textContent =
      "Замечаний нет: нет двух дежурных в один день и смен подряд.";
    return;
  }
  els.validation.className = "validation has-issues";
  els.validation.innerHTML =
    `Замечания (${validation.issues.length}):<ul>` +
    validation.issues.map((issue) => `<li>${esc(issue)}</li>`).join("") +
    "</ul>";
}

function renderConditions() {
  const settings = state.settings;
  const displayMode = state.schedule?.mode || settings.mode;
  const displayAnchor = state.schedule?.anchorIso || settings.anchor;
  const duty = countRole(state.staff, ROLE.DUTY);
  const five = countRole(state.staff, ROLE.FIVE_DAY);
  const extra = countRole(state.staff, ROLE.EXTRA);
  const dailyHours = formatNumber(settings.dailyHours);
  const nightHours = formatNumber(settings.nightHours);

  let text = "";
  if (displayMode === MODE_ROTATION) {
    text =
      `Условия работы: смена ${dailyHours} ч (С, 10:00–10:00), ежедневно на смене один инженер. ` +
      `Ротация от ${formatDateRu(displayAnchor)}: 1 смена / ${Math.max(1, duty - 1)} дн. отдыха. ` +
      "Праздники суточники работают как обычные сутки. Перетащите смену на другую дату, чтобы обменять; правый клик — тип смены.";
  } else {
    text =
      `Условия работы: Н — ночная смена 19:00–10:00 (${nightHours} ч) · ` +
      `С — суточная смена 10:00–10:00 (${dailyHours} ч) · ` +
      "перерыв на обед 1 ч · ночной перерыв — от 30 мин до 2 ч (ст. 108 ТК РФ).";
  }
  if (five) {
    text += ` 5-дневных сотрудников: ${five} — офис, удалёнка, выезд или дежурство У / В / Н; совмещённый день показывается как о/В.`;
  }
  if (extra) {
    text += ` Доп. инженеров: ${extra} — У / Д / В ставятся вручную.`;
  }
  text +=
    " Отпуск — Отп; праздники отмечены ★ в строке сотрудника. Переработка: правый клик по ячейке → «Переработка» (часы сверх смены) или общая сумма в карточке сотрудника.";
  els.conditions.textContent = text;
}

function closeCellMenu() {
  els.cellMenu.hidden = true;
  els.cellMenu.dataset.row = "";
  els.cellMenu.dataset.col = "";
}

function openCellMenu(row, col, x, y) {
  const schedule = state.schedule;
  if (!schedule) return;
  const engineer = schedule.engineers[row];
  if (!engineer) return;

  const current = engineer.shifts[col - 1] || SHIFT.OFF;
  const options = CELL_OPTIONS[engineer.role] || CELL_OPTIONS[ROLE.DUTY];
  const overtime = Number(engineer.overtimeByDay?.[col - 1]) || 0;
  els.cellMenu.innerHTML =
    options
      .map(([shift, label]) => {
        const dotClass = SHIFT_CLASS[shift] || "";
        const active = shift ? shiftHas(current, shift) : current === SHIFT.OFF;
        return `<button type="button" role="menuitem" data-shift="${esc(shift)}" class="${active ? "active" : ""}"><span class="menu-dot ${dotClass}"></span><span>${esc(label)}</span><span class="menu-key">${esc(shift || "—")}</span></button>`;
      })
      .join("") +
    '<div class="menu-sep" role="separator"></div>' +
    `<button type="button" role="menuitem" data-action="overtime" class="${overtime > 0 ? "active" : ""}"><span class="menu-dot menu-dot-overtime"></span><span>Переработка</span><span class="menu-key">${overtime > 0 ? `+${esc(formatNumber(overtime))} ч` : "—"}</span></button>`;
  els.cellMenu.dataset.row = String(row);
  els.cellMenu.dataset.col = String(col);
  els.cellMenu.hidden = false;
  els.cellMenu.style.left = "0px";
  els.cellMenu.style.top = "0px";
  const rect = els.cellMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  els.cellMenu.style.left = `${left}px`;
  els.cellMenu.style.top = `${top}px`;
}

function applyShift(row, col, shift) {
  const schedule = state.schedule;
  if (!schedule) return;
  const engineer = schedule.engineers[row];
  if (!engineer) return;
  const index = col - 1;
  if (index < 0 || index >= engineer.shifts.length) return;
  const current = engineer.shifts[index] || SHIFT.OFF;
  const next =
    engineer.role === ROLE.FIVE_DAY
      ? mergeFiveDayShift(current, shift)
      : shift;
  if (current === next) {
    focusCell(row, col);
    return;
  }
  engineer.shifts[index] = next;
  recalculateEngineer(
    engineer,
    state.settings.nightHours,
    state.settings.dailyHours,
    state.settings.workdayHours,
  );
  state.dirty = true;
  markNeonDirty();
  renderAll();
  writeStorage();
  focusCell(row, col);
}

function openOvertimeDialog(row, col) {
  const schedule = state.schedule;
  const engineer = schedule?.engineers?.[row];
  if (!schedule || !engineer) return;
  overtimeTarget = { row, col };
  els.overtimeSubject.textContent =
    `${engineer.name} · ${formatDateRu(isoDate(schedule.year, schedule.month, col))}`;
  els.overtimeHours.value = formatNumber(
    Number(engineer.overtimeByDay?.[col - 1]) || 0,
  );
  els.overtimeDialog.showModal();
  els.overtimeHours.focus();
  els.overtimeHours.select();
}

function setDayOvertime(row, col, hours) {
  const schedule = state.schedule;
  const engineer = schedule?.engineers?.[row];
  if (!schedule || !engineer) return false;
  const total = daysInMonth(schedule.year, schedule.month);
  if (col < 1 || col > total) return false;
  if (!Array.isArray(engineer.overtimeByDay)) engineer.overtimeByDay = [];
  while (engineer.overtimeByDay.length < total) engineer.overtimeByDay.push(0);
  const next = hours > 0 ? hours : 0;
  if ((Number(engineer.overtimeByDay[col - 1]) || 0) === next) return false;
  engineer.overtimeByDay[col - 1] = next;
  recalculateEngineer(
    engineer,
    state.settings.nightHours,
    state.settings.dailyHours,
    state.settings.workdayHours,
  );
  state.dirty = true;
  archiveActiveSchedule();
  markNeonDirty();
  renderAll();
  writeStorage();
  return true;
}

function applyOvertimeFromDialog() {
  if (!overtimeTarget) return;
  const { row, col } = overtimeTarget;
  const hours = Math.max(0, clampNumber(els.overtimeHours.value, 0, 24, 0));
  const engineer = state.schedule?.engineers?.[row];
  const changed = setDayOvertime(row, col, hours);
  els.overtimeDialog.close();
  overtimeTarget = null;
  if (!changed) return;
  toast(
    hours > 0
      ? `Переработка ${formatDateRu(isoDate(state.schedule.year, state.schedule.month, col))}: +${formatNumber(hours)} ч для ${engineer.name}.`
      : "Переработка убрана.",
    "success",
  );
}

function removeOvertimeFromDialog() {
  if (!overtimeTarget) return;
  els.overtimeHours.value = "0";
  applyOvertimeFromDialog();
}

function swapShifts(rowA, colA, rowB, colB) {
  const schedule = state.schedule;
  if (!schedule) return;
  const engineerA = schedule.engineers[rowA];
  const engineerB = schedule.engineers[rowB];
  if (!engineerA || !engineerB) return;
  if ((rowA === rowB && colA === colB) || engineerA.role !== engineerB.role) {
    toast("Обменивать смены можно только между сотрудниками одной роли.", "error");
    return;
  }
  const indexA = colA - 1;
  const indexB = colB - 1;
  const shiftA = engineerA.shifts[indexA];
  const shiftB = engineerB.shifts[indexB];
  if (shiftA === shiftB) return;
  engineerA.shifts[indexA] = shiftB;
  engineerB.shifts[indexB] = shiftA;
  for (const engineer of [engineerA, engineerB]) {
    recalculateEngineer(
      engineer,
      state.settings.nightHours,
      state.settings.dailyHours,
      state.settings.workdayHours,
    );
  }
  state.dirty = true;
  markNeonDirty();
  renderAll();
  writeStorage();
  focusCell(rowB, colB);
}

function clearSelected() {
  els.scheduleTable
    .querySelectorAll(".shift-cell.selected")
    .forEach((cell) => cell.classList.remove("selected"));
}

function focusCell(row, col) {
  clearSelected();
  const cell = els.scheduleTable.querySelector(
    `.shift-cell[data-row="${row}"][data-col="${col}"]`,
  );
  if (!cell) return;
  state.selected = { row, col };
  cell.classList.add("selected");
  cell.focus({ preventScroll: false });
}

function clearDragState() {
  els.scheduleTable
    .querySelectorAll(".dragging, .drop-target")
    .forEach((cell) => cell.classList.remove("dragging", "drop-target"));
  state.dragSource = null;
  state.dropCell = null;
}

let dialogMode = "new";
let dialogIndex = -1;
let autoName = "";
let overtimeTarget = null;

function activeMonthRange() {
  const schedule = state.schedule;
  if (!schedule) return null;
  const total = daysInMonth(schedule.year, schedule.month);
  return {
    start: isoDate(schedule.year, schedule.month, 1),
    end: isoDate(schedule.year, schedule.month, total),
  };
}

function isoRange(startIso, endIso) {
  const result = [];
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return result;
  }
  for (let stamp = start; stamp <= end; stamp += 86400000) {
    const date = new Date(stamp);
    result.push(
      isoDate(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
      ),
    );
  }
  return result;
}

function updateEngineerDialogActions() {
  const isNew = dialogMode === "new";
  const member = isNew ? null : state.schedule?.rows?.[dialogIndex];
  const role = els.engRole.value;
  const roleChanged = Boolean(member && role !== member.role);
  els.engOvertimeField.hidden = false;
  els.engRegenerate.hidden = isNew || (role === ROLE.DUTY && !roleChanged);
  els.engVacation.hidden = isNew;
  els.engSecondaryActions.hidden =
    els.engRegenerate.hidden && els.engVacation.hidden;
  if (isNew) els.vacationPanel.hidden = true;
}

function openVacationPanel() {
  const range = activeMonthRange();
  if (!range) return;
  els.vacStart.min = range.start;
  els.vacStart.max = range.end;
  els.vacEnd.min = range.start;
  els.vacEnd.max = range.end;
  const today = todayIso();
  const initial =
    today >= range.start && today <= range.end ? today : range.start;
  els.vacStart.value = initial;
  els.vacEnd.value = initial;
  els.vacHint.textContent =
    `Отпуск проставляется в открытом месяце: ` +
    `${formatDateRu(range.start)}–${formatDateRu(range.end)}.`;
  els.vacationPanel.hidden = false;
  els.vacStart.focus();
}

function applyVacation() {
  const schedule = state.schedule;
  const member = schedule?.rows?.[dialogIndex];
  if (!schedule || !member) return;
  const engineer = schedule.engineers.find((item) => item.name === member.name);
  if (!engineer) return;
  let start = els.vacStart.value;
  let end = els.vacEnd.value;
  if (!start || !end) {
    toast("Укажите даты начала и окончания отпуска.", "error");
    return;
  }
  if (end < start) [start, end] = [end, start];
  const range = activeMonthRange();
  if (!range) return;
  if (end < range.start || start > range.end) {
    toast("Даты отпуска вне открытого месяца.", "error");
    return;
  }
  const days = isoRange(start, end).filter(
    (iso) => iso >= range.start && iso <= range.end,
  );
  if (!days.length) return;
  for (const iso of days) {
    engineer.shifts[Number(iso.slice(8, 10)) - 1] = SHIFT.VACATION;
  }
  recalculateEngineer(
    engineer,
    state.settings.nightHours,
    state.settings.dailyHours,
    state.settings.workdayHours,
  );
  state.dirty = true;
  archiveActiveSchedule();
  markNeonDirty();
  renderAll();
  writeStorage();
  els.vacationPanel.hidden = true;
  toast(
    `Отпуск ${formatDateRu(days[0])}–${formatDateRu(days[days.length - 1])} поставлен: ${member.name}.`,
    "success",
  );
}

async function regenerateEmployeeRow(name) {
  const schedule = state.schedule;
  if (!schedule) return false;
  const year = schedule.year;
  const month = schedule.month;
  await ensureCalendarsAround(year);
  if (
    !state.schedule ||
    state.schedule.year !== year ||
    state.schedule.month !== month
  ) {
    return false;
  }
  const engineer = state.schedule.engineers.find((item) => item.name === name);
  if (!engineer) return false;
  const { rotationStartIndex, prevOnDuty } = continuationFromPrevious(year, month);
  const fresh = buildSchedule({
    staff: state.staff,
    year,
    month,
    mode: schedule.mode,
    anchorIso: schedule.anchorIso,
    calendars: chainCalendars(year),
    useHolidays: state.settings.useHolidays,
    nightHours: state.settings.nightHours,
    dailyHours: state.settings.dailyHours,
    workdayHours: state.settings.workdayHours,
    rotationStartIndex,
    prevOnDuty,
  });
  const source = fresh.engineers.find((item) => item.name === name);
  if (!source) return false;
  engineer.shifts = [...source.shifts];
  recalculateEngineer(
    engineer,
    state.settings.nightHours,
    state.settings.dailyHours,
    state.settings.workdayHours,
  );
  state.dirty = true;
  archiveActiveSchedule();
  markNeonDirty();
  renderAll();
  writeStorage();
  return true;
}

function openEngineerModal(index = null) {
  dialogMode = index === null ? "new" : "edit";
  dialogIndex = index === null ? -1 : index;
  els.engName.value = "";
  els.engName.setCustomValidity("");
  els.engRole.value = ROLE.DUTY;
  els.engPosition.value = "";
  els.engPhone.value = "";
  els.engOvertime.value = "0";
  els.vacationPanel.hidden = true;

  if (dialogMode === "new") {
    els.engineerTitle.textContent = "Новый сотрудник";
    els.engDelete.hidden = true;
    autoName = "";
    autoName = defaultName(
      ROLE.DUTY,
      state.staff.filter((member) => member.role === ROLE.DUTY),
      state.staff,
    );
    els.engName.value = autoName;
  } else {
    const member = state.schedule?.rows?.[index];
    if (!member) return;
    const engineer = state.schedule?.engineers?.find(
      (item) => item.name === member.name,
    );
    els.engineerTitle.textContent = "Сотрудник отдела";
    els.engDelete.hidden = false;
    els.engName.value = member.name;
    els.engRole.value = member.role;
    els.engPosition.value = member.position || "";
    els.engPhone.value = member.phone || "";
    els.engOvertime.value = formatNumber(Number(engineer?.overtimeHours) || 0);
    autoName = "";
  }

  updateEngineerDialogActions();
  els.engineerDialog.showModal();
  requestAnimationFrame(() => {
    els.engName.focus();
    els.engName.select();
  });
}

function fillFiveDayOffice(names) {
  const schedule = state.schedule;
  if (!schedule || !names.length) return;
  const targets = new Set(names);
  const total = daysInMonth(schedule.year, schedule.month);
  let changed = false;
  for (const engineer of schedule.engineers) {
    if (engineer.role !== ROLE.FIVE_DAY || !targets.has(engineer.name)) continue;
    for (let day = 1; day <= total; day += 1) {
      if (engineer.shifts[day - 1]) continue;
      const iso = isoDate(schedule.year, schedule.month, day);
      if (schedule.calendar.isWeekend(iso) || schedule.calendar.isHoliday(iso)) {
        continue;
      }
      engineer.shifts[day - 1] = SHIFT.OFFICE;
      changed = true;
    }
    recalculateEngineer(
      engineer,
      state.settings.nightHours,
      state.settings.dailyHours,
      state.settings.workdayHours,
    );
  }
  if (changed) archiveActiveSchedule();
}

async function applyStaffChanges(message, { fillFiveDay = [] } = {}) {
  state.settings.dutyCount = Math.max(2, countRole(state.staff, ROLE.DUTY));
  state.settings.extraCount = countRole(state.staff, ROLE.EXTRA);
  syncSchedulesWithStaff();
  fillFiveDayOffice(fillFiveDay);
  syncControls();
  renderAll();
  updateCalendarNote();
  markNeonDirty();
  writeStorage();
  if (message) toast(message, "success");
}

function renameMemberInArchives(oldName, name, position) {
  for (const saved of Object.values(state.schedules)) {
    if (!Array.isArray(saved.engineers)) continue;
    for (const item of saved.engineers) {
      if (item?.name === oldName) {
        item.name = name;
        item.position = position;
      }
    }
  }
}

async function commitEngineerForm({ regenerate = false } = {}) {
  const name = els.engName.value.trim();
  if (!name) {
    els.engName.setCustomValidity("Укажите имя сотрудника.");
    els.engName.reportValidity();
    return;
  }
  els.engName.setCustomValidity("");
  const role = els.engRole.value;
  const position = els.engPosition.value.trim();
  const phone = els.engPhone.value.trim();
  const overtimeHours = Math.max(
    0,
    clampNumber(els.engOvertime.value, 0, 400, 0),
  );
  const dutyNow = countRole(state.staff, ROLE.DUTY);
  const extraNow = countRole(state.staff, ROLE.EXTRA);

  if (dialogMode === "new") {
    if (role === ROLE.DUTY && dutyNow >= MAX_DUTY) {
      toast("Слишком много суточников в графике.", "error");
      return;
    }
    if (role === ROLE.EXTRA && extraNow >= MAX_EXTRA) {
      toast("Слишком много доп. инженеров.", "error");
      return;
    }
    state.staff.push({ name, role, position, phone });
    els.engineerDialog.close();
    await applyStaffChanges(`Добавлен сотрудник: ${name}`, {
      fillFiveDay: role === ROLE.FIVE_DAY ? [name] : [],
    });
    const added = state.schedule?.engineers?.find((item) => item.name === name);
    if (added && overtimeHours > 0) {
      added.overtimeHours = overtimeHours;
      recalculateEngineer(
        added,
        state.settings.nightHours,
        state.settings.dailyHours,
        state.settings.workdayHours,
      );
      state.dirty = true;
      archiveActiveSchedule();
      markNeonDirty();
      renderAll();
      writeStorage();
    }
    return;
  }

  const member = state.schedule?.rows?.[dialogIndex];
  if (!member) {
    els.engineerDialog.close();
    return;
  }
  const dutyAfter =
    dutyNow - (member.role === ROLE.DUTY ? 1 : 0) + (role === ROLE.DUTY ? 1 : 0);
  const extraAfter =
    extraNow - (member.role === ROLE.EXTRA ? 1 : 0) + (role === ROLE.EXTRA ? 1 : 0);
  if (dutyAfter < 2) {
    toast("В ротации должно остаться минимум 2 суточника.", "error");
    return;
  }
  if (dutyAfter > MAX_DUTY || extraAfter > MAX_EXTRA) {
    toast("Слишком много сотрудников этой роли.", "error");
    return;
  }
  const roleChanged = role !== member.role;
  const oldName = member.name;
  const scheduleEngineer = state.schedule?.engineers?.find(
    (item) => item.name === oldName,
  );
  member.name = name;
  member.role = role;
  member.position = position;
  member.phone = phone;
  if (scheduleEngineer) {
    scheduleEngineer.name = name;
    scheduleEngineer.role = role;
    scheduleEngineer.position = position;
    scheduleEngineer.phone = phone;
    scheduleEngineer.overtimeHours = overtimeHours;
  }
  els.engineerDialog.close();
  if (oldName !== name) renameMemberInArchives(oldName, name, position);

  if (!roleChanged) {
    if (scheduleEngineer) {
      recalculateEngineer(
        scheduleEngineer,
        state.settings.nightHours,
        state.settings.dailyHours,
        state.settings.workdayHours,
      );
    }
    archiveActiveSchedule();
    markNeonDirty();
    renderAll();
    writeStorage();
    if (regenerate) {
      const ok = await regenerateEmployeeRow(name);
      toast(
        ok
          ? `График сотрудника ${name} сформирован заново в открытом месяце.`
          : "Не удалось пересобрать строку сотрудника.",
        ok ? "success" : "error",
      );
      return;
    }
    toast("Данные сотрудника сохранены, смены не изменились.", "success");
    return;
  }

  await applyStaffChanges(
    role === ROLE.FIVE_DAY
      ? "Роль изменена на 5-дневную: пустые будни заполнены офисом, совместимые смены сохранены."
      : "Роль изменена. Смены, несовместимые с новой ролью, обнулены; совместимые сохранены.",
    { fillFiveDay: !regenerate && role === ROLE.FIVE_DAY ? [name] : [] },
  );
  if (regenerate) {
    const ok = await regenerateEmployeeRow(name);
    toast(
      ok
        ? `График сотрудника ${name} сформирован заново в открытом месяце.`
        : "Не удалось пересобрать строку сотрудника.",
      ok ? "success" : "error",
    );
  }
}

async function onEngineerSubmit(event) {
  event.preventDefault();
  await commitEngineerForm();
}

async function onEngineerDelete() {
  const member = state.schedule?.rows?.[dialogIndex];
  if (!member) return;
  if (member.role === ROLE.DUTY && countRole(state.staff, ROLE.DUTY) <= 2) {
    toast("В ротации должно остаться минимум 2 суточника.", "error");
    return;
  }
  const ok = window.confirm(`Удалить сотрудника «${member.name}»?`);
  if (!ok) return;
  state.staff = state.staff.filter((item) => item !== member);
  els.engineerDialog.close();
  await applyStaffChanges("Сотрудник удалён, смены остальных сохранены");
}

function openSettingsDialog() {
  els.setNight.value = formatNumber(state.settings.nightHours);
  els.setDaily.value = formatNumber(state.settings.dailyHours);
  els.setWorkday.value = formatNumber(state.settings.workdayHours);
  els.settingsDialog.showModal();
}

async function onSettingsSubmit(event) {
  event.preventDefault();
  state.settings.nightHours = clampNumber(els.setNight.value, 1, 24, 15);
  state.settings.dailyHours = clampNumber(els.setDaily.value, 1, 24, 24);
  state.settings.workdayHours = clampNumber(els.setWorkday.value, 1, 24, 8);
  els.settingsDialog.close();
  recalculateActiveSchedule();
  renderAll();
  markNeonDirty();
  writeStorage();
  toast("Часы смен обновлены: статистика пересчитана, график не изменён.", "success");
}

function exportExcel() {
  const schedule = state.schedule;
  if (!schedule || !schedule.engineers.length) {
    toast("Сначала сформируйте график.", "error");
    return;
  }
  const total = daysInMonth(schedule.year, schedule.month);
  const calendar = schedule.calendar;
  const base =
    "border:1px solid #999999;text-align:center;vertical-align:middle;font-family:Calibri,Arial,sans-serif;font-size:11pt;";
  const header = `${base}background:#305496;color:#FFFFFF;font-weight:bold;`;

  let html = `<html><head><meta charset="utf-8"><style>table{border-collapse:collapse;} td{height:24px;}</style></head><body><table><tr><td style="${header}">Инженер</td>`;
  for (let day = 1; day <= total; day += 1) {
    html += `<td style="${header}">${day}</td>`;
  }
  html += "</tr>";

  for (const engineer of schedule.engineers) {
    const nameStyle = `${base}background:${NAME_FILL[engineer.role] || "#D9E1F2"};font-weight:bold;`;
    html += `<tr><td style="${nameStyle}">${esc(engineer.name)}</td>`;
    for (let day = 1; day <= total; day += 1) {
      const iso = isoDate(schedule.year, schedule.month, day);
      const shift = engineer.shifts[day - 1] || SHIFT.OFF;
      const overtime = Number(engineer.overtimeByDay?.[day - 1]) || 0;
      const fill = SHIFT_FILL[shift] || SHIFT_FILL[splitShift(shift)[0]];
      let style = base;
      if (fill) {
        style += `background:${fill[0]};color:${fill[1]};font-weight:bold;`;
      } else if (calendar.isWeekend(iso)) {
        style += "background:#FFF2CC;";
      } else {
        style += "background:#FFFFFF;";
      }
      if (calendar.isHoliday(iso)) style += "border:2px solid #C00000;";
      const label = overtime > 0 ? `${shift} +${formatNumber(overtime)}`.trim() : shift;
      html += `<td style="${style}">${esc(label)}</td>`;
    }
    html += "</tr>";
  }

  html += `<tr><td style="${base}background:#D9E1F2;font-weight:bold;">Д.Н.</td>`;
  for (let day = 1; day <= total; day += 1) {
    const iso = isoDate(schedule.year, schedule.month, day);
    const holiday = calendar.isHoliday(iso);
    const weekend = calendar.isWeekend(iso);
    const dow = DOW_RU[(isoWeekday(iso) + 6) % 7];
    const style = holiday
      ? `${base}background:#C00000;color:#FFFFFF;font-weight:bold;`
      : weekend
        ? `${base}background:#FFF2CC;font-weight:bold;`
        : `${base}font-weight:bold;`;
    html += `<td style="${style}">${dow}</td>`;
  }
  html += "</tr>";

  html += `<tr><td style="border:none;height:12px;" colspan="${total + 1}"></td></tr>`;
  html += `<tr><td style="border:none;font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:bold;" colspan="${total + 1}">Статистика</td></tr>`;

  const statsHeader = `${base}background:#D9E1F2;font-weight:bold;`;
  const statsHeaders = [
    "Инженер",
    "Ночных",
    "Суточных",
    "Отпуск",
    "5-дн.",
    "Часов",
    "Переработка",
    "Отклонение",
  ];
  html += "<tr>";
  for (const label of statsHeaders) {
    html += `<td style="${statsHeader}">${label}</td>`;
  }
  html += "</tr>";

  for (const engineer of engineerStats(schedule.engineers)) {
    const overtime = engineer.totalHours - schedule.normHours;
    const values = [
      engineer.name,
      engineer.nightCount,
      engineer.dailyCount,
      engineer.vacationDays,
      engineer.officeCount + engineer.remoteCount + engineer.tripCount,
      engineer.totalHours,
      engineer.overtimeTotal || 0,
      overtime,
    ];
    for (const value of values) {
      html += `<td style="${base}">${esc(typeof value === "number" ? Math.round(value) : value)}</td>`;
    }
    html += "</tr>";
  }
  html += "</table></body></html>";

  const blob = new Blob(["\ufeff", html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `grafik_${schedule.year}_${pad2(schedule.month)}.xls`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast("Файл Excel сохранён.", "success");
}

async function importCalendar(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const clean = sanitizeCalendarData(raw);
    if (!clean) {
      toast("Файл календаря пуст или имеет неверный формат.", "error");
      return;
    }
    const years = new Set(Object.keys(clean).map((iso) => Number(iso.slice(0, 4))));
    const fileYear = years.size === 1 ? [...years][0] : state.settings.year;
    state.customCalendars[fileYear] = clean;
    state.calendarData[fileYear] = clean;
    if (state.settings.year !== fileYear) {
      archiveActiveSchedule();
      state.settings.year = fileYear;
      syncControls();
      await activateMonth({ notify: true });
    } else if (state.schedule && state.schedule.year === fileYear) {
      const calendar = effectiveCalendar(fileYear, state.schedule.month);
      state.schedule.calendar = calendar;
      state.schedule.normHours = calendar.getNormHours(
        fileYear,
        state.schedule.month,
      );
      renderAll();
    }
    markNeonDirty();
    writeStorage();
    toast(
      `Календарь за ${fileYear} загружен. Смены сохранены, пересчитаны нормы и праздники.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    toast("Не удалось прочитать JSON календаря.", "error");
  }
}

function bindEvents() {
  els.btnExport.addEventListener("click", exportExcel);
  els.btnSettings.addEventListener("click", openSettingsDialog);
  els.btnAdd.addEventListener("click", () => openEngineerModal(null));
  els.btnCalendar.addEventListener("click", () => {
    els.calendarFile.value = "";
    els.calendarFile.click();
  });
  els.calendarFile.addEventListener("change", () => {
    const file = els.calendarFile.files?.[0];
    if (file) importCalendar(file);
  });

  els.inMonth.addEventListener("change", onPeriodChange);
  els.inYear.addEventListener("change", onPeriodChange);
  for (const element of [
    els.inDutyCount,
    els.inExtraCount,
    els.inMode,
    els.inAnchor,
    els.inHolidays,
  ]) {
    element.addEventListener("change", onSettingsChange);
  }

  els.scheduleTable.addEventListener("click", (event) => {
    const shiftCell = event.target.closest(".shift-cell");
    if (shiftCell) {
      clearSelected();
      const row = Number(shiftCell.dataset.row);
      const col = Number(shiftCell.dataset.col);
      state.selected = { row, col };
      shiftCell.classList.add("selected");
      shiftCell.focus({ preventScroll: true });
      return;
    }
    const nameCell = event.target.closest(".name-cell[data-row]");
    if (nameCell) openEngineerModal(Number(nameCell.dataset.row));
  });

  els.scheduleTable.addEventListener("contextmenu", (event) => {
    const cell = event.target.closest(".shift-cell");
    if (!cell) return;
    event.preventDefault();
    openCellMenu(
      Number(cell.dataset.row),
      Number(cell.dataset.col),
      event.clientX,
      event.clientY,
    );
  });

  els.scheduleTable.addEventListener("keydown", (event) => {
    const nameCell = event.target.closest(".name-cell[data-row]");
    if (nameCell && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openEngineerModal(Number(nameCell.dataset.row));
      return;
    }
    const cell = event.target.closest(".shift-cell");
    if (!cell || !state.schedule) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      applyShift(row, col, SHIFT.OFF);
      return;
    }
    let nextRow = row;
    let nextCol = col;
    if (event.key === "ArrowUp") nextRow -= 1;
    else if (event.key === "ArrowDown") nextRow += 1;
    else if (event.key === "ArrowLeft") nextCol -= 1;
    else if (event.key === "ArrowRight") nextCol += 1;
    else return;
    event.preventDefault();
    const maxRow = state.schedule.engineers.length - 1;
    const maxCol = daysInMonth(state.schedule.year, state.schedule.month);
    nextRow = Math.min(maxRow, Math.max(0, nextRow));
    nextCol = Math.min(maxCol, Math.max(1, nextCol));
    focusCell(nextRow, nextCol);
  });

  els.scheduleTable.addEventListener("dragstart", (event) => {
    const cell = event.target.closest(".shift-cell");
    if (!cell) {
      event.preventDefault();
      return;
    }
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    state.dragSource = { row, col };
    state.dropCell = null;
    cell.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("application/x-shift", JSON.stringify({ row, col }));
      event.dataTransfer.setData("text/plain", `${row}:${col}`);
    } catch {
      // Some browsers restrict custom drag data; in-page state still works.
    }
  });

  els.scheduleTable.addEventListener("dragover", (event) => {
    const cell = event.target.closest(".shift-cell");
    if (!cell || !state.dragSource) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    if (
      row === state.dragSource.row &&
      col === state.dragSource.col
    ) {
      return;
    }
    const source = state.schedule.engineers[state.dragSource.row];
    const target = state.schedule.engineers[row];
    if (!source || !target || source.role !== target.role) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (state.dropCell && state.dropCell !== cell) {
      state.dropCell.classList.remove("drop-target");
    }
    cell.classList.add("drop-target");
    state.dropCell = cell;
  });

  els.scheduleTable.addEventListener("dragleave", (event) => {
    const cell = event.target.closest(".shift-cell");
    if (cell) cell.classList.remove("drop-target");
  });

  els.scheduleTable.addEventListener("drop", (event) => {
    const cell = event.target.closest(".shift-cell");
    if (!cell) return;
    event.preventDefault();
    const source = state.dragSource;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    clearDragState();
    if (!source) return;
    swapShifts(source.row, source.col, row, col);
  });

  els.scheduleTable.addEventListener("dragend", clearDragState);

  els.cellMenu.addEventListener("click", (event) => {
    const row = Number(els.cellMenu.dataset.row);
    const col = Number(els.cellMenu.dataset.col);
    const overtimeButton = event.target.closest('button[data-action="overtime"]');
    if (overtimeButton) {
      closeCellMenu();
      openOvertimeDialog(row, col);
      return;
    }
    const button = event.target.closest("button[data-shift]");
    if (!button) return;
    const shift = button.dataset.shift;
    closeCellMenu();
    applyShift(row, col, shift);
  });

  document.addEventListener("click", (event) => {
    if (!els.cellMenu.hidden && !els.cellMenu.contains(event.target)) {
      closeCellMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCellMenu();
  });

  window.addEventListener("resize", closeCellMenu);
  els.scheduleWrap.addEventListener("scroll", closeCellMenu);

  els.engineerForm.addEventListener("submit", onEngineerSubmit);
  els.engDelete.addEventListener("click", onEngineerDelete);
  els.engCancel.addEventListener("click", () => els.engineerDialog.close());
  els.engRegenerate.addEventListener("click", () => {
    commitEngineerForm({ regenerate: true });
  });
  els.engVacation.addEventListener("click", openVacationPanel);
  els.vacApply.addEventListener("click", applyVacation);
  els.vacCancel.addEventListener("click", () => {
    els.vacationPanel.hidden = true;
  });
  els.overtimeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyOvertimeFromDialog();
  });
  els.overtimeRemove.addEventListener("click", removeOvertimeFromDialog);
  els.overtimeCancel.addEventListener("click", () => {
    els.overtimeDialog.close();
    overtimeTarget = null;
  });
  els.overtimeDialog.addEventListener("close", () => {
    overtimeTarget = null;
  });
  els.engRole.addEventListener("change", () => {
    updateEngineerDialogActions();
    if (dialogMode !== "new") return;
    const role = els.engRole.value;
    const members = state.staff.filter((member) => member.role === role);
    const next = defaultName(role, members, state.staff);
    if (!els.engName.value.trim() || els.engName.value === autoName) {
      autoName = next;
      els.engName.value = next;
    }
  });
  els.engName.addEventListener("input", () => els.engName.setCustomValidity(""));

  els.settingsForm.addEventListener("submit", onSettingsSubmit);
  els.setCancel.addEventListener("click", () => els.settingsDialog.close());

  els.neonForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyNeonFormConfig();
    els.neonDialog.close();
    if (!state.neon.password) {
      toast("Пароль не задан: правки сохраняются только в этом браузере.", "info");
      return;
    }
    if (hasManualSchedules() || state.neonDirty) {
      markNeonDirty();
      toast("Neon подключён: текущий график будет сохранён.", "success");
    } else {
      toast("Neon подключён: новые правки сохраняются автоматически.", "success");
    }
  });
  els.neonClose.addEventListener("click", () => els.neonDialog.close());
  els.neonLoad.addEventListener("click", async () => {
    applyNeonFormConfig();
    if (!neonConfigured(state.neon)) {
      toast("Укажите Data API URL и Auth URL Neon.", "info");
      return;
    }
    els.neonDialog.close();
    await readNeonState();
  });
  els.neonSave.addEventListener("click", async () => {
    applyNeonFormConfig();
    if (!neonConfigured(state.neon) || !state.neon.password) {
      toast("Укажите адреса Neon и общий пароль.", "info");
      return;
    }
    els.neonDialog.close();
    await saveToNeon();
  });
}

async function boot() {
  cacheElements();
  buildMonthOptions();
  bindEvents();

  state.neonUpdatedAt = state.neon.lastUpdatedAt || "";

  const stored = readStorage();
  if (stored?.customCalendars) mergeCustomCalendars(stored.customCalendars);
  state.settings = normalizeSettings(stored?.settings, null);

  const preservedMonths = localManualSchedules(stored);
  const neonLoaded = await readNeonState({ silent: true });
  if (!neonLoaded) {
    await applySavedState(stored, "local");
  } else if (preservedMonths.size) {
    for (const [key, value] of preservedMonths) state.schedules[key] = value;
    if (await activateMonth()) {
      updateStatus();
      writeStorage();
    }
  }

  state.neonReady = true;
  updateStatus();
  refreshNeonDialog();

  if (!state.neon.password) openNeonDialog();
}

boot().catch((error) => {
  console.error(error);
  toast(`Не удалось запустить приложение: ${error.message}`, "error");
});
