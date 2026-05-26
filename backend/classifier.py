from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .db import CONFIG_DIR, ROOT_DIR

RULES_PATH = CONFIG_DIR / "rules.json"
RULES_TEMPLATE_PATH = ROOT_DIR / "backend" / "rules.json"

CATEGORY_COLORS = {
    "编程": "#5C9BE0",
    "学习": "#9B5CE0",
    "工作": "#4CAF50",
    "娱乐": "#E0A05C",
    "游戏": "#E05C5C",
    "其他": "#888888",
}

DEFAULT_RULES = {
    "rules": [
        {"process": "code.exe", "category": "编程"},
        {"process": "cursor.exe", "category": "编程"},
        {"process": "pycharm64.exe", "category": "编程"},
        {"domain": "github.com", "category": "编程"},
        {"domain": "claude.ai", "category": "学习"},
        {"domain": "youtube.com", "category": "娱乐"},
        {"domain": "bilibili.com", "category": "娱乐"},
        {"domain": "twitter.com", "category": "娱乐"},
        {"domain": "x.com", "category": "娱乐"},
        {"process": "WINWORD.EXE", "category": "工作"},
        {"process": "EXCEL.EXE", "category": "工作"},
        {"title_contains": "- 游戏", "category": "游戏"},
    ],
    "default": "其他",
}


def ensure_rules() -> None:
    if not RULES_PATH.exists():
        if RULES_TEMPLATE_PATH.exists():
            RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
            RULES_PATH.write_text(RULES_TEMPLATE_PATH.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            save_rules(DEFAULT_RULES)


def load_rules() -> dict[str, Any]:
    ensure_rules()
    with RULES_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("rules", [])
    data.setdefault("default", "其他")
    return data


def save_rules(data: dict[str, Any]) -> None:
    RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
    normalized = {"rules": data.get("rules", []), "default": data.get("default", "其他")}
    with RULES_PATH.open("w", encoding="utf-8") as f:
        json.dump(normalized, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _same(value: str | None, expected: str | None) -> bool:
    return bool(value and expected and value.lower() == expected.lower())


def classify(process: str | None, title: str | None = None, domain: str | None = None) -> str:
    data = load_rules()
    rules = data["rules"]
    for rule in rules:
        if "domain" in rule and _same(domain, rule["domain"]):
            return rule["category"]
    for rule in rules:
        if "process" in rule and _same(process, rule["process"]):
            return rule["category"]
    lowered_title = (title or "").lower()
    for rule in rules:
        needle = rule.get("title_contains")
        if needle and needle.lower() in lowered_title:
            return rule["category"]
    return data.get("default", "其他")


def color_for(category: str) -> str:
    return CATEGORY_COLORS.get(category, CATEGORY_COLORS["其他"])


def public_rules() -> dict[str, Any]:
    data = load_rules()
    rules = []
    for idx, rule in enumerate(data["rules"]):
        item = {"id": str(rule.get("id", idx)), **rule}
        rules.append(item)
    return {"rules": rules, "default": data["default"], "colors": CATEGORY_COLORS}
