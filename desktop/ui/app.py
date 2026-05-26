from __future__ import annotations

import json
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

DEPS_DIR = Path(__file__).resolve().parents[2] / ".deps"
if DEPS_DIR.exists():
    sys.path.insert(0, str(DEPS_DIR))

API_URL = "http://127.0.0.1:5000"


def fetch_health() -> dict:
    try:
        with urllib.request.urlopen(f"{API_URL}/health", timeout=1.5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


def run_browser_fallback() -> None:
    print(f"Opening dashboard in the default browser: {API_URL}/dashboard")
    webbrowser.open(f"{API_URL}/dashboard")
    print("LifeOS API is still running. Press Ctrl+C to stop.")
    while True:
        time.sleep(3600)


def run() -> None:
    try:
        import webview  # type: ignore

        webview.create_window(
            "LifeOS Focus",
            f"{API_URL}/dashboard",
            width=540,
            height=735,
            min_size=(540, 735),
            resizable=False,
            background_color="#1f1f2f",
        )
        webview.start()
        return
    except ImportError:
        print("pywebview is not installed. Falling back to the lightweight status window.")
    except Exception as exc:
        print(f"pywebview could not start: {exc}")
        print("Falling back to the lightweight status window.")

    try:
        import customtkinter as ctk

        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        app = ctk.CTk()
        app.title("LifeOS")
        app.geometry("420x260")
        app.resizable(False, False)
    except Exception as exc:
        print(f"CustomTkinter could not start: {exc}")
        run_browser_fallback()
        return

    title = ctk.CTkLabel(app, text="LifeOS Core", font=("Segoe UI", 22, "bold"))
    title.pack(pady=(28, 10))

    api_label = ctk.CTkLabel(app, text="API: checking...")
    api_label.pack(pady=6)

    monitor_label = ctk.CTkLabel(app, text="Monitor: checking...")
    monitor_label.pack(pady=6)

    def open_dashboard() -> None:
        webbrowser.open(f"{API_URL}/dashboard")

    button = ctk.CTkButton(app, text="Open Dashboard", command=open_dashboard)
    button.pack(pady=20)

    def poll() -> None:
        while True:
            health = fetch_health()
            status = health.get("status", "error")
            monitor = "enabled" if health.get("monitor") else "disabled"
            app.after(0, lambda s=status, m=monitor: api_label.configure(text=f"API: {s}"))
            app.after(0, lambda m=monitor: monitor_label.configure(text=f"Monitor: {m}"))
            time.sleep(3)

    threading.Thread(target=poll, daemon=True).start()
    app.mainloop()


if __name__ == "__main__":
    run()
