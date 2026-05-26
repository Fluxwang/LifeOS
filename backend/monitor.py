from __future__ import annotations

import json
import platform
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from backend.classifier import classify, color_for
    from backend.db import DATA_DIR, get_connection, init_db, load_settings
else:
    from .classifier import classify, color_for
    from .db import DATA_DIR, get_connection, init_db, load_settings

STATE_PATH = DATA_DIR / "current_activity.json"


def write_state(process: str | None, title: str | None, category: str = "其他", seconds: int = 0) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "process": process,
        "title": title,
        "category": category,
        "color": color_for(category),
        "seconds": seconds,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    STATE_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def read_state(max_age_seconds: int = 15) -> dict:
    fallback = {"process": None, "title": None, "category": "其他", "color": color_for("其他"), "seconds": 0}
    if not STATE_PATH.exists():
        return fallback
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        updated = datetime.fromisoformat(data.get("updated_at"))
    except Exception:
        return fallback
    if datetime.now() - updated > timedelta(seconds=max_age_seconds):
        return fallback
    return {
        "process": data.get("process"),
        "title": data.get("title"),
        "category": data.get("category") or "其他",
        "color": data.get("color") or color_for(data.get("category") or "其他"),
        "seconds": int(data.get("seconds") or 0),
    }


def get_active_window() -> tuple[str, str]:
    if platform.system() != "Windows":
        raise RuntimeError("System activity monitor is only available on Windows.")
    import psutil  # type: ignore
    import win32gui  # type: ignore
    import win32process  # type: ignore

    hwnd = win32gui.GetForegroundWindow()
    title = win32gui.GetWindowText(hwnd)
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    try:
        process_name = psutil.Process(pid).name()
    except Exception:
        process_name = "unknown"
    return process_name, title


def get_idle_seconds() -> float:
    if platform.system() != "Windows":
        return 0.0
    import ctypes

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

    lii = LASTINPUTINFO()
    lii.cbSize = ctypes.sizeof(lii)
    ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii))
    return (ctypes.windll.kernel32.GetTickCount() - lii.dwTime) / 1000.0


def persist_activity(process: str, title: str, duration: float, started_at: datetime) -> None:
    if duration <= 0:
        return
    category = classify(process, title)
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO activities(process, title, domain, category, source, duration, started_at)
            VALUES (?, ?, NULL, ?, 'system', ?, ?)
            """,
            (process, title, category, duration, started_at.isoformat(timespec="seconds")),
        )


def run() -> None:
    init_db()
    settings = load_settings()
    if not settings.get("monitor_enabled", True):
        write_state(None, "monitor disabled", "其他", 0)
        return
    if platform.system() != "Windows":
        write_state(None, "monitor unavailable on this OS", "其他", 0)
        print("LifeOS monitor: Windows-only activity sampling is unavailable on this OS.")
        while True:
            time.sleep(30)

    current: Optional[tuple[str, str]] = None
    started_at = datetime.now()
    last_tick = started_at
    accumulated = 0.0

    while True:
        settings = load_settings()
        interval = max(1, int(settings.get("monitor_interval_seconds") or 3))
        idle_threshold = max(30, int(settings.get("idle_threshold_seconds") or 300))
        try:
            idle_seconds = get_idle_seconds()
            if idle_seconds >= idle_threshold:
                if current and accumulated > 0:
                    persist_activity(current[0], current[1], accumulated, started_at)
                current = None
                accumulated = 0
                write_state(None, "idle", "其他", 0)
                time.sleep(interval)
                continue

            process, title = get_active_window()
            now = datetime.now()
            if current is None:
                current = (process, title)
                started_at = now
                last_tick = now
                accumulated = 0
            elif current == (process, title):
                accumulated += (now - last_tick).total_seconds()
                last_tick = now
            else:
                persist_activity(current[0], current[1], accumulated, started_at)
                current = (process, title)
                started_at = now
                last_tick = now
                accumulated = 0

            category = classify(process, title)
            write_state(process, title, category, int(accumulated))
        except KeyboardInterrupt:
            if current and accumulated > 0:
                persist_activity(current[0], current[1], accumulated, started_at)
            raise
        except Exception as exc:
            write_state(None, f"monitor error: {exc}", "其他", 0)
        time.sleep(interval)


if __name__ == "__main__":
    run()
