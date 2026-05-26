from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, request

import msal

from .db import CONFIG_DIR, ensure_dirs

TOKEN_PATH = CONFIG_DIR / "outlook_token.json"
CREDENTIALS_PATH = CONFIG_DIR / "outlook_credentials.json"
AUTH_FLOW_PATH = CONFIG_DIR / "outlook_auth_flow.json"
AUTHORITY = os.environ.get(
    "OUTLOOK_AUTHORITY", "https://login.microsoftonline.com/common"
)
DEFAULT_REDIRECT_URI = os.environ.get(
    "LIFEOS_OUTLOOK_REDIRECT_URI",
    "http://127.0.0.1:5000/api/calendar/outlook/callback",
)
SCOPES = ["User.Read", "Calendars.ReadWrite", "offline_access"]
TIMEZONE = os.environ.get("LIFEOS_CALENDAR_TIMEZONE", "UTC")
GRAPH_ROOT = "https://graph.microsoft.com/v1.0"


def status() -> dict:
    token = _acquire_token_silent()
    return {
        "connected": bool(token),
        "email": _account_email() if token else None,
        "configured": _client_id() is not None,
    }


def auth_url() -> dict:
    client_id = _client_id()
    if not client_id:
        return {
            "configured": False,
            "url": None,
            "message": (
                "Outlook OAuth credentials are not configured. Add "
                "config/outlook_credentials.json or set OUTLOOK_CLIENT_ID."
            ),
        }

    try:
        app, cache = _app()
        flow = app.initiate_auth_code_flow(
            scopes=SCOPES,
            redirect_uri=_redirect_uri(),
            prompt="select_account",
        )
    except Exception as exc:
        return {
            "configured": True,
            "url": None,
            "message": f"Outlook OAuth initialization failed: {exc}",
        }
    if "auth_uri" not in flow:
        return {
            "configured": True,
            "url": None,
            "message": flow.get("error_description") or flow.get("error"),
        }
    _save_cache(cache)
    _write_json(AUTH_FLOW_PATH, flow)
    return {"configured": True, "url": flow["auth_uri"]}


def callback(payload: dict) -> dict:
    if payload.get("error"):
        return {
            "connected": False,
            "message": payload.get("error_description") or payload.get("error"),
        }

    flow = _read_json(AUTH_FLOW_PATH)
    if not flow:
        return {"connected": False, "message": "Outlook OAuth flow has expired."}

    try:
        app, cache = _app()
        result = app.acquire_token_by_auth_code_flow(flow, payload)
    except ValueError:
        return {"connected": False, "message": "Outlook OAuth state mismatch."}
    except Exception as exc:
        return {"connected": False, "message": f"Outlook OAuth failed: {exc}"}

    if "access_token" not in result:
        return {
            "connected": False,
            "message": result.get("error_description") or result.get("error"),
        }

    _save_cache(cache)
    _write_token_metadata(cache, result)
    _delete_file(AUTH_FLOW_PATH)
    return {**status(), "message": "Outlook Calendar connected."}


def disconnect() -> dict:
    _delete_file(TOKEN_PATH)
    _delete_file(AUTH_FLOW_PATH)
    return {"connected": False}


def create_event(
    *, task_name: str | None, session_type: str, started_at: str, ended_at: str
) -> dict:
    token = _acquire_token_silent()
    if not token:
        return {
            "cal_event_id": None,
            "provider": "outlook",
            "synced": False,
            "message": "Outlook Calendar is not connected.",
        }

    payload = {
        "subject": _event_summary(task_name, session_type),
        "body": {
            "contentType": "text",
            "content": "Created by LifeOS Focus.",
        },
        "start": {"dateTime": _event_time(started_at), "timeZone": TIMEZONE},
        "end": {"dateTime": _event_time(ended_at), "timeZone": TIMEZONE},
    }
    try:
        created = _graph_json(
            "POST",
            "/me/events",
            token["access_token"],
            body=payload,
        )
    except OSError as exc:
        return {
            "cal_event_id": None,
            "provider": "outlook",
            "synced": False,
            "message": f"Outlook Calendar sync failed: {exc}",
        }

    return {
        "cal_event_id": created.get("id"),
        "provider": "outlook",
        "synced": bool(created.get("id")),
    }


def _client_id() -> str | None:
    ensure_dirs()
    if CREDENTIALS_PATH.exists():
        data = _read_json(CREDENTIALS_PATH)
        return str(data.get("client_id") or "") or None
    return os.environ.get("OUTLOOK_CLIENT_ID") or os.environ.get("MICROSOFT_CLIENT_ID")


def _authority() -> str:
    data = _read_json(CREDENTIALS_PATH) if CREDENTIALS_PATH.exists() else {}
    return str(data.get("authority") or AUTHORITY)


def _redirect_uri() -> str:
    data = _read_json(CREDENTIALS_PATH) if CREDENTIALS_PATH.exists() else {}
    return str(data.get("redirect_uri") or DEFAULT_REDIRECT_URI)


def _app() -> tuple[msal.PublicClientApplication, msal.SerializableTokenCache]:
    cache = msal.SerializableTokenCache()
    data = _read_json(TOKEN_PATH)
    if data.get("cache"):
        cache.deserialize(data["cache"])
    app = msal.PublicClientApplication(
        _client_id(),
        authority=_authority(),
        token_cache=cache,
        instance_discovery=False,
    )
    return app, cache


def _acquire_token_silent() -> dict[str, Any] | None:
    if not _client_id() or not TOKEN_PATH.exists():
        return None
    try:
        app, cache = _app()
        accounts = app.get_accounts()
        account = _preferred_account(accounts)
        if not account:
            return None
        result = app.acquire_token_silent(SCOPES, account=account)
        if result and "access_token" in result:
            _save_cache(cache)
            return result
    except Exception:
        return None
    return None


def _preferred_account(accounts: list[dict[str, Any]]) -> dict[str, Any] | None:
    email = _account_email()
    if email:
        for account in accounts:
            if account.get("username") == email:
                return account
    return accounts[0] if accounts else None


def _write_token_metadata(
    cache: msal.SerializableTokenCache, result: dict[str, Any]
) -> None:
    claims = result.get("id_token_claims") or {}
    data = {
        "cache": cache.serialize(),
        "account": claims.get("preferred_username")
        or claims.get("email")
        or claims.get("upn"),
    }
    _write_json(TOKEN_PATH, data)


def _save_cache(cache: msal.SerializableTokenCache) -> None:
    if not TOKEN_PATH.exists():
        return
    data = _read_json(TOKEN_PATH)
    data["cache"] = cache.serialize()
    _write_json(TOKEN_PATH, data)


def _account_email() -> str | None:
    data = _read_json(TOKEN_PATH)
    account = data.get("account")
    return str(account) if account else None


def _graph_json(
    method: str, path: str, access_token: str, body: dict[str, Any] | None = None
) -> dict[str, Any]:
    payload = None
    headers = {"Authorization": f"Bearer {access_token}"}
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = request.Request(
        f"{GRAPH_ROOT}{path}",
        data=payload,
        headers=headers,
        method=method,
    )
    try:
        with request.urlopen(req, timeout=20) as res:
            text = res.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise OSError(f"Microsoft Graph returned {exc.code}: {detail}") from exc
    return json.loads(text) if text else {}


def _write_json(path: Path, data: dict[str, Any]) -> None:
    ensure_dirs()
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


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
