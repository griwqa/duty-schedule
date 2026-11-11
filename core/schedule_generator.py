import calendar as cal
from datetime import date

from core.models import Engineer, ShiftType
from core.production_calendar import ProductionCalendar


class ScheduleGenerator:
    """
    Алгоритм распределения смен:
    - ночные (будни) 19:00–10:00 = 15 ч
    - суточные (выходные/праздники) 10:00–10:00 = 24 ч
    - равномерная нагрузка
    - без двух смен подряд у одного инженера
    """

    NIGHT_HOURS = 15.0
    DAILY_HOURS = 24.0

    def __init__(
        self,
        year: int,
        month: int,
        engineers: list[str],
        prod_calendar: ProductionCalendar = None,
        night_hours: float = 15.0,
        daily_hours: float = 24.0,
        use_holidays: bool = True,
        prev_on_duty: dict[str, bool] | None = None,
    ):
        self.year = year
        self.month = month
        self.prod_calendar = prod_calendar or ProductionCalendar()
        self.night_hours = night_hours
        self.daily_hours = daily_hours
        self.use_holidays = use_holidays
        # Кто работал в последний день предыдущего месяца (ночь или сутки).
        self.prev_on_duty = prev_on_duty or {}

        self.engineers = [Engineer(name=n) for n in engineers]
        _, self.days_in_month = cal.monthrange(year, month)

    def generate(self) -> list[Engineer]:
        days = [
            date(self.year, self.month, d)
            for d in range(1, self.days_in_month + 1)
        ]

        workdays, holidays = [], []
        for d in days:
            is_off = self.prod_calendar.is_weekend(d) or (
                self.use_holidays and self.prod_calendar.is_holiday(d)
            )
            if is_off:
                holidays.append(d)
            else:
                workdays.append(d)

        for eng in self.engineers:
            eng.shifts = [ShiftType.OFF] * self.days_in_month
            eng.total_hours = 0.0
            eng.night_count = 0
            eng.daily_count = 0
            eng.holiday_count = 0

        for d in workdays:
            day_idx = d.day - 1
            eng = self._pick_for_night(day_idx)
            self._assign(eng, day_idx, ShiftType.NIGHT, self.night_hours)

        for d in holidays:
            day_idx = d.day - 1
            eng = self._pick_for_daily(day_idx)
            if self.use_holidays and self.prod_calendar.is_holiday(d):
                self._assign(eng, day_idx, ShiftType.HOLIDAY, self.daily_hours)
            else:
                self._assign(eng, day_idx, ShiftType.DAILY, self.daily_hours)

        self._balance()
        return self.engineers

    def _assign(self, eng: Engineer, day_idx: int, shift: ShiftType, hours: float):
        eng.shifts[day_idx] = shift
        eng.total_hours += hours
        if shift == ShiftType.NIGHT:
            eng.night_count += 1
        elif shift == ShiftType.DAILY:
            eng.daily_count += 1
        elif shift == ShiftType.HOLIDAY:
            eng.holiday_count += 1

    def _unassign(self, eng: Engineer, day_idx: int):
        shift = eng.shifts[day_idx]
        if shift == ShiftType.OFF:
            return
        if shift == ShiftType.NIGHT:
            eng.night_count -= 1
            eng.total_hours -= self.night_hours
        elif shift == ShiftType.DAILY:
            eng.daily_count -= 1
            eng.total_hours -= self.daily_hours
        elif shift == ShiftType.HOLIDAY:
            eng.holiday_count -= 1
            eng.total_hours -= self.daily_hours
        eng.shifts[day_idx] = ShiftType.OFF

    def _has_adjacent_duty(self, eng: Engineer, day_idx: int) -> bool:
        if day_idx == 0 and self.prev_on_duty.get(eng.name):
            return True
        for adj in (day_idx - 1, day_idx + 1):
            if 0 <= adj < self.days_in_month and eng.shifts[adj] != ShiftType.OFF:
                return True
        return False

    def _pick_for_night(self, day_idx: int) -> Engineer:
        free = [e for e in self.engineers if e.shifts[day_idx] == ShiftType.OFF]
        no_adj = [e for e in free if not self._has_adjacent_duty(e, day_idx)]
        pool = no_adj or free
        return min(pool, key=lambda e: (e.total_hours, e.night_count, e.name))

    def _pick_for_daily(self, day_idx: int) -> Engineer:
        free = [e for e in self.engineers if e.shifts[day_idx] == ShiftType.OFF]
        no_adj = [e for e in free if not self._has_adjacent_duty(e, day_idx)]
        pool = no_adj or free
        # Сначала выравниваем число суточных, затем часы
        return min(
            pool,
            key=lambda e: (
                e.daily_count + e.holiday_count,
                e.total_hours,
                e.name,
            ),
        )

    def _shift_hours(self, shift: ShiftType) -> float:
        if shift == ShiftType.NIGHT:
            return self.night_hours
        if shift in (ShiftType.DAILY, ShiftType.HOLIDAY):
            return self.daily_hours
        return 0.0

    def _can_take(self, eng: Engineer, day_idx: int) -> bool:
        return (
            eng.shifts[day_idx] == ShiftType.OFF
            and not self._has_adjacent_duty(eng, day_idx)
        )

    def _balance(self):
        """Выравнивание: перенос ночных и суточных смен без соседства."""
        max_iter = 200
        for _ in range(max_iter):
            ordered = sorted(self.engineers, key=lambda e: e.total_hours)
            low, high = ordered[0], ordered[-1]
            diff = high.total_hours - low.total_hours

            if diff < self.night_hours:
                break

            # Сначала пробуем перенести более «тяжёлую» смену (сутки),
            # если разница позволяет, иначе — ночную.
            candidates = []
            for i, shift in enumerate(high.shifts):
                if shift == ShiftType.OFF:
                    continue
                if not self._can_take(low, i):
                    continue
                hours = self._shift_hours(shift)
                if hours > diff + 0.1:
                    continue  # перенос ухудшит баланс (перелёт)
                # После переноса разница должна уменьшиться
                new_diff = abs((high.total_hours - hours) - (low.total_hours + hours))
                if new_diff >= diff:
                    continue
                candidates.append((hours, -new_diff, i, shift))

            if not candidates:
                # Попробуем обмен сменами в разные дни
                if not self._try_swap(low, high):
                    break
                continue

            # Большая смена и лучшее уменьшение разницы
            candidates.sort(reverse=True)
            _, _, day_idx, shift = candidates[0]
            self._unassign(high, day_idx)
            self._assign(low, day_idx, shift, self._shift_hours(shift))

    def _try_swap(self, low: Engineer, high: Engineer) -> bool:
        """Обмен: high отдаёт более тяжёлую смену, low — более лёгкую."""
        best = None
        for i, shift_h in enumerate(high.shifts):
            if shift_h == ShiftType.OFF:
                continue
            hours_h = self._shift_hours(shift_h)
            for j, shift_l in enumerate(low.shifts):
                if shift_l == ShiftType.OFF:
                    continue
                if i == j:
                    continue
                hours_l = self._shift_hours(shift_l)
                if hours_h <= hours_l:
                    continue
                # После обмена дни i и j у обоих должны быть без соседства
                # Временно снимаем и проверяем
                # high takes j (low's shift), low takes i (high's shift)
                if high.shifts[j] != ShiftType.OFF and j != i:
                    continue
                if low.shifts[i] != ShiftType.OFF and i != j:
                    continue

                # Simulate adjacency: remove both shifts, then place swapped
                saved_h_i, saved_l_j = shift_h, shift_l
                self._unassign(high, i)
                self._unassign(low, j)
                ok = self._can_take(low, i) and self._can_take(high, j)
                # rollback
                self._assign(high, i, saved_h_i, hours_h)
                self._assign(low, j, saved_l_j, hours_l)
                if not ok:
                    continue

                new_high = high.total_hours - hours_h + hours_l
                new_low = low.total_hours - hours_l + hours_h
                new_diff = abs(new_high - new_low)
                old_diff = abs(high.total_hours - low.total_hours)
                if new_diff < old_diff - 0.1:
                    gain = old_diff - new_diff
                    if best is None or gain > best[0]:
                        best = (gain, i, j, saved_h_i, saved_l_j)

        if best is None:
            return False

        _, i, j, shift_h, shift_l = best
        hours_h = self._shift_hours(shift_h)
        hours_l = self._shift_hours(shift_l)
        self._unassign(high, i)
        self._unassign(low, j)
        self._assign(low, i, shift_h, hours_h)
        self._assign(high, j, shift_l, hours_l)
        return True


