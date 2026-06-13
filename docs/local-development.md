# Local Development

Run backend and frontend separately for fast iteration — no Docker required.

## Prerequisites

- Python 3.11+
- Any static file server (Python's built-in `http.server` works)

## 1. Backend

```bash
cd backend

# Create and activate a virtualenv
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the dev server (auto-reloads on file changes)
uvicorn main:app --reload --port 8000
```

The API is now at `http://localhost:8000`.  
Interactive API docs: `http://localhost:8000/docs`

## 2. Frontend

The frontend is plain HTML/JS — just serve the directory:

```bash
cd frontend
python3 -m http.server 3000
```

Open `http://localhost:3000`.

> The frontend auto-detects the origin for API and WebSocket calls, so it will connect to `http://localhost:3000`'s origin by default — but the backend is on port 8000. You need to either:
>
> **Option A (recommended):** Run Nginx locally via Docker to proxy everything through one port:
> ```bash
> docker compose up nginx backend
> # visit http://localhost
> ```
>
> **Option B:** Edit the top of `frontend/js/app.js` to hardcode the dev URLs:
> ```js
> const API = "http://localhost:8000";
> const WS_BASE = "ws://localhost:8000";
> ```
> Revert this before committing.

## File structure to know

| File | Role |
|------|------|
| `backend/main.py` | All API and WebSocket logic |
| `backend/loader.py` | Reads YAML files; edit to change parsing |
| `backend/database.py` | SQLite schema; edit to add columns |
| `frontend/js/app.js` | Entire SPA — routing, WS client, rendering |
| `frontend/css/style.css` | All styles; CSS variables at the top for theming |

## Adding a checklist (dev)

1. Create `backend/checklists/my-checklist.yaml` (see [checklists.md](checklists.md))
2. The running `uvicorn --reload` process will restart automatically
3. Visit `http://localhost/api/checklists` to confirm it appears

## Database location

In local dev the DB defaults to `/data/checklist.db`.  
Override with an env var:

```bash
DB_PATH=./dev.db uvicorn main:app --reload --port 8000
```

## Running tests

There are no automated tests yet — see [next-steps.md](next-steps.md) for the test plan.  
Manual smoke test:

1. Open two browser tabs at `http://localhost`
2. Log in with different names
3. Check an item in one tab — it should appear checked in the other within ~100 ms
4. Refresh both tabs — checks should persist
