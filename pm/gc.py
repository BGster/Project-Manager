"""Garbage collection for expired tmp files."""
import random
import re
from datetime import datetime, timezone
from pathlib import Path

from dateutil import parser as dateutil_parser


def gc_expired_files(tmp_dir: Path) -> list[str]:
    """
    Lazily clean up expired tmp files based on their front-matter expires_at.
    Returns list of removed file names.
    """
    removed: list[str] = []
    if not tmp_dir.exists():
        return removed

    now = datetime.now(timezone.utc)
    for f in tmp_dir.glob("TMP-*.md"):
        try:
            if _is_tmp_expired(f, now):
                f.unlink()
                removed.append(f.name)
        except Exception:
            # File corrupted or unreadable — skip
            pass
    return removed


def _is_tmp_expired(file_path: Path, now: datetime) -> bool:
    """Check if a tmp file has expired."""
    try:
        content = file_path.read_text(encoding="utf-8")
        # Look for expires_at in front-matter or body
        match = re.search(r"\*\*过期时间\*\*:\s*(.+)|expires_at:\s*(.+)", content, re.IGNORECASE)
        if match:
            expires_str = match.group(1) or match.group(2)
            expires_at = dateutil_parser.parse(expires_str)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            return expires_at < now
    except Exception:
        pass
    return False


def lazy_gc(tmp_dir: Path, probability: float = 0.1) -> list[str]:
    """Probabilistically run GC to avoid scanning every command."""
    if random.random() < probability:
        return gc_expired_files(tmp_dir)
    return []
