import aiosqlite
import os

DB_PATH = os.environ.get("DB_PATH", "/data/checklist.db")


async def get_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db


async def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id   TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL COLLATE NOCASE,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS checks (
                item_id      TEXT NOT NULL,
                checklist_id TEXT NOT NULL,
                user_id      TEXT NOT NULL,
                checked_at   TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (item_id, checklist_id, user_id)
            );
        """)
        await db.commit()
