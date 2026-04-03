"""Pydantic record models for RemX v2."""
from typing import Any, Optional

from pydantic import BaseModel


class MemoryRecord(BaseModel):
    """A memory record as stored in the memories table."""
    id: str
    category: str
    priority: Optional[str] = None
    status: str = "open"
    type: Optional[str] = None
    file_path: str
    chunk_count: int
    created_at: str
    updated_at: str
    expires_at: Optional[str] = None
    deprecated: int = 0


class GCReport(BaseModel):
    """Garbage collection report."""
    expired_memories: list[dict[str, Any]]
    deprecated_memories: list[dict[str, Any]]
    total_chunks: int
