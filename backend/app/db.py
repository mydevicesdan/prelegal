import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(db_path)


def reset_database(db_path: Path) -> None:
    """Recreate the database from scratch. The DB is temporary by design: every start is a clean slate."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.unlink(missing_ok=True)
    with connect(db_path) as conn:
        conn.executescript(SCHEMA)
    conn.close()