def last_day_on_duty(engineers: list[Engineer]) -> dict[str, bool]:
    """Кто вышел в последний день месяца."""
    if not engineers:
        return {}
    last = len(engineers[0].shifts) - 1
    return {
        eng.name: eng.shifts[last] != ShiftType.OFF
        for eng in engineers
    }


def generate_linked(
    year: int,
    month: int,
    engineers: list[str],
    calendars: dict[int, ProductionCalendar],
    night_hours: float = 15.0,
    daily_hours: float = 24.0,
    use_holidays: bool = True,
) -> list[Engineer]:
    """
    График месяца с учётом стыка с предыдущими месяцами.
    Цепочка идёт с января самого раннего года, для которого есть календарь,
    чтобы ночь/сутки последнего дня не пересекались со сменой 1-го числа.
    """
    start_year = year
    while (start_year - 1) in calendars:
        start_year -= 1

    prev: dict[str, bool] = {}
    result: list[Engineer] = []
    yy, mm = start_year, 1
    while (yy, mm) <= (year, month):
        gen = ScheduleGenerator(
            year=yy,
            month=mm,
            engineers=engineers,
            prod_calendar=calendars[yy],
            night_hours=night_hours,
            daily_hours=daily_hours,
            use_holidays=use_holidays,
            prev_on_duty=prev,
        )
        result = gen.generate()
        prev = last_day_on_duty(result)
        if mm == 12:
            yy, mm = yy + 1, 1
        else:
            mm += 1
    return result
