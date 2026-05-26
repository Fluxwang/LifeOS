from __future__ import annotations

import sys
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from datetime import date, datetime, timedelta
from html import escape
from pathlib import Path
from typing import Any

DEPS_DIR = Path(__file__).resolve().parents[1] / ".deps"
if DEPS_DIR.exists():
    sys.path.insert(0, str(DEPS_DIR))


if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from backend import calendar_google, calendar_outlook
    from backend.classifier import (
        classify,
        color_for,
        public_rules,
        save_rules,
        load_rules,
    )
    from backend.daily_report import generate_report
    from backend.db import (
        DEFAULT_SETTINGS,
        ROOT_DIR,
        get_connection,
        init_db,
        init_settings,
        load_settings,
        parse_dt,
        patch_settings,
        row_to_dict,
        today_iso,
    )
    from backend.monitor import read_state, write_state
else:
    from . import calendar_google, calendar_outlook
    from .classifier import classify, color_for, public_rules, save_rules, load_rules
    from .daily_report import generate_report
    from .db import (
        DEFAULT_SETTINGS,
        ROOT_DIR,
        get_connection,
        init_db,
        init_settings,
        load_settings,
        parse_dt,
        patch_settings,
        row_to_dict,
        today_iso,
    )
    from .monitor import read_state, write_state

FRONTEND_DIR = ROOT_DIR / "web"


def focus_page():
    return send_from_directory(FRONTEND_DIR, "index.html")


