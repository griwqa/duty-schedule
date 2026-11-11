import calendar as cal
from datetime import date

from core.models import (
    Engineer,
    ROLE_DUTY,
    ROLE_EXTRA,
    ROLE_FIVE_DAY,
    ShiftType,
)
from core.production_calendar import ProductionCalendar


def generate_rotation(
    year: int,
    month: int,
    engineers: list[str],
    anchor: date,
    prod_calendar: ProductionCalendar,
    use_holidays: bool = True,
    shift_hours: float = 24.0,
) -> list[Engineer]:
    """
    График «сутки через трое»: каждый день на смене ровно один инженер,
    ротация по кругу от даты anchor. Для 4 инженеров цикл = 4 дня
    (1 смена / 3 выходных), для N инженеров — 1 смена / N-1 выходных.
    Смена считается непрерывной от anchor, поэтому стык месяцев не сбивается.
    """
    if not engineers:
        return []

    count = len(engineers)
    _, days_in_month = cal.monthrange(year, month)
    result = [Engineer(name=name) for name in engineers]
    for eng in result:
        eng.shifts = [ShiftType.OFF] * days_in_month

    for day_num in range(1, days_in_month + 1):
        d = date(year, month, day_num)
        idx = (d.toordinal() - anchor.toordinal()) % count
        if use_holidays and prod_calendar.is_holiday(d):
            result[idx].shifts[day_num - 1] = ShiftType.HOLIDAY
        else:
            result[idx].shifts[day_num - 1] = ShiftType.DAILY

    for eng in result:
        eng.recalculate(shift_hours, shift_hours)
    return result


def make_extra_engineers(
    names: list[str],
    year: int,
    month: int,
) -> list[Engineer]:
    """Доп. инженеры-подменные: строки без смен, значения У/Д/В ставятся вручную."""
    _, days_in_month = cal.monthrange(year, month)
    result = []
    for name in names:
        eng = Engineer(name=name, role=ROLE_EXTRA)
        eng.shifts = [ShiftType.OFF] * days_in_month
        result.append(eng)
    return result


def make_five_day_engineers(
    members,
    year: int,
    month: int,
    prod_calendar: ProductionCalendar,
    workday_hours: float = 8.0,
) -> list[Engineer]:
    """5-дневный график: рабочие дни по календарю — офис, остальное — выходной."""
    _, days_in_month = cal.monthrange(year, month)
    result = []
    for member in members:
        eng = Engineer(
            name=member.name,
            role=ROLE_FIVE_DAY,
            position=member.position,
        )
        eng.shifts = []
        for day_num in range(1, days_in_month + 1):
            d = date(year, month, day_num)
            if prod_calendar.is_weekend(d) or prod_calendar.is_holiday(d):
                eng.shifts.append(ShiftType.OFF)
            else:
                eng.shifts.append(ShiftType.OFFICE)
        eng.recalculate(workday_hours, workday_hours, workday_hours)
        result.append(eng)
    return result


def validate_schedule(
    engineers: list[Engineer],
) -> tuple[list[str], set[int]]:
    """
    Проверка графика после ручных правок.
    Доп. инженеры и 5-дневные сотрудники не участвуют в покрытии суток.
    Возвращает (список замечаний, множество проблемных дней 1-based).
    """
    issues: list[str] = []
    issue_days: set[int] = set()
    duty = [e for e in engineers if e.role == ROLE_DUTY]
    if not duty:
        return issues, issue_days

    days = len(duty[0].shifts)
    for i in range(days):
        on_duty = [e.name for e in duty if e.shifts[i] != ShiftType.OFF]
        if len(on_duty) != 1:
            issue_days.add(i + 1)
            if not on_duty:
                issues.append(f"день {i + 1}: смена не назначена")
            else:
                issues.append(f"день {i + 1}: на смене {len(on_duty)} чел.")

    for eng in duty:
        for i in range(len(eng.shifts) - 1):
            if (
                eng.shifts[i] != ShiftType.OFF
                and eng.shifts[i + 1] != ShiftType.OFF
            ):
                issues.append(f"{eng.name}: смены подряд {i + 1}–{i + 2}")
                issue_days.add(i + 1)
                issue_days.add(i + 2)

    return issues, issue_days
