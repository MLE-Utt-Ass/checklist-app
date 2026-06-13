# Checklist App

Real-time collaborative checklist web app. Multiple users share the same checklist and see each other's progress live — no accounts, just enter a name and go.

**Live at:** `https://baanasso.online`

## Docs

| Doc | What it covers |
|-----|----------------|
| [Architecture](docs/architecture.md) | How the pieces fit together, data flow, WebSocket protocol |
| [Local Development](docs/local-development.md) | Run without Docker for fast iteration |
| [Deployment](docs/deployment.md) | Docker + Cloudflare step-by-step |
| [Checklists](docs/checklists.md) | YAML format, adding new checklists |
| [Next Steps](docs/next-steps.md) | Planned features and how to approach them |

## Quick start (Docker)

```bash
docker compose up -d
# open http://localhost
```

## Project layout

```
checklist-app/
├── backend/          ← FastAPI server (Python)
│   ├── main.py       ← API + WebSocket endpoints
│   ├── database.py   ← SQLite init
│   ├── loader.py     ← YAML checklist loader
│   └── checklists/   ← one .yaml file per checklist
├── frontend/         ← Vanilla JS SPA
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── nginx/            ← Reverse proxy config + Dockerfile
└── docker-compose.yml
```
