"""Allow `python -m remx` as entry point."""
import sys

# Cache stdin BEFORE typer processes anything
# This prevents stdin from being consumed by shell commands like `source`
_stdin_content: str | None = None
if not sys.stdin.isatty():
    _stdin_content = sys.stdin.read()

from .cli import app, _set_stdin_cache

# Make cached stdin available to CLI module
if _stdin_content is not None:
    _set_stdin_cache(_stdin_content)

app()
