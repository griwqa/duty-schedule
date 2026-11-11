from dataclasses import dataclass, field
from datetime import date
from enum import Enum

ROLE_DUTY = "duty"
ROLE_FIVE_DAY = "five_day"
ROLE_EXTRA = "extra"


class ShiftType(Enum):
    NIGHT = "Н"      # 19:00 – 10:00 (15 ч)
    DAILY = "С"      # 10:00 – 10:00 (24 ч)
    OFF = ""         # выходной
    HOLIDAY = "П"    # праздничная смена
    MORNING = "У"    # утро (доп. инженер)
    DAY = "Д"        # день (доп. инженер)
    EVENING = "В"    # вечер (доп. инженер)
    OFFICE = "о"     # офис (5-дневный график)
    REMOTE = "у"     # удалёнка (5-дневный график)
    TRIP = "в"       # выезд (5-дневный график)


@dataclass
class Shift:
    shift_type: ShiftType
    hours: float = 0.0


@dataclass
class Day:
    date: date
    is_weekend: bool = False
    is_holiday: bool = False
    is_short: bool = False   # сокращённый день


@dataclass
class Engineer:
    name: str
    shifts: list = field(default_factory=list)
    total_hours: float = 0.0
    night_count: int = 0
    daily_count: int = 0
    holiday_count: int = 0
    office_count: int = 0
    remote_count: int = 0
    trip_count: int = 0
    role: str = ROLE_DUTY
    position: str = ""

    @property
    def is_extra(self) -> bool:
        return self.role == ROLE_EXTRA

    @property
    def five_day_count(self) -> int:
        return self.office_count + self.remote_count + self.trip_count

    def recalculate(
        self,
        night_hours: float,
        daily_hours: float,
        workday_hours: float = 8.0,
    ):
        """Пересчитать статистику из списка смен (после ручных правок)."""
        self.total_hours = 0.0
        self.night_count = 0
        self.daily_count = 0
        self.holiday_count = 0
        self.office_count = 0
        self.remote_count = 0
        self.trip_count = 0
        for shift in self.shifts:
            if shift == ShiftType.NIGHT:
                self.night_count += 1
                self.total_hours += night_hours
            elif shift == ShiftType.DAILY:
                self.daily_count += 1
                self.total_hours += daily_hours
            elif shift == ShiftType.HOLIDAY:
                self.holiday_count += 1
                self.total_hours += daily_hours
            elif shift == ShiftType.OFFICE:
                self.office_count += 1
                self.total_hours += workday_hours
            elif shift == ShiftType.REMOTE:
                self.remote_count += 1
                self.total_hours += workday_hours
            elif shift == ShiftType.TRIP:
                self.trip_count += 1
                self.total_hours += workday_hours

