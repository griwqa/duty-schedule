import calendar as cal
import json
from datetime import date

from core.models import Day


class ProductionCalendar:
    """
    Производственный календарь.
    Поддерживает загрузку из JSON или ручное заполнение.
    """

    def __init__(self):
        self.days: dict[date, Day] = {}

    def load_from_json(self, path: str):
        """Загрузка из JSON: {'2026-10-01': {'weekend': False, 'holiday': False}}"""
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.load_from_dict(data)

    def load_from_dict(self, data: dict):
        """Ручное заполнение из словаря."""
        for iso_date, info in data.items():
            d = date.fromisoformat(iso_date)
            self.days[d] = Day(
                date=d,
                is_weekend=info.get("weekend", False),
                is_holiday=info.get("holiday", False),
                is_short=info.get("short", False),
            )

    def fill_month_weekends(self, year: int, month: int):
        """Заполнить месяц: сб/вс — выходные, без праздников."""
        _, days_in_month = cal.monthrange(year, month)
        data = {}
        for day_num in range(1, days_in_month + 1):
            d = date(year, month, day_num)
            data[d.isoformat()] = {
                "weekend": d.weekday() >= 5,
                "holiday": False,
                "short": False,
            }
        self.load_from_dict(data)

    def is_holiday(self, d: date) -> bool:
        return self.days.get(d, Day(d)).is_holiday

    def is_weekend(self, d: date) -> bool:
        day = self.days.get(d)
        if day is not None:
            return day.is_weekend
        return d.weekday() >= 5

    def is_short(self, d: date) -> bool:
        return self.days.get(d, Day(d)).is_short

    def get_norm_hours(self, year: int, month: int) -> float:
        """Норма часов за месяц (упрощённо: 40 ч/нед)."""
        _, days_in_month = cal.monthrange(year, month)
        norm = 0.0
        for day_num in range(1, days_in_month + 1):
            d = date(year, month, day_num)
            if self.is_weekend(d) or self.is_holiday(d):
                continue
            norm += 8.0
            if self.is_short(d):
                norm -= 1.0
        return norm
