import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from core.models import ShiftType
from core.production_calendar import ProductionCalendar
from core.rotation import (
    generate_rotation,
    make_extra_engineers,
    make_five_day_engineers,
    validate_schedule,
)
from core.schedule_generator import generate_linked

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"


def load_calendar(year: int) -> ProductionCalendar:
    calendar = ProductionCalendar()
    calendar.load_from_json(str(DATA / f"calendar_{year}.json"))
    return calendar


def parse_calendar(year: int) -> dict:
    with open(DATA / f"calendar_{year}.json", encoding="utf-8") as handle:
        return json.load(handle)


def dump(engineers) -> list[dict]:
    return [
        {
            "name": engineer.name,
            "role": engineer.role,
            "shifts": [shift.value for shift in engineer.shifts],
            "total": engineer.total_hours,
        }
        for engineer in engineers
    ]


def main():
    cal2026 = load_calendar(2026)
    cal2027 = load_calendar(2027)
    names = ["Инженер A", "Инженер B", "Инженер C", "Инженер D"]
    reference = {"calendars": {2026: parse_calendar(2026), 2027: parse_calendar(2027)}}

    rotation = generate_rotation(
        2026, 11, names, date(2026, 11, 1), cal2026, True, 24.0
    )
    reference["rotation_2026_11"] = dump(rotation)

    rotation_no_holidays = generate_rotation(
        2026, 11, names, date(2026, 11, 1), cal2026, False, 24.0
    )
    reference["rotation_holidays_off"] = dump(rotation_no_holidays)

    rotation_2027 = generate_rotation(
        2027, 1, names, date(2026, 11, 1), cal2027, True, 24.0
    )
    reference["rotation_2027_01"] = dump(rotation_2027)

    night = generate_linked(
        2026, 11, names, {2026: cal2026, 2027: cal2027}, 15.0, 24.0, True
    )
    reference["night_2026_11"] = dump(night)

    night_jan = generate_linked(
        2027, 1, names, {2026: cal2026, 2027: cal2027}, 15.0, 24.0, True
    )
    reference["night_2027_01"] = dump(night_jan)

    night_march = generate_linked(
        2026, 3, names[:3], {2026: cal2026}, 15.0, 24.0, True
    )
    reference["night_2026_03_three"] = dump(night_march)

    five = make_five_day_engineers(
        [
            type("Member", (), {"name": "Сотрудник A", "position": "Ведущий"}),
            type("Member", (), {"name": "Сотрудник B", "position": ""}),
        ],
        2027,
        2,
        cal2027,
        8.0,
    )
    reference["five_day_2027_02"] = dump(five)

    extras = make_extra_engineers(["Доп. инженер A", "Доп. инженер B"], 2026, 11)
    reference["extra_2026_11"] = dump(extras)

    reference["norm_2026_11"] = cal2026.get_norm_hours(2026, 11)
    reference["norm_2027_02"] = cal2027.get_norm_hours(2027, 2)

    broken = generate_rotation(
        2026, 11, names, date(2026, 11, 1), cal2026, True, 24.0
    )
    broken[0].shifts[1] = ShiftType.DAILY
    broken[0].shifts[2] = ShiftType.DAILY
    broken[0].recalculate(24.0, 24.0)
    issues, issue_days = validate_schedule(broken)
    reference["validation"] = {
        "issues": issues,
        "days": sorted(issue_days),
    }

    with open(Path(__file__).with_name("reference.json"), "w", encoding="utf-8") as handle:
        json.dump(reference, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
