# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Set up environment
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run the app
python desktop/main.py

# Run all tests
python -m unittest discover

# Run a single test
python -m unittest tests.test_api.ApiTest.test_health

# Build Windows executable (run on Windows)
build_windows.bat
```

## Architecture

LifeOS Focus is a local productivity tracker. `desktop/main.py` starts three components in sequence:

1. **Flask API** (`backend/app.py`) — runs on `http://127.0.0.1:5000` in a daemon thread; serves both API routes and the static web UI
2. **Activity monitor** (`backend/monitor.py`) — samples the active window every N seconds (Windows-only via `pywin32`; gracefully degrades on other OSes); writes directly to SQLite
3. **Desktop UI** (`desktop/ui/app.py`) — tries `pywebview` first (embedded browser), falls back to a `customtkinter` status window, then falls back to opening the browser

The web UI (`web/`) is plain HTML/CSS/JS with no build step. Flask serves it at `/dashboard`.

## Data & Config Paths

At runtime, `backend/db.py` resolves paths based on whether the app is frozen (PyInstaller) or running from source:
- **Dev:** `data/lifeos.db`, `config/settings.json`, `config/rules.json` — all relative to repo root
- **Frozen:** platform-specific user data dir (e.g. `%APPDATA%\LifeOS Focus\`)

The `.deps/` directory is injected into `sys.path` at startup for PyInstaller bundle compatibility — it holds copies of packages that can't be bundled normally.

## Key Conventions

**Categories are Chinese strings:** `编程`, `学习`, `工作`, `娱乐`, `游戏`, `其他`. These appear as dict keys in API responses, database values, and classifier rules. Never translate or rename them.

**Classifier priority:** domain match → process name match → `title_contains` substring match → default (`其他`). Rules live in `config/rules.json` (user copy) with `backend/rules.json` as a template for first-run.

**Settings are patched, not replaced:** `PATCH /api/settings` merges only supplied keys into the full settings dict. Unknown keys return 400. All valid keys must appear in `DEFAULT_SETTINGS` in `backend/db.py`.

**Points are awarded transactionally:** `award_points()` in `backend/app.py` is called inside the same SQLite connection as the session insert. The idempotency guard (`add_point_once`) prevents duplicate streak bonuses for the same day.

**Module import pattern:** every backend module has a dual-import block (`if __package__ in {None, ""}`) to support both `python backend/app.py` (direct run) and `from backend import ...` (package import).

## Database Schema

Five tables: `activities` (window tracking), `sessions` (pomodoro/free_focus), `goals`, `points` (gamification ledger), `daily_reports`. Session completion triggers point awards. Activities are written by the monitor directly; sessions are written by the web UI via `POST /api/session`.

## Testing

Tests use stdlib `unittest` + Flask's test client against a real SQLite DB (not mocked). `setUp()` resets all tables and restores `DEFAULT_SETTINGS`. Add new tests to `tests/test_api.py`, reset state in `setUp()`/`tearDown()`.

## Windows-only Code

`backend/monitor.py` imports `psutil`, `win32gui`, and `win32process` only on Windows. The monitor thread runs on all platforms but immediately goes idle if not on Windows. Do not add Windows-specific imports at module level.
