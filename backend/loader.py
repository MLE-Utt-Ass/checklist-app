import os
import yaml
from pathlib import Path

CHECKLISTS_DIR = Path(__file__).parent / "checklists"
_cache: dict = {}


def load_all() -> dict:
    if _cache:
        return _cache
    for path in sorted(CHECKLISTS_DIR.glob("*.yaml")):
        with open(path) as f:
            data = yaml.safe_load(f)
        cl_id = data["id"]
        # index items for fast lookup
        data["_items"] = {}
        for section in data.get("sections", []):
            for item in section.get("items", []):
                data["_items"][item["id"]] = item
        _cache[cl_id] = data
    return _cache


def get_checklist(cl_id: str) -> dict | None:
    return load_all().get(cl_id)


def get_item(cl_id: str, item_id: str) -> dict | None:
    cl = get_checklist(cl_id)
    if cl is None:
        return None
    return cl["_items"].get(item_id)


def list_checklists() -> list:
    return [
        {"id": v["id"], "title": v["title"], "description": v.get("description", ""),
         "badge": v.get("badge", ""), "section_count": len(v.get("sections", [])),
         "item_count": len(v["_items"])}
        for v in load_all().values()
    ]
