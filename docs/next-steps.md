# Next Steps

Ranked roughly by value/effort. Each section describes the goal, the key files to touch, and any gotchas.

---

## 1. Persistent login across devices (same name = same user)

**Current behaviour:** User ID is a UUID stored in `localStorage`. If a user opens the app on a different device and types the same name, the backend creates the same DB row (names are UNIQUE COLLATE NOCASE) — but the UUID returned will differ from the one in localStorage on the first device, so the user shows up as two different people in the UI.

**Fix:**
- On `POST /api/login`, return the canonical UUID from the DB (already done in `main.py`).
- On the frontend (`app.js`, `get_or_create_user`), always trust the UUID returned by the server, not a locally generated one. This is already the case — the bug is that the returned UUID may differ from what's in localStorage if the name was registered from a different device.
- The real fix: replace UUID storage with the server-assigned ID. Since login already returns `{id, name}` from the DB, just make sure the frontend always overwrites localStorage with whatever the server returns. This is already done — the issue resolves itself once the name matches an existing row.

**Verdict:** This already works correctly for the same-name case. No code change needed unless you want device-linked sessions.

---

## 2. Multiple checklists per trip / checklist selection

**Current state:** All checklists are listed on the home screen, but only the Rainy Season Hiking one exists.

**To add more checklists:** just drop YAML files into `backend/checklists/` (see [checklists.md](checklists.md)).

**Ideas:**
- Monsoon Trek
- Camping Gear Only
- Day Hike (no overnight gear)
- Beach Trip

---

## 3. Per-trip rooms (same checklist, isolated state)

**Problem:** Right now all users of the same checklist share one global room. If two different groups both open the Rainy Season checklist at the same time, they see each other's checks.

**Solution:** Add a `trip` concept — a short code (e.g. `ABC123`) that scopes the room and all check records.

**Changes needed:**

`database.py` — add `trip_id` column to `checks`:
```sql
ALTER TABLE checks ADD COLUMN trip_id TEXT NOT NULL DEFAULT 'default';
```
Update the PRIMARY KEY to include `trip_id`.

`main.py` — add trip creation endpoint and scope all DB queries by `trip_id`. Pass `trip_id` as a WebSocket query param or path segment (`/ws/{checklist_id}/{trip_id}`).

`frontend/js/app.js` — add a "Create trip" / "Join trip" flow on the home screen. Store `trip_id` in `localStorage` or URL hash.

---

## 4. Reset checklist (clear all checks for a trip)

Simple: add a `DELETE /api/checklists/{id}/checks` endpoint (or scope to trip). Add a "Reset all" button in the UI, protected by a confirmation dialog.

---

## 5. Automated tests

No tests exist yet. Start with:

**Backend — `pytest` + `httpx` + `anyio`:**
```bash
pip install pytest pytest-anyio httpx
```

Key test cases:
- `POST /api/login` creates a user and is idempotent for the same name
- `GET /api/checklists` returns the loaded YAML files
- WebSocket: join → receive `state` → send `check` → receive `item_update`
- Check persists across reconnect

**Frontend — no framework to test, but:**
- Add `data-testid` attributes to key UI elements
- Use Playwright for end-to-end tests (two browser contexts = two users)

---

## 6. Progressive Web App (PWA) / installable on phone

Add to `frontend/index.html`:
```html
<link rel="manifest" href="/manifest.json">
```

Create `frontend/manifest.json`:
```json
{
  "name": "Trail Checklist",
  "short_name": "Checklist",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f0f4f8",
  "theme_color": "#2b6cb0",
  "icons": [
    {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}
  ]
}
```

Add a service worker for offline access to the static shell.

---

## 7. Scale beyond one backend replica

**Current limitation:** The `Room` registry is in-process memory. Two backend containers = two isolated rooms, so users on different containers can't see each other.

**Fix:** Replace the in-memory `rooms` dict with Redis pub/sub.

```python
# main.py — broadcast via Redis instead of iterating local dict
import redis.asyncio as redis

r = redis.from_url("redis://redis:6379")

async def broadcast(channel: str, msg: dict):
    await r.publish(channel, json.dumps(msg))

# Each WebSocket handler subscribes to its checklist channel
async def ws_reader(ws, channel):
    async with r.pubsub() as ps:
        await ps.subscribe(channel)
        async for message in ps.listen():
            if message["type"] == "message":
                await ws.send_text(message["data"])
```

Add to `docker-compose.yml`:
```yaml
redis:
  image: redis:7-alpine
  networks: [internal]
```

---

## 8. Admin panel / checklist management UI

Right now checklists require SSH access to add YAML files. A simple admin page (password-protected, even just HTTP Basic Auth via Nginx) could allow:
- Uploading a YAML file
- Viewing current check stats per item
- Clearing all checks

---

## 9. Notifications

When a teammate checks a high-priority item, send a push notification. Requires:
- Service worker (see PWA above)
- `POST /api/subscribe` endpoint to store push subscriptions
- `pywebpush` library on the backend to send Web Push messages
- Trigger on `check` events for items tagged `essential`

---

## 10. Automatic daily backup

Add a cron job on the server:

```bash
# /etc/cron.daily/checklist-backup
#!/bin/sh
docker compose -f /home/user/checklist-app/docker-compose.yml \
  exec -T backend sh -c "sqlite3 /data/checklist.db .dump" \
  > /backups/checklist-$(date +%Y%m%d).sql
# Keep last 30 days
find /backups -name "checklist-*.sql" -mtime +30 -delete
```
