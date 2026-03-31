"""Database operations for Project-Manager (SQLite + sqlite-vec)."""
import json
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import sqlite3

from .gc import _is_tmp_expired

# Try to load sqlite-vec extension
try:
    import sqlite_vec
    VEC_AVAILABLE = True
except ImportError:
    VEC_AVAILABLE = False
    sqlite_vec = None


def get_db(db_path: Path) -> sqlite3.Connection:
    """Get database connection with vec extension loaded."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    if VEC_AVAILABLE:
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(db_path: Path) -> None:
    """Initialize database schema."""
    conn = get_db(db_path)
    try:
        # Main memories table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id          TEXT PRIMARY KEY,
                category    TEXT NOT NULL,
                user_id     TEXT,
                title       TEXT NOT NULL DEFAULT '',
                content     TEXT NOT NULL,
                priority    TEXT,
                status      TEXT DEFAULT 'open',
                tags        TEXT DEFAULT '[]',
                extension   TEXT DEFAULT '{}',
                file_path   TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                expires_at  TEXT,
                type        TEXT
            )
        """)

        # Indexes
        conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_priority ON memories(priority)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at)")

        # sqlite-vec virtual table (graceful fallback if vec not available)
        if VEC_AVAILABLE:
            try:
                conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(memory_id TEXT, embedding FLOAT[1024])")
            except Exception:
                pass  # Table may already exist with different schema

        # Migration: add type column if missing
        try:
            conn.execute("ALTER TABLE memories ADD COLUMN type TEXT")
        except Exception:
            pass  # Column already exists

        conn.commit()
    finally:
        conn.close()


def add_memory(
    db_path: Path,
    id: str,
    category: str,
    user_id: Optional[str],
    title: str,
    content: str,
    file_path: str,
    priority: Optional[str] = None,
    status: str = "open",
    tags: Optional[list] = None,
    extension: Optional[dict] = None,
    embedding: Optional[list[float]] = None,
    expires_at: Optional[str] = None,
    type: Optional[str] = None,
) -> None:
    """Add a memory record to the database."""
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db(db_path)
    try:
        conn.execute("""
            INSERT INTO memories
            (id, category, user_id, title, content, priority, status, tags, extension, file_path, created_at, updated_at, expires_at, type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            id, category, user_id, title, content, priority, status,
            json.dumps(tags or []),
            json.dumps(extension or {}),
            file_path, now, now, expires_at, type
        ))

        # Store embedding in vec table if available
        if VEC_AVAILABLE and embedding:
            _add_embedding_vec(conn, id, embedding)

        conn.commit()
    finally:
        conn.close()


def _add_embedding_vec(conn: sqlite3.Connection, memory_id: str, embedding: list[float]) -> None:
    """Store embedding vector using sqlite-vec."""
    try:
        # Serialize embedding as binary blob
        vec_blob = _serialize_vector(embedding)
        conn.execute(
            "INSERT INTO memories_vec (memory_id, embedding) VALUES (?, ?)",
            (memory_id, vec_blob)
        )
    except Exception:
        pass  # Silently fail if vec table not available


def _serialize_vector(vec: list[float]) -> bytes:
    """Serialize float list to binary (FLOAT[1024] format for sqlite-vec)."""
    return struct.pack(f"<{len(vec)}f", *vec)


def search_memories(
    db_path: Path,
    query_embedding: Optional[list[float]],
    category: Optional[str] = None,
    user_id: Optional[str] = None,
    top_k: int = 10,
    exclude_tmp: bool = True,
) -> list[dict[str, Any]]:
    """Search memories using vector similarity or fallback to text match."""
    conn = get_db(db_path)
    try:
        conditions = ["1=1"]
        params: list = []

        if exclude_tmp:
            conditions.append("category != 'tmp'")
        if category:
            conditions.append("category = ?")
            params.append(category)
        if user_id:
            conditions.append("user_id = ?")
            params.append(user_id)

        where_clause = " AND ".join(conditions)

        if query_embedding and VEC_AVAILABLE:
            try:
                vec_blob = _serialize_vector(query_embedding)
                rows = conn.execute(f"""
                    SELECT m.*, vector_distance_cosine(mv.embedding, ?) AS score
                    FROM memories_vec mv
                    JOIN memories m ON m.id = mv.memory_id
                    WHERE {where_clause}
                    ORDER BY score ASC
                    LIMIT ?
                """, [vec_blob, top_k] + params).fetchall()
                return [dict(r) for r in rows]
            except Exception:
                pass  # Fall through to text search

        # Fallback: text LIKE search
        rows = conn.execute(f"""
            SELECT * FROM memories WHERE {where_clause} LIMIT ?
        """, params + [top_k]).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_memory_by_id(db_path: Path, id: str) -> Optional[dict[str, Any]]:
    """Get a single memory by ID."""
    conn = get_db(db_path)
    try:
        row = conn.execute("SELECT * FROM memories WHERE id = ?", (id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_memories(
    db_path: Path,
    category: Optional[str] = None,
    user_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List memories with optional filters."""
    conn = get_db(db_path)
    try:
        conditions = ["1=1"]
        params: list = []
        if category:
            conditions.append("category = ?")
            params.append(category)
        # Private categories filter by user_id; shared categories (None user_id) ignore this filter
        if user_id and category not in ("issue", "knowledge", "project", "milestone", "meeting"):
            conditions.append("(user_id = ? OR user_id IS NULL)")
            params.append(user_id)
        if status:
            conditions.append("status = ?")
            params.append(status)

        where_clause = " AND ".join(conditions)
        rows = conn.execute(f"""
            SELECT * FROM memories WHERE {where_clause} ORDER BY created_at DESC LIMIT ?
        """, params + [limit]).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def gc_expired(db_path: Path, tmp_dir: Path) -> list[str]:
    """Remove expired tmp files and their DB records. Returns removed IDs."""
    now = datetime.now(timezone.utc)
    removed: list[str] = []
    conn = get_db(db_path)
    try:
        rows = conn.execute(
            "SELECT id, file_path FROM memories WHERE category='tmp' AND expires_at IS NOT NULL AND expires_at < ?",
            (now.isoformat(),)
        ).fetchall()
        for row in rows:
            fpath = tmp_dir / Path(row["file_path"]).name
            if fpath.exists():
                fpath.unlink()
            conn.execute("DELETE FROM memories WHERE id = ?", (row["id"],))
            removed.append(row["id"])

        if VEC_AVAILABLE:
            for rid in removed:
                try:
                    conn.execute("DELETE FROM memories_vec WHERE memory_id = ?", (rid,))
                except Exception:
                    pass

        conn.commit()
    finally:
        conn.close()

    # Also clean up tmp files that exist but have no DB record
    if tmp_dir.exists():
        for f in tmp_dir.glob("TMP-*.md"):
            if _is_tmp_expired(f, now):
                f.unlink()
                removed.append(f.stem)

    return removed
