from __future__ import annotations

import atexit
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEPS_DIR = ROOT / ".deps"
if DEPS_DIR.exists():
    sys.path.insert(0, str(DEPS_DIR))

from backend.db import init_db, init_settings
from backend.app import app as flask_app
from backend.monitor import run as run_monitor
from desktop.ui.app import run as run_ui


THREADS: list[threading.Thread] = []


def start_thread(name: str, target) -> threading.Thread:
    thread = threading.Thread(target=target, name=f"lifeos-{name}", daemon=True)
    thread.start()
    THREADS.append(thread)
    return thread


def cleanup() -> None:
    # Daemon threads are stopped by process exit. This hook exists so future
    # shutdown work has one place to live.
    return None


def wait_for_health(timeout: float = 5.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:5000/health", timeout=1):
                return True
        except Exception:
            time.sleep(0.2)
    return False


def run_api() -> None:
    flask_app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)


def main() -> int:
    init_settings()
    init_db()
    atexit.register(cleanup)

    start_thread("api", run_api)
    if not wait_for_health():
        print("LifeOS API did not become ready on http://127.0.0.1:5000")
        return 1

    start_thread("monitor", run_monitor)
    try:
        run_ui()
    except KeyboardInterrupt:
        return 130
    finally:
        cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
