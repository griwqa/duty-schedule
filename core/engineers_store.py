import json
from dataclasses import dataclass
from pathlib import Path

from core.models import ROLE_DUTY, ROLE_EXTRA, ROLE_FIVE_DAY

DEFAULT_NAMES = ["Инженер A", "Инженер B", "Инженер C"]
STORE_PATH = Path(__file__).resolve().parent.parent / "data" / "engineers.json"

ROLES = (ROLE_DUTY, ROLE_FIVE_DAY, ROLE_EXTRA)
ROLE_TITLES = {
    ROLE_DUTY: "Суточник (1/3)",
    ROLE_FIVE_DAY: "5-дневный график",
    ROLE_EXTRA: "Доп. инженер (подмена)",
}
ROLE_PREFIXES = {
    ROLE_DUTY: "Инженер",
    ROLE_FIVE_DAY: "Сотрудник",
    ROLE_EXTRA: "Доп. инженер",
}


@dataclass
class StaffMember:
    name: str
    role: str = ROLE_DUTY
    position: str = ""


def _letter(index: int) -> str:
    return chr(65 + index) if index < 26 else str(index + 1)


def _default_name(
    role: str,
    members: list[StaffMember],
    all_members: list[StaffMember],
) -> str:
    prefix = ROLE_PREFIXES[role]
    used = {m.name for m in all_members}
    index = len(members)
    while f"{prefix} {_letter(index)}" in used:
        index += 1
    return f"{prefix} {_letter(index)}"


def _clean(member: StaffMember) -> StaffMember:
    role = member.role if member.role in ROLES else ROLE_DUTY
    name = str(member.name).strip()
    position = str(member.position).strip()
    if not name:
        name = ROLE_PREFIXES[role] + " A"
    return StaffMember(name=name, role=role, position=position)


def load_staff(path: Path | None = None) -> list[StaffMember]:
    store = path or STORE_PATH
    if not store.exists():
        staff = [StaffMember(name=n) for n in DEFAULT_NAMES]
        save_staff(staff, store)
        return staff
    try:
        with open(store, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError, TypeError):
        return [StaffMember(name=n) for n in DEFAULT_NAMES]

    if isinstance(data.get("engineers"), list):
        staff = []
        for item in data["engineers"]:
            if not isinstance(item, dict):
                continue
            staff.append(
                _clean(
                    StaffMember(
                        name=item.get("name", ""),
                        role=item.get("role", ROLE_DUTY),
                        position=item.get("position", ""),
                    )
                )
            )
        if staff:
            return staff
        return [StaffMember(name=n) for n in DEFAULT_NAMES]

    # Старый формат: {"names": [...], "extra": [...]}
    names = data.get("names", [])
    extra = data.get("extra", [])
    staff = []
    if isinstance(names, list):
        staff.extend(_clean(StaffMember(name=n)) for n in names)
    if isinstance(extra, list):
        staff.extend(
            _clean(StaffMember(name=n, role=ROLE_EXTRA)) for n in extra
        )
    return staff or [StaffMember(name=n) for n in DEFAULT_NAMES]


def save_staff(staff: list[StaffMember], path: Path | None = None) -> None:
    target = path or STORE_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "engineers": [
            {"name": m.name, "role": m.role, "position": m.position}
            for m in staff
        ]
    }
    with open(target, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def ensure_role_count(
    staff: list[StaffMember], role: str, count: int
) -> list[StaffMember]:
    """Дополнить или обрезать число сотрудников указанной роли."""
    members = [m for m in staff if m.role == role]
    result = list(staff)
    if len(members) > count:
        keep = {id(m) for m in members[:count]}
        result = [
            m for m in result if m.role != role or id(m) in keep
        ]
        members = members[:count]
    while len(members) < count:
        member = StaffMember(
            name=_default_name(role, members, result), role=role
        )
        result.append(member)
        members.append(member)
    return result


def count_role(staff: list[StaffMember], role: str) -> int:
    return sum(1 for m in staff if m.role == role)
