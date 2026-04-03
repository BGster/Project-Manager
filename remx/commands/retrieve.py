"""remx retrieve command — filter-based + semantic retrieval, returns JSON array."""
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from ..core.db import retrieve, retrieve_semantic
from ..core.schema import MetaYaml


def run_retrieve(
    db_path: Path,
    filter: Optional[dict[str, Any]] = None,
    include_content: bool = True,
    limit: int = 50,
    *,
    # Semantic search options
    query: Optional[str] = None,
    meta_yaml_path: Optional[Path] = None,
    embedder: Optional[Any] = None,
    decay_weight: float = 0.5,
) -> int:
    """Retrieve memories by filter and/or semantic query, output JSON array.

    Args:
        db_path: path to SQLite database
        filter: dict of field → value for SQL WHERE translation
        include_content: join with chunks table
        limit: max results
        query: natural language query for semantic search (triggers vector mode)
        meta_yaml_path: path to meta.yaml (required for semantic search)
        embedder: Embedder instance (required for semantic search)
        decay_weight: weight for decay factor in semantic score (0.0 to 1.0)

    Returns:
        0 on success, 1 on error
    """
    if not db_path.exists():
        print(f"remx retrieve: {db_path}: database not found", file=sys.stderr)
        return 1

    filter = filter or {}

    # Parse JSON filter if passed as string
    if isinstance(filter, str):
        try:
            filter = json.loads(filter)
        except json.JSONDecodeError as e:
            print(f"remx retrieve: invalid filter JSON — {e}", file=sys.stderr)
            return 1

    if not isinstance(filter, dict):
        print(f"remx retrieve: filter must be a JSON object", file=sys.stderr)
        return 1

    try:
        if query:
            # Semantic search mode
            if not meta_yaml_path:
                print("remx retrieve: --query requires --meta", file=sys.stderr)
                return 1
            if not embedder:
                print("remx retrieve: --query requires embedder (check --db and vec support)", file=sys.stderr)
                return 1

            meta = MetaYaml.load(meta_yaml_path)
            query_emb = embedder.embed(query)
            rows = retrieve_semantic(
                db_path=db_path,
                query_embedding=query_emb,
                meta=meta,
                filter=filter,
                include_content=include_content,
                limit=limit,
                decay_weight=decay_weight,
            )
        else:
            # Filter-only mode
            rows = retrieve(db_path, filter, include_content=include_content, limit=limit)
    except Exception as e:
        print(f"remx retrieve: query error — {e}", file=sys.stderr)
        return 1

    # Serialize datetime/None values for JSON
    def _sanitize(row: dict) -> dict:
        out = {}
        for k, v in row.items():
            if isinstance(v, (datetime,)):
                out[k] = v.isoformat()
            elif v is None:
                out[k] = None
            elif isinstance(v, (int, float, str, bool, list, dict)):
                out[k] = v
            else:
                out[k] = str(v)
        return out

    output = [_sanitize(r) for r in rows]
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0
