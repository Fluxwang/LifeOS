from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.auth.exceptions import GoogleAuthError, RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .db import CONFIG_DIR, ensure_dirs

TOKEN_PATH = CONFIG_DIR / "google_token.json"
CREDENTIALS_PATH = CONFIG_DIR / "google_credentials.json"
AUTH_STATE_PATH = CONFIG_DIR / "google_auth_state.json"
SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
REDIRECT_URI = os.environ.get(
    "LIFEOS_GOOGLE_REDIRECT_URI",
    "http://127.0.0.1:5000/api/calendar/google/callback",
)
TIMEZONE = os.environ.get("LIFEOS_CALENDAR_TIMEZONE", "UTC")


def status() -> dict:
    creds = _load_credentials(refresh=True)
    if not creds:
        return {
            "connected": False,
            "email": None,
            "configured": _client_config() is not None,
        }
    return {
        "connected": True,
        "email": _stored_email() or "Google Calendar",
        "configured": True,
    }


def auth_url() -> dict:
    flow = _build_flow()
    if not flow:
        return {
            "configured": False,
            "url": None,
            "message": (
                "Google OAuth credentials are not configured. Add "
                "config/google_credentials.json or set GOOGLE_CLIENT_ID and "
                "GOOGLE_CLIENT_SECRET."
            ),
        }

    ensure_dirs()
    state = secrets.token_urlsafe(24)
    flow = _build_flow(state=state)
    if not flow:
        return {"configured": False, "url": None}
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    _write_json(
        AUTH_STATE_PATH,
        {"state": state, "created_at": datetime.now(timezone.utc).isoformat()},
    )
    return {"configured": True, "url": url}


def callback(payload: dict) -> dict:
    if payload.get("error"):
        return {
            "connected": False,
            "message": payload.get("error_description") or payload.get("error"),
        }

    code = payload.get("code")
    if not code:
        return {"connected": False, "message": "Google OAuth callback missing code."}

    if not _state_matches(payload.get("state")):
        return {"connected": False, "message": "Google OAuth state mismatch."}

    flow = _build_flow(state=payload.get("state"))
    if not flow:
        return {"connected": False, "message": "Google OAuth credentials are missing."}

    try:
        flow.fetch_token(code=code)
    except Exception as exc:  # google-auth-oauthlib wraps several OAuth failures.
        return {"connected": False, "message": f"Google OAuth failed: {exc}"}

    _save_credentials(flow.credentials)
    _delete_file(AUTH_STATE_PATH)
    return {**status(), "message": "Google Calendar connected."}


def disconnect() -> dict:
    _delete_file(TOKEN_PATH)
    _delete_file(AUTH_STATE_PATH)
    return {"connected": False}


def create_event(
    *, task_name: str | None, session_type: str, started_at: str, ended_at: str
) -> dict:
    creds = _load_credentials(refresh=True)
    if not creds:
        return {
            "cal_event_id": None,
            "provider": "google",
            "synced": False,
            "message": "Google Calendar is not connected.",
        }

    event = {
        "summary": _event_summary(task_name, session_type),
        "description": "Created by LifeOS Focus.",
        "start": {"dateTime": _event_time(started_at), "timeZone": TIMEZONE},
        "end": {"dateTime": _event_time(ended_at), "timeZone": TIMEZONE},
    }
    try:
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        created = (
            service.events()
            .insert(calendarId="primary", body=event)
            .execute()
        )
    except (GoogleAuthError, HttpError, OSError) as exc:
        return {
            "cal_event_id": None,
            "provider": "google",
            "synced": False,
            "message": f"Google Calendar sync failed: {exc}",
        }

    return {
        "cal_event_id": created.get("id"),
        "provider": "google",
        "synced": bool(created.get("id")),
    }


def _build_flow(state: str | None = None) -> Flow | None:
    config = _client_config()
    if not config:
        return None
    if REDIRECT_URI.startswith("http://127.0.0.1") or REDIRECT_URI.startswith(
        "http://localhost"
    ):
        os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
    flow = Flow.from_client_config(config, scopes=SCOPES, state=state)
    flow.redirect_uri = REDIRECT_URI
    return flow


def _client_config() -> dict[str, Any] | None:
    ensure_dirs()
    if CREDENTIALS_PATH.exists():
        with CREDENTIALS_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)

    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    return {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [REDIRECT_URI],
        }
    }


def _load_credentials(*, refresh: bool) -> Credentials | None:
    ensure_dirs()
    if not TOKEN_PATH.exists():
        return None
    try:
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
        if refresh and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            _save_credentials(creds)
        if creds.valid:
            return creds
    except (GoogleAuthError, RefreshError, ValueError, OSError):
        return None
    return None


def _save_credentials(creds: Credentials) -> None:
    ensure_dirs()
    TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")


def _stored_email() -> str | None:
    try:
        data = json.loads(TOKEN_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data.get("account") or data.get("email")


def _state_matches(state: str | None) -> bool:
    if not AUTH_STATE_PATH.exists():
        return False
    try:
        data = json.loads(AUTH_STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return bool(state and secrets.compare_digest(state, str(data.get("state") or "")))


def _write_json(path: Path, data: dict[str, Any]) -> None:
    ensure_dirs()
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _delete_file(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def _event_summary(task_name: str | None, session_type: str) -> str:
    label = "Pomodoro" if session_type == "pomodoro" else "Focus"
    return f"LifeOS {label}: {task_name}" if task_name else f"LifeOS {label}"


def _event_time(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed.isoformat(timespec="seconds")
