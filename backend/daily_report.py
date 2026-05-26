from __future__ import annotations

from datetime import date

from .db import get_connection


def build_report_data(report_date: str | None = None) -> dict:
    target = report_date or date.today().isoformat()
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
                (target,),
            )
        }
        row = conn.execute(
            """
            SELECT
              COALESCE(SUM(actual_seconds), 0) AS focus_seconds,
              SUM(CASE WHEN type = 'pomodoro' AND completed = 1 THEN 1 ELSE 0 END) AS pomodoros,
              SUM(CASE WHEN type = 'free_focus' AND completed = 1 THEN 1 ELSE 0 END) AS free_focus_sessions
            FROM sessions
            WHERE date(started_at) = ?
            """,
            (target,),
        ).fetchone()
        apps = [
            r["process"]
            for r in conn.execute(
                """
                SELECT process, SUM(duration) AS seconds
                FROM activities
                WHERE date(started_at) = ?
                GROUP BY process
                ORDER BY seconds DESC
                LIMIT 5
                """,
                (target,),
            )
        ]
    return {
        "date": target,
        "total_focus_minutes": round((row["focus_seconds"] or 0) / 60),
        "categories": {k: round(v / 60) for k, v in categories.items()},
        "pomodoros": int(row["pomodoros"] or 0),
        "top_apps": apps,
        "free_focus_sessions": int(row["free_focus_sessions"] or 0),
    }


def generate_report(report_date: str | None = None) -> dict:
    data = build_report_data(report_date)
    category_text = "、".join(f"{k}{v}分钟" for k, v in data["categories"].items()) or "暂无系统活动记录"
    app_text = "、".join(data["top_apps"]) or "暂无"
    content = (
        f"今日专注 {data['total_focus_minutes']} 分钟，完成 {data['pomodoros']} 个番茄。"
        f"时间分配：{category_text}。常用应用：{app_text}。"
        "建议明天先安排一个明确任务名，再开始第一轮专注。"
    )
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO daily_reports(date, content)
            VALUES (?, ?)
            ON CONFLICT(date) DO UPDATE SET content = excluded.content, created_at = CURRENT_TIMESTAMP
            """,
            (data["date"], content),
        )
    return {"date": data["date"], "content": content}
