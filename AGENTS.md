# Repository Guidelines

## Project Structure & Module Organization

LifeOS Focus is a local Python desktop/web app. `desktop/main.py` starts the Flask API, background monitor, and desktop UI. Backend code lives in `backend/`: `app.py` defines API routes, `db.py` manages SQLite/settings paths, `monitor.py` tracks activity, and calendar integrations live in `calendar_google.py` and `calendar_outlook.py`. Desktop shell code lives in `desktop/ui/` for the pywebview/customtkinter shell, while browser assets live in `web/` (`index.html`, `app.js`, `styles.css`). Tests are in `tests/`. Runtime state is stored under `data/` and `config/`; avoid committing personal database or settings changes unless intentional.

## Build, Test, and Development Commands

Create an environment and install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run the app locally:

```bash
python desktop/main.py
```

Run tests:

```bash
python -m unittest discover
```

Build the Windows executable from Windows:

```bat
build_windows.bat
```

The build output is `dist\LifeOS Focus.exe`.

## Coding Style & Naming Conventions

Use Python 3.11+ with 4-space indentation and type hints where they clarify API boundaries. Keep module names lowercase with underscores, classes in `PascalCase`, and functions/variables in `snake_case`. Prefer `pathlib.Path` for filesystem paths and keep JSON/database access centralized through existing helpers in `backend/db.py`. Frontend files use plain HTML/CSS/JavaScript; keep selectors and functions descriptive, and avoid adding build tooling unless it is required.

## Testing Guidelines

Tests use the standard library `unittest` framework and Flask's test client. Add tests under `tests/` with names like `test_api.py` and methods beginning with `test_`. Reset or isolate SQLite state in `setUp()` when touching persistent tables. Cover new API routes, validation errors, settings changes, and statistics calculations before changing behavior.

## Commit & Pull Request Guidelines

This repository currently has no commit history, so no established commit convention exists. Use short, imperative commit messages such as `Add focus session validation` or `Fix settings persistence`. Pull requests should include a concise summary, test results, linked issues if applicable, and screenshots or recordings for visible UI changes. Note any changes to local data, settings defaults, packaging, or calendar integration behavior.

## Security & Configuration Tips

Do not commit personal `data/lifeos.db`, local settings, OAuth tokens, or calendar credentials. Keep provider-specific secrets outside source control and document required environment or config keys when adding integrations.
