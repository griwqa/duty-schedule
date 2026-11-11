import json
from datetime import date
from pathlib import Path

STORE_PATH = Path(__file__).resolve().parent.parent / "data" / "settings.json"

DEFAULT_MODE = "rotation"


def load_settings(path: Path | None = None) -> dict:
    store = path or STORE_PATH
    defaults = {
        "mode": DEFAULT_MODE,
        "anchor": date.today().replace(day=1).isoformat(),
    }
    if not store.exists():
        return defaults
    try:
        with open(store, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return defaults

    mode = data.get("mode")
    if mode not in ("rotation", "night_weekend"):
        mode = defaults["mode"]
    anchor = data.get("anchor")
    try:
        date.fromisoformat(str(anchor))
    except (TypeError, ValueError):
        anchor = defaults["anchor"]
    return {"mode": mode, "anchor": anchor}


def save_settings(settings: dict, path: Path | None = None) -> None:
    store = path or STORE_PATH
    store.parent.mkdir(parents=True, exist_ok=True)
    with open(store, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
