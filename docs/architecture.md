# Architecture

## Overview

```
Browser (mobile/desktop)
        │
        │  HTTPS (Cloudflare terminates TLS)
        ▼
  Cloudflare CDN
        │
        │  HTTP port 80
        ▼
  Nginx container
   ├── /           → serves frontend/  (static HTML/CSS/JS)
   ├── /api/*      → proxy → backend:8000
   └── /ws/*       → proxy → backend:8000 (WebSocket upgrade)
        │
        ▼
  FastAPI container (backend)
        │
        ▼
  SQLite  (/data/checklist.db  — Docker volume)
```

## Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Python 3.12 + FastAPI | async-native, built-in WebSocket support |
| Database | SQLite via aiosqlite | zero-ops, sufficient for this scale |
| Real-time | WebSockets (native FastAPI) | bidirectional push, no polling |
| Frontend | Vanilla JS SPA | no build step, fast mobile load |
| Proxy | Nginx 1.27 | static file serving + WS proxy |
| Containers | Docker + Compose | single-command deploy |
| TLS / CDN | Cloudflare | free SSL, DDoS protection |

## Data model

### SQLite tables

```sql
-- A "user" is just a name. ID is a UUID generated on first login.
-- Same name from two devices = same user row (COLLATE NOCASE match).
users (
  id         TEXT PRIMARY KEY,   -- UUID
  name       TEXT UNIQUE,        -- display name
  created_at TEXT
)

-- One row per (item, checklist, user) triple.
-- Deleting the row = unchecked. No soft deletes.
checks (
  item_id      TEXT,
  checklist_id TEXT,
  user_id      TEXT,
  checked_at   TEXT,
  PRIMARY KEY (item_id, checklist_id, user_id)
)
```

### Checklists (YAML, not in DB)

Checklists are static YAML files loaded at startup into an in-memory dict. They never change at runtime. See [checklists.md](checklists.md) for the schema.

## WebSocket protocol

All messages are JSON. The connection is per-checklist (`/ws/{checklist_id}`).

### Client → Server

| type | payload | meaning |
|------|---------|---------|
| `join` | `{user_name}` | First message after connect. Required. |
| `check` | `{item_id, checked: bool}` | Toggle an item on/off for the current user |

### Server → Client

| type | payload | meaning |
|------|---------|---------|
| `state` | `{checklist, me}` | Full checklist state sent on join |
| `item_update` | `{item_id, checked_by[]}` | Broadcast whenever any user checks/unchecks |
| `user_join` | `{user, online_users[]}` | Broadcast when someone connects |
| `user_leave` | `{user_id, online_users[]}` | Broadcast when someone disconnects |

### Connection lifecycle

1. Client opens `ws://.../ws/{id}`
2. Server accepts, waits up to 15 s for a `join` message
3. Server sends `state` with full checklist + current check data
4. Both sides exchange messages freely
5. On disconnect: server removes client from room, broadcasts `user_leave`
6. Client auto-reconnects every 3 s on close

## Checklist loader

`loader.py` reads all `*.yaml` files in `backend/checklists/` once at startup and caches them in a module-level dict. The dict also contains a flattened `_items` index for O(1) item lookup during check validation.

**To add a checklist:** drop a `.yaml` file and restart the backend container — `docker compose restart backend`.

## Rooms

Each checklist has a `Room` object (in-memory, process-local). It tracks the set of active WebSocket connections and their associated user info. Broadcasts iterate all connections and silently drop dead ones.

> **Note:** Because rooms are in-process memory, running multiple backend replicas would split users across rooms. For multi-replica support, replace the in-memory room with a Redis pub/sub channel (see [next-steps.md](next-steps.md)).
