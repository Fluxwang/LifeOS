from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))


def user_data_dir() -> Path:
    override = os.environ.get("LIFEOS_USER_DIR")
    if override:
        return Path(override)
    if not getattr(sys, "frozen", False):
        return ROOT_DIR
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "LifeOS Focus"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "LifeOS Focus"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "lifeos-focus"


USER_DIR = user_data_dir()
DATA_DIR = USER_DIR / "data"
CONFIG_DIR = USER_DIR / "config"
DB_PATH = DATA_DIR / "lifeos.db"
SETTINGS_PATH = CONFIG_DIR / "settings.json"

DEFAULT_SETTINGS: dict[str, Any] = {
    "pomodoro_minutes": 25,
    "short_break_minutes": 5,
    "long_break_minutes": 15,
    "long_break_after": 4,
    "daily_goal_pomodoros": 8,
    "free_focus_reminder_minutes": 90,
    "notify_pomodoro_end": True,
    "notify_break_end": True,
    "monitor_enabled": True,
    "monitor_interval_seconds": 3,
    "idle_threshold_seconds": 300,
    "data_retention_days": 90,
    "calendar_provider": None,
    "calendar_sync_pomodoro": True,
    "calendar_sync_free_focus": True,
    "calendar_sync_break": False,
    "calendar_include_task_name": True,
    "window_topmost": False,
    "theme": "dark",
}


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback) -> bool:
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def init_settings() -> dict[str, Any]:
    ensure_dirs()
    if not SETTINGS_PATH.exists():
        save_settings(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS.copy()
    return load_settings()


def load_settings() -> dict[str, Any]:
    ensure_dirs()
    if not SETTINGS_PATH.exists():
        return init_settings()
    with SETTINGS_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    merged = DEFAULT_SETTINGS.copy()
    merged.update({k: v for k, v in data.items() if k in DEFAULT_SETTINGS})
    if merged != data:
        save_settings(merged)
    return merged


def save_settings(settings: dict[str, Any]) -> None:
    ensure_dirs()
    with SETTINGS_PATH.open("w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
        f.write("\n")


def patch_settings(changes: dict[str, Any]) -> dict[str, Any]:
    unknown = sorted(set(changes) - set(DEFAULT_SETTINGS))
    if unknown:
        raise KeyError(", ".join(unknown))
    settings = load_settings()
    settings.update(changes)
    save_settings(settings)
    return settings


def get_connection(path: Path | None = None) -> sqlite3.Connection:
    ensure_dirs()
    conn = sqlite3.connect(path or DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES, factory=ClosingConnection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path: Path | None = None) -> None:
    ensure_dirs()
    with get_connection(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS activities (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                process     TEXT NOT NULL,
                title       TEXT,
                domain      TEXT,
                category    TEXT NOT NULL,
                source      TEXT DEFAULT 'system',
                duration    REAL NOT NULL,
                started_at  DATETIME NOT NULL,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                type            TEXT NOT NULL,
                task_name       TEXT,
                planned_minutes INTEGER,
                actual_seconds  INTEGER NOT NULL,
                completed       INTEGER DEFAULT 1,
                cal_event_id    TEXT,
                cal_provider    TEXT,
                started_at      DATETIME NOT NULL,
                ended_at        DATETIME NOT NULL,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS goals (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                date            DATE NOT NULL,
                category        TEXT NOT NULL,
                target_minutes  INTEGER NOT NULL,
                UNIQUE(date, category)
            );

            CREATE TABLE IF NOT EXISTS points (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                reason      TEXT NOT NULL,
                delta       INTEGER NOT NULL,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS daily_reports (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                date        DATE NOT NULL UNIQUE,
                content     TEXT NOT NULL,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date(started_at));
            CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date(started_at));
            CREATE INDEX IF NOT EXISTS idx_points_date ON points(date(created_at));
            """
        )


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def parse_dt(value: str | None) -> datetime:
    if not value:
        return datetime.now()
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)


def today_iso() -> str:
    return date.today().isoformat()


def date_range(days: int) -> list[str]:
    start = date.today() - timedelta(days=max(days - 1, 0))
    return [(start + timedelta(days=i)).isoformat() for i in range(days)]
