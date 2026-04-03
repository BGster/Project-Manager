"""RemX v2 — data-driven project memory management.

Phase 1: CLI engine layer (parse / init / index / gc / retrieve).
"""
__version__ = "0.2.0"

# Re-export command runners for programmatic use
from .commands.parse import run_parse
from .commands.init import run_init
from .commands.index import run_index
from .commands.gc import run_gc
from .commands.retrieve import run_retrieve

# Re-export schema models
from .core.schema import MetaYaml

__all__ = [
    "run_parse",
    "run_init",
    "run_index",
    "run_gc",
    "run_retrieve",
    "MetaYaml",
]