def create_app() -> Flask:
    init_db()
    init_settings()
    app = Flask(__name__, static_folder=None)
    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": ["http://127.0.0.1:5000", "http://localhost:5000", "null"]
            }
        },
    )

    @app.get("/health")
    def health():
        settings = load_settings()
        return jsonify(
            {"status": "ok", "monitor": bool(settings.get("monitor_enabled"))}
        )

    @app.get("/")
    def root():
        return focus_page()

    @app.get("/dashboard")
    def dashboard():
        return focus_page()

    @app.get("/<path:path>")
    def static_files(path: str):
        if (FRONTEND_DIR / path).is_file():
            return send_from_directory(FRONTEND_DIR, path)
        return focus_page()

    @app.post("/api/activity")
    def create_activity():
        payload = request.get_json(force=True, silent=True) or {}
        process = str(payload.get("process") or "unknown")
        title = payload.get("title")
        domain = payload.get("domain")
        duration = float(payload.get("duration") or 0)
        if duration <= 0:
            return jsonify({"error": "duration must be positive"}), 400
        started_at = payload.get("started_at") or datetime.now().isoformat(
            timespec="seconds"
        )
        category = payload.get("category") or classify(process, title, domain)
        with get_connection() as conn:
            cur = conn.execute(
                """
                INSERT INTO activities(process, title, domain, category, source, duration, started_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    process,
                    title,
                    domain,
                    category,
                    payload.get("source") or "system",
                    duration,
                    started_at,
                ),
            )
        write_state(process, title, category, int(duration))
        return jsonify({"id": cur.lastrowid, "category": category})

    @app.get("/api/activity/current")
    def current_activity():
        return jsonify(read_state())

    @app.post("/api/session")
    def create_session():
        payload = request.get_json(force=True, silent=True) or {}
        session_type = payload.get("type")
        if session_type not in {"pomodoro", "free_focus"}:
            return jsonify({"error": "type must be pomodoro or free_focus"}), 400
        actual_seconds = int(payload.get("actual_seconds") or 0)
        if actual_seconds <= 0:
            return jsonify({"error": "actual_seconds must be positive"}), 400
        started = parse_dt(payload.get("started_at"))
        ended = (
            parse_dt(payload.get("ended_at"))
            if payload.get("ended_at")
            else datetime.now()
        )
        completed = 1 if payload.get("completed", True) else 0
        started_iso = started.isoformat(timespec="seconds")
        ended_iso = ended.isoformat(timespec="seconds")
        with get_connection() as conn:
            cur = conn.execute(
                """
                INSERT INTO sessions(type, task_name, planned_minutes, actual_seconds, completed, started_at, ended_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_type,
                    payload.get("task_name"),
                    payload.get("planned_minutes"),
                    actual_seconds,
                    completed,
                    started_iso,
                    ended_iso,
                ),
            )
            session_id = cur.lastrowid
            if completed:
                award_points(
                    conn, session_type, actual_seconds, started.date().isoformat()
                )

        calendar_result = None
        if completed:
            calendar_result = sync_calendar_event(
                session_type=session_type,
                task_name=payload.get("task_name"),
                started_at=started_iso,
                ended_at=ended_iso,
            )
            if calendar_result and calendar_result.get("synced"):
                with get_connection() as conn:
                    conn.execute(
                        """
                        UPDATE sessions
                        SET cal_event_id = ?, cal_provider = ?
                        WHERE id = ?
                        """,
                        (
                            calendar_result.get("cal_event_id"),
                            calendar_result.get("provider"),
                            session_id,
                        ),
                    )

        return jsonify(
            {
                "id": session_id,
                "cal_event_id": (calendar_result or {}).get("cal_event_id"),
                "calendar": calendar_result,
            }
        )

    @app.get("/api/stats/today")
    def today_stats():
        return jsonify(stats_for_day(today_iso()))

    @app.get("/api/stats/apps")
    def apps_stats():
        target = request.args.get("date") or today_iso()
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT process, category, SUM(duration) AS seconds
                FROM activities
                WHERE date(started_at) = ?
                GROUP BY process, category
                ORDER BY seconds DESC
                LIMIT 10
                """,
                (target,),
            ).fetchall()
        return jsonify(
            [
                {
                    "process": r["process"],
                    "category": r["category"],
                    "seconds": int(r["seconds"] or 0),
                }
                for r in rows
            ]
        )

    @app.get("/api/stats/timeline")
    def timeline_stats():
        target = request.args.get("date") or today_iso()
        hours = [{"hour": hour} for hour in range(24)]
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT CAST(strftime('%H', started_at) AS INTEGER) AS hour, category, SUM(duration) AS seconds
                FROM activities
                WHERE date(started_at) = ?
                GROUP BY hour, category
                """,
                (target,),
            ).fetchall()
        for row in rows:
            hours[int(row["hour"])][row["category"]] = int(row["seconds"] or 0)
        return jsonify(hours)

    @app.get("/api/stats/history")
    def history_stats():
        days = max(1, min(int(request.args.get("days", 30)), 366))
        start = (date.today() - timedelta(days=days - 1)).isoformat()
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT date(started_at) AS date,
                       COALESCE(SUM(actual_seconds), 0) AS focus_seconds,
                       SUM(CASE WHEN type = 'pomodoro' AND completed = 1 THEN 1 ELSE 0 END) AS pomodoros
                FROM sessions
                WHERE date(started_at) >= ?
                GROUP BY date(started_at)
                ORDER BY date(started_at)
                """,
                (start,),
            ).fetchall()
        return jsonify(
            [
                {
                    "date": r["date"],
                    "focus_seconds": int(r["focus_seconds"] or 0),
                    "pomodoros": int(r["pomodoros"] or 0),
                }
                for r in rows
            ]
        )

    @app.get("/api/settings")
    def get_settings():
        return jsonify(load_settings())

    @app.patch("/api/settings")
    def update_settings():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            settings = patch_settings(payload)
        except KeyError as exc:
            return jsonify({"error": f"unknown settings key: {exc}"}), 400
        return jsonify(settings)

    @app.get("/api/rules")
    def get_rules():
        return jsonify(public_rules())

    @app.post("/api/rules")
    def add_rule():
        payload = request.get_json(force=True, silent=True) or {}
        if not payload.get("category") or not any(
            payload.get(k) for k in ("domain", "process", "title_contains")
        ):
            return jsonify({"error": "rule requires category and one matcher"}), 400
        data = load_rules()
        data["rules"].append(
            {
                k: payload[k]
                for k in ("id", "domain", "process", "title_contains", "category")
                if k in payload
            }
        )
        save_rules(data)
        return jsonify(public_rules()), 201

    @app.delete("/api/rules/<rule_id>")
    def delete_rule(rule_id: str):
        data = load_rules()
        original = data["rules"]
        data["rules"] = [
            rule
            for idx, rule in enumerate(original)
            if str(rule.get("id", idx)) != str(rule_id)
        ]
        if len(data["rules"]) == len(original):
            return jsonify({"error": "rule not found"}), 404
        save_rules(data)
        return jsonify(public_rules())

    @app.get("/api/report/latest")
    def latest_report():
        with get_connection() as conn:
            row = conn.execute(
                "SELECT date, content FROM daily_reports ORDER BY date DESC LIMIT 1"
            ).fetchone()
        return jsonify(row_to_dict(row) or {"date": None, "content": ""})

    @app.post("/api/report/generate")
    def report_generate():
        payload = request.get_json(silent=True) or {}
        return jsonify(generate_report(payload.get("date")))

    @app.get("/api/calendar/status")
    def calendar_status():
        return jsonify(
            {"google": calendar_google.status(), "outlook": calendar_outlook.status()}
        )

    register_calendar_routes(app, "google", calendar_google)
    register_calendar_routes(app, "outlook", calendar_outlook)
    return app


def award_points(conn, session_type: str, actual_seconds: int, day: str) -> None:
    if session_type == "pomodoro":
        add_point(conn, "完成番茄", 10)
    elif session_type == "free_focus" and actual_seconds >= 1800:
        add_point(conn, "完成自由专注", 15)

    settings = load_settings()
    goal = int(
        settings.get("daily_goal_pomodoros") or DEFAULT_SETTINGS["daily_goal_pomodoros"]
    )
    pomodoros = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM sessions
        WHERE type = 'pomodoro' AND completed = 1 AND date(started_at) = ?
        """,
        (day,),
    ).fetchone()["count"]
    if pomodoros >= goal:
        add_point_once(conn, day, "当日完成目标番茄数", 30)
        streak = completed_goal_streak(conn, goal, day)
        if streak >= 3:
            add_point_once(conn, day, "连续3天达标", 50)
        if streak >= 7:
            add_point_once(conn, day, "连续7天达标", 100)


