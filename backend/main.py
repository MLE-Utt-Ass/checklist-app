import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from typing import Any

import aiosqlite
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from database import init_db, DB_PATH
from loader import list_checklists, get_checklist, get_item


# ── connection registry ────────────────────────────────────────────────────────

class Room:
    def __init__(self):
        # ws -> {"user_id": str, "user_name": str}
        self._clients: dict[WebSocket, dict] = {}

    def add(self, ws: WebSocket, user_id: str, user_name: str):
        self._clients[ws] = {"user_id": user_id, "user_name": user_name}

    def remove(self, ws: WebSocket):
        self._clients.pop(ws, None)

    async def broadcast(self, msg: Any, skip: WebSocket | None = None):
        data = json.dumps(msg)
        dead = []
        for ws in list(self._clients):
            if ws is skip:
                continue
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.pop(ws, None)

    def online_users(self) -> list[dict]:
        seen = {}
        for info in self._clients.values():
            seen[info["user_id"]] = info["user_name"]
        return [{"id": uid, "name": uname} for uid, uname in seen.items()]


rooms: dict[str, Room] = {}


def get_room(checklist_id: str) -> Room:
    if checklist_id not in rooms:
        rooms[checklist_id] = Room()
    return rooms[checklist_id]


# ── startup ────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    list_checklists()   # warm loader cache
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── helpers ────────────────────────────────────────────────────────────────────

async def db():
    conn = await aiosqlite.connect(DB_PATH)
    conn.row_factory = aiosqlite.Row
    return conn


async def get_or_create_user(name: str) -> dict:
    async with await aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute("SELECT id, name FROM users WHERE name = ? COLLATE NOCASE", (name,)) as cur:
            row = await cur.fetchone()
        if row:
            return {"id": row["id"], "name": row["name"]}
        uid = str(uuid.uuid4())
        await conn.execute("INSERT INTO users (id, name) VALUES (?, ?)", (uid, name))
        await conn.commit()
        return {"id": uid, "name": name}


async def fetch_checks(checklist_id: str) -> dict[str, list[dict]]:
    """Returns {item_id: [{user_id, user_name, checked_at}]}"""
    result: dict[str, list] = {}
    async with await aiosqlite.connect(DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            """SELECT c.item_id, c.user_id, c.checked_at, u.name AS user_name
               FROM checks c JOIN users u ON u.id = c.user_id
               WHERE c.checklist_id = ?
               ORDER BY c.checked_at""",
            (checklist_id,)
        ) as cur:
            async for row in cur:
                result.setdefault(row["item_id"], []).append({
                    "user_id": row["user_id"],
                    "user_name": row["user_name"],
                    "checked_at": row["checked_at"],
                })
    return result


def build_checklist_payload(cl: dict, checks: dict[str, list[dict]], online: list[dict]) -> dict:
    sections = []
    for section in cl.get("sections", []):
        items = []
        for item in section.get("items", []):
            items.append({
                "id": item["id"],
                "label": item["label"],
                "note": item.get("note"),
                "tags": item.get("tags", []),
                "checked_by": checks.get(item["id"], []),
            })
        sections.append({
            "id": section["id"],
            "title": section["title"],
            "icon": section.get("icon", ""),
            "optional": section.get("optional", False),
            "items": items,
        })
    return {
        "id": cl["id"],
        "title": cl["title"],
        "description": cl.get("description", ""),
        "badge": cl.get("badge", ""),
        "sections": sections,
        "online_users": online,
    }


# ── REST endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/checklists")
async def api_list():
    return list_checklists()


@app.get("/api/checklists/{checklist_id}")
async def api_get(checklist_id: str):
    cl = get_checklist(checklist_id)
    if not cl:
        raise HTTPException(404, "Checklist not found")
    checks = await fetch_checks(checklist_id)
    room = get_room(checklist_id)
    return build_checklist_payload(cl, checks, room.online_users())


@app.post("/api/login")
async def api_login(body: dict):
    name = (body.get("name") or "").strip()
    if not name or len(name) > 40:
        raise HTTPException(400, "Invalid name")
    user = await get_or_create_user(name)
    return user


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/{checklist_id}")
async def ws_endpoint(ws: WebSocket, checklist_id: str):
    cl = get_checklist(checklist_id)
    if not cl:
        await ws.close(code=4004)
        return

    await ws.accept()
    room = get_room(checklist_id)
    user_id = None
    user_name = None

    try:
        # first message must be join
        raw = await asyncio.wait_for(ws.receive_text(), timeout=15)
        msg = json.loads(raw)
        if msg.get("type") != "join" or not msg.get("user_name"):
            await ws.close(code=4001)
            return

        user = await get_or_create_user(msg["user_name"].strip())
        user_id, user_name = user["id"], user["name"]
        room.add(ws, user_id, user_name)

        # send full state to the joining client
        checks = await fetch_checks(checklist_id)
        await ws.send_text(json.dumps({
            "type": "state",
            "checklist": build_checklist_payload(cl, checks, room.online_users()),
            "me": {"id": user_id, "name": user_name},
        }))

        # tell everyone else who joined
        await room.broadcast(
            {"type": "user_join", "user": {"id": user_id, "name": user_name},
             "online_users": room.online_users()},
            skip=ws,
        )

        # message loop
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            if msg.get("type") == "check":
                item_id = msg.get("item_id", "")
                checked = bool(msg.get("checked"))
                if not get_item(checklist_id, item_id):
                    continue

                async with await aiosqlite.connect(DB_PATH) as conn:
                    if checked:
                        await conn.execute(
                            """INSERT OR REPLACE INTO checks (item_id, checklist_id, user_id)
                               VALUES (?, ?, ?)""",
                            (item_id, checklist_id, user_id),
                        )
                    else:
                        await conn.execute(
                            "DELETE FROM checks WHERE item_id=? AND checklist_id=? AND user_id=?",
                            (item_id, checklist_id, user_id),
                        )
                    await conn.commit()

                # fetch updated checkers for this item
                checks = await fetch_checks(checklist_id)
                await room.broadcast({
                    "type": "item_update",
                    "item_id": item_id,
                    "checked_by": checks.get(item_id, []),
                })

    except (WebSocketDisconnect, asyncio.TimeoutError, Exception):
        pass
    finally:
        room.remove(ws)
        if user_id:
            await room.broadcast(
                {"type": "user_leave", "user_id": user_id,
                 "online_users": room.online_users()},
            )
