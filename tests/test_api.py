from __future__ import annotations

import atexit
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

_TEST_USER_DIR = tempfile.TemporaryDirectory()
atexit.register(_TEST_USER_DIR.cleanup)
os.environ["LIFEOS_USER_DIR"] = _TEST_USER_DIR.name

from backend.app import create_app
from backend.db import get_connection, init_db, save_settings, DEFAULT_SETTINGS


class ApiTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self._reset_state()
        self.client = create_app().test_client()

    def tearDown(self) -> None:
        self._reset_state()

    def _reset_state(self) -> None:
        save_settings(DEFAULT_SETTINGS.copy())
        with get_connection() as conn:
            for table in ("activities", "sessions", "points", "daily_reports", "goals"):
                conn.execute(f"DELETE FROM {table}")

    def test_health(self) -> None:
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["status"], "ok")

    def test_dashboard_serves_real_web_entry(self) -> None:
        res = self.client.get("/dashboard")
        try:
            self.assertEqual(res.status_code, 200)
            text = res.get_data(as_text=True)
            self.assertIn('<div id="root"></div>', text)
            self.assertIn('/app.js', text)
            self.assertNotIn("__bundler_loading", text)
        finally:
            res.close()

    def test_settings_patch_rejects_unknown_keys(self) -> None:
        res = self.client.patch("/api/settings", json={"pomodoro_minutes": 30})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["pomodoro_minutes"], 30)

        bad = self.client.patch("/api/settings", json={"unknown": True})
        self.assertEqual(bad.status_code, 400)

    def test_activity_classification_and_stats(self) -> None:
        now = datetime.now().isoformat(timespec="seconds")
        res = self.client.post(
            "/api/activity",
            json={"process": "chrome.exe", "domain": "github.com", "title": "repo", "duration": 120, "started_at": now},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["category"], "编程")

        stats = self.client.get("/api/stats/today").get_json()
        self.assertEqual(stats["categories"]["编程"], 120)

    def test_session_points_and_history(self) -> None:
        started = datetime.now() - timedelta(minutes=25)
        ended = datetime.now()
        res = self.client.post(
            "/api/session",
            json={
                "type": "pomodoro",
                "task_name": "写代码",
                "planned_minutes": 25,
                "actual_seconds": 1500,
                "completed": True,
                "started_at": started.isoformat(),
                "ended_at": ended.isoformat(),
            },
        )
        self.assertEqual(res.status_code, 200)
        stats = self.client.get("/api/stats/today").get_json()
        self.assertEqual(stats["pomodoros_done"], 1)
        self.assertEqual(stats["points_today"], 10)

        history = self.client.get("/api/stats/history?days=1").get_json()
        self.assertEqual(history[0]["pomodoros"], 1)

    def test_completed_session_syncs_selected_calendar(self) -> None:
        settings = DEFAULT_SETTINGS.copy()
        settings["calendar_provider"] = "google"
        save_settings(settings)
        started = datetime.now() - timedelta(minutes=25)
        ended = datetime.now()

        with patch("backend.app.calendar_google.create_event") as create_event:
            create_event.return_value = {
                "cal_event_id": "calendar-event-1",
                "provider": "google",
                "synced": True,
            }
            res = self.client.post(
                "/api/session",
                json={
                    "type": "pomodoro",
                    "task_name": "写代码",
                    "planned_minutes": 25,
                    "actual_seconds": 1500,
                    "completed": True,
                    "started_at": started.isoformat(),
                    "ended_at": ended.isoformat(),
                },
            )

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["cal_event_id"], "calendar-event-1")
        with get_connection() as conn:
            row = conn.execute(
                "SELECT cal_event_id, cal_provider FROM sessions ORDER BY id DESC LIMIT 1"
            ).fetchone()
        self.assertEqual(row["cal_event_id"], "calendar-event-1")
        self.assertEqual(row["cal_provider"], "google")


if __name__ == "__main__":
    unittest.main()