def add_point(conn, reason: str, delta: int) -> None:
    conn.execute("INSERT INTO points(reason, delta) VALUES (?, ?)", (reason, delta))


def add_point_once(conn, day: str, reason: str, delta: int) -> None:
    exists = conn.execute(
        "SELECT 1 FROM points WHERE reason = ? AND date(created_at) = ? LIMIT 1",
        (reason, day),
    ).fetchone()
    if not exists:
        add_point(conn, reason, delta)


def completed_goal_streak(conn, goal: int, end_day: str) -> int:
    current = date.fromisoformat(end_day)
    streak = 0
    while True:
        count = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM sessions
            WHERE type = 'pomodoro' AND completed = 1 AND date(started_at) = ?
            """,
            (current.isoformat(),),
        ).fetchone()["count"]
        if count < goal:
            break
        streak += 1
        current -= timedelta(days=1)
    return streak


def sync_calendar_event(
    *, session_type: str, task_name: str | None, started_at: str, ended_at: str
) -> dict[str, Any] | None:
    settings = load_settings()
    provider = settings.get("calendar_provider")
    if provider not in {"google", "outlook"}:
        return None
    if session_type == "pomodoro" and not settings.get("calendar_sync_pomodoro"):
        return None
    if session_type == "free_focus" and not settings.get("calendar_sync_free_focus"):
        return None

    module = calendar_google if provider == "google" else calendar_outlook
    return module.create_event(
        task_name=task_name if settings.get("calendar_include_task_name") else None,
        session_type=session_type,
        started_at=started_at,
        ended_at=ended_at,
    )


def stats_for_day(day: str) -> dict[str, Any]:
    settings = load_settings()
    with get_connection() as conn:
        categories = {
            row["category"]: int(row["seconds"] or 0)
            for row in conn.execute(
                """
                SELECT category, SUM(duration) AS seconds
                FROM activities
                WHERE date(started_at) = ?
                GROUP BY category
                """,
                (day,),
            ).fetchall()
        }
        row = conn.execute(
            """
            SELECT
              SUM(CASE WHEN type = 'pomodoro' AND completed = 1 THEN 1 ELSE 0 END) AS pomodoros_done,
              SUM(CASE WHEN type = 'free_focus' AND completed = 1 THEN 1 ELSE 0 END) AS free_focus_count,
              SUM(CASE WHEN type = 'free_focus' THEN actual_seconds ELSE 0 END) AS free_focus_seconds,
              COALESCE(SUM(actual_seconds), 0) AS total_focus_seconds
            FROM sessions
            WHERE date(started_at) = ?
            """,
            (day,),
        ).fetchone()
        points = conn.execute(
            "SELECT COALESCE(SUM(delta), 0) AS total FROM points WHERE date(created_at) = ?",
            (day,),
        ).fetchone()["total"]
    return {
        "date": day,
        "categories": categories,
        "pomodoros_done": int(row["pomodoros_done"] or 0),
        "pomodoros_goal": int(
            settings.get("daily_goal_pomodoros")
            or DEFAULT_SETTINGS["daily_goal_pomodoros"]
        ),
        "free_focus_count": int(row["free_focus_count"] or 0),
        "free_focus_seconds": int(row["free_focus_seconds"] or 0),
        "total_focus_seconds": int(row["total_focus_seconds"] or 0),
        "points_today": int(points or 0),
    }


def register_calendar_routes(app: Flask, provider: str, module) -> None:
    app.add_url_rule(
        f"/api/calendar/{provider}/auth-url",
        f"{provider}_auth_url",
        lambda module=module: jsonify(module.auth_url()),
    )

    def callback(module=module, provider=provider):
        payload = (
            request.args.to_dict(flat=True)
            if request.method == "GET"
            else request.get_json(silent=True) or {}
        )
        result = module.callback(payload)
        if result.get("connected"):
            patch_settings({"calendar_provider": provider})
        if request.method == "GET":
            return calendar_callback_page(provider, result)
        return jsonify(result)

    def disconnect(module=module, provider=provider):
        result = module.disconnect()
        settings = load_settings()
        if settings.get("calendar_provider") == provider:
            fallback = None
            if provider != "google" and calendar_google.status().get("connected"):
                fallback = "google"
            elif provider != "outlook" and calendar_outlook.status().get("connected"):
                fallback = "outlook"
            patch_settings({"calendar_provider": fallback})
        return jsonify(result)

    app.add_url_rule(
        f"/api/calendar/{provider}/callback",
        f"{provider}_callback",
        callback,
        methods=["GET", "POST"],
    )
    app.add_url_rule(
        f"/api/calendar/{provider}/disconnect",
        f"{provider}_disconnect",
        disconnect,
        methods=["POST"],
    )


def calendar_callback_page(provider: str, result: dict[str, Any]) -> str:
    title = "Calendar Connected" if result.get("connected") else "Calendar Error"
    message = result.get("message") or (
        f"{provider.title()} Calendar connected."
        if result.get("connected")
        else f"{provider.title()} Calendar connection failed."
    )
    return f"""
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{escape(title)}</title>
    <style>
      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #101214;
        color: #f4f4f5;
      }}
      main {{
        width: min(420px, calc(100vw - 32px));
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 8px;
        padding: 24px;
        background: #181b1f;
      }}
      a {{ color: #7dd3fc; }}
    </style>
  </head>
  <body>
    <main>
      <h1>{escape(title)}</h1>
      <p>{escape(str(message))}</p>
      <p><a href="/dashboard">返回 LifeOS Focus</a></p>
    </main>
    <script>
      setTimeout(function () {{ window.location.href = "/dashboard"; }}, 1200);
    </script>
  </body>
</html>
"""


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
