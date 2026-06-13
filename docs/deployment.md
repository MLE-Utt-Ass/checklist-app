# Deployment

The app runs as two Docker containers (backend + nginx) behind Cloudflare.

## Prerequisites

- A Linux server with Docker and Docker Compose installed
- SSH access to the server
- Domain `baanasso.online` in Cloudflare (already configured)

## 1. First-time server setup

```bash
# Install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker compose version
```

## 2. Deploy the app

```bash
# Clone the repo on the server
git clone git@github.com:MLE-Utt-Ass/checklist-app.git
cd checklist-app

# Build images and start containers in the background
docker compose up -d --build

# Confirm both containers are running
docker compose ps
```

Expected output:
```
NAME                   STATUS         PORTS
checklist-app-backend  Up (healthy)
checklist-app-nginx    Up             0.0.0.0:80->80/tcp
```

## 3. Cloudflare DNS

In the Cloudflare dashboard for `baanasso.online`:

1. **DNS → Records → Add record**
   - Type: `A`
   - Name: `@` (root domain)
   - IPv4 address: your server's public IP
   - Proxy status: **Proxied** (orange cloud — required for Cloudflare SSL)

2. **SSL/TLS → Overview**
   - Set encryption mode to **Full** (not Flexible, not Full Strict)
   - Flexible causes redirect loops. Full Strict requires a valid cert on the server (not needed here).

3. **Network → WebSockets**
   - Confirm **WebSockets** is **On** (default on all plans)

DNS propagation takes 1–5 minutes. Test with:

```bash
curl https://baanasso.online/api/checklists
```

## 4. Updating the app

```bash
# On the server, inside the checklist-app directory
git pull
docker compose up -d --build
```

Compose will rebuild only the changed layers and restart affected containers. The SQLite database volume persists across rebuilds.

## 5. Useful commands

```bash
# View live logs
docker compose logs -f

# View only backend logs
docker compose logs -f backend

# Restart just the backend (e.g., after adding a YAML checklist)
docker compose restart backend

# Open a shell in the backend container
docker compose exec backend sh

# Inspect the database
docker compose exec backend sh -c "DB_PATH=/data/checklist.db python3 -c \"
import sqlite3, json
db = sqlite3.connect('/data/checklist.db')
print(json.dumps(db.execute('SELECT * FROM users').fetchall()))
\""

# Stop everything
docker compose down

# Stop and delete all data (irreversible)
docker compose down -v
```

## 6. Backups

The database lives in the `db_data` Docker volume at `/data/checklist.db`.

```bash
# Copy the DB file to the host
docker compose cp backend:/data/checklist.db ./backup-$(date +%Y%m%d).db
```

Consider setting up a cron job on the server to run this daily.

## Architecture note

Nginx listens on port 80. Cloudflare handles HTTPS termination, so there is no SSL certificate on the server itself. If you ever remove Cloudflare from the stack, add Certbot/Let's Encrypt and update `nginx.conf` to listen on 443.
