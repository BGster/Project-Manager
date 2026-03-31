"""Project-Manager CLI - personal project memory management."""
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from .commands.add import (
    add_demand,
    add_issue,
    add_knowledge,
    add_log,
    add_principle,
    add_tmp,
)
from .commands.init import init_user
from .config import Config
from .db import get_memory_by_id, list_memories, search_memories
from .embedding import create_embedder, get_embedding
from .gc import gc_expired_files, lazy_gc

app = typer.Typer(name="pm", add_completion=False)
console = Console()

DEFAULT_CONFIG = ".pm.yaml"


@app.callback(invoke_without_command=True)
def main_callback(
    ctx: typer.Context,
    config: str = DEFAULT_CONFIG,
):
    """Project-Manager CLI - run any command. Lazy GC runs on every call."""
    config_path = Path(config).resolve()

    # Lazy GC on every call (10% probability)
    if config_path.exists():
        try:
            cfg = Config.load(config_path)
            user_id = cfg.user.id
            if user_id:
                root = config_path.parent.resolve()
                tmp_dir = root / user_id / "tmp"
                lazy_gc(tmp_dir, probability=0.1)
        except Exception:
            pass


@app.command()
def version():
    """Show version."""
    console.print("[bold green]pm[/bold green] v0.1.0")


@app.command()
def init(
    user: str = typer.Option(..., "--user", help="Username to initialize"),
    config: str = DEFAULT_CONFIG,
    force: bool = typer.Option(False, "--force", help="Force reinitialize"),
):
    """Initialize project structure for a user."""
    config_path = Path(config).resolve()
    init_user(user, config_path, force=force)


@app.command("log")
def log(
    content: str = typer.Option(..., "--content", help="Log content"),
    date: Optional[str] = typer.Option(None, "--date", help="Date (YYYY-MM-DD)"),
    config: str = DEFAULT_CONFIG,
):
    """Add a daily development log entry."""
    config_path = Path(config).resolve()
    add_log(config_path, content, date)


@app.command("demand")
def demand(
    content: str = typer.Option(..., "--content", help="Demand/task description"),
    priority: str = typer.Option("P2", "--priority", help="Priority P0-P3"),
    status: str = typer.Option("open", "--status", help="Status"),
    title: Optional[str] = typer.Option(None, "--title", help="Title"),
    extension: str = typer.Option("{}", "--extension", help="JSON extension"),
    config: str = DEFAULT_CONFIG,
):
    """Create a demand/task."""
    config_path = Path(config).resolve()
    add_demand(config_path, content, priority, status, title, extension)


@app.command("issue")
def issue(
    content: str = typer.Option(..., "--content", help="Issue description"),
    priority: str = typer.Option("P2", "--priority", help="Priority P0-P3"),
    status: str = typer.Option("open", "--status", help="Status"),
    type: str = typer.Option("bug", "--type", help="Type: bug/risk/question"),
    extension: str = typer.Option("{}", "--extension", help="JSON extension"),
    config: str = DEFAULT_CONFIG,
):
    """Create an issue or risk."""
    config_path = Path(config).resolve()
    add_issue(config_path, content, priority, status, type, extension)


@app.command("principles")
def principles(
    content: str = typer.Option(..., "--content", help="Principle or ADR content"),
    type: str = typer.Option("principle", "--type", help="Type: principle/adr"),
    status: str = typer.Option("active", "--status", help="Status: active/superseded"),
    extension: str = typer.Option("{}", "--extension", help="JSON extension"),
    config: str = DEFAULT_CONFIG,
):
    """Add a development principle or ADR."""
    config_path = Path(config).resolve()
    add_principle(config_path, content, type, status, extension)


@app.command("knowledge")
def knowledge(
    content: str = typer.Option(..., "--content", help="Knowledge content"),
    title: Optional[str] = typer.Option(None, "--title", help="Title"),
    tags: str = typer.Option("", "--tags", help="Comma-separated tags"),
    type: str = typer.Option("note", "--type", help="Type: note/doc/reference"),
    extension: str = typer.Option("{}", "--extension", help="JSON extension"),
    config: str = DEFAULT_CONFIG,
):
    """Add a knowledge entry."""
    config_path = Path(config).resolve()
    add_knowledge(config_path, content, title, tags, type, extension)


@app.command("tmp")
def tmp(
    content: str = typer.Option(..., "--content", help="Temporary note content"),
    ttl: int = typer.Option(24, "--ttl", help="Time to live in hours"),
    config: str = DEFAULT_CONFIG,
):
    """Add a temporary note (auto-expires after TTL)."""
    config_path = Path(config).resolve()
    add_tmp(config_path, content, ttl)


@app.command("list")
def list_cmd(
    category: Optional[str] = typer.Option(None, "--category", help="Filter by category"),
    user: Optional[str] = typer.Option(None, "--user", help="Filter by user"),
    status: Optional[str] = typer.Option(None, "--status", help="Filter by status"),
    limit: int = typer.Option(50, "--limit", help="Max results"),
    config: str = DEFAULT_CONFIG,
):
    """List memory entries."""
    config_path = Path(config).resolve()
    if not config_path.exists():
        console.print("[red]Error: Not initialized. Run 'pm init --user <name>' first.[/red]")
        return

    cfg = Config.load(config_path)
    root = config_path.parent.resolve()
    db_path = root / "memory.db"

    user_id = user or cfg.user.id

    rows = list_memories(db_path, category, user_id, status, limit)

    if not rows:
        console.print("[dim]No results found.[/dim]")
        return

    table = Table(title="Memories")
    table.add_column("ID", style="cyan")
    table.add_column("Category", style="magenta")
    table.add_column("Title", style="bold")
    table.add_column("Priority", style="yellow")
    table.add_column("Status")
    table.add_column("User")

    for r in rows:
        table.add_row(
            r.get("id", ""),
            r.get("category", ""),
            (r.get("title") or "")[:50],
            r.get("priority") or "-",
            r.get("status") or "-",
            r.get("user_id") or "share",
        )

    console.print(table)
    console.print(f"[dim]{len(rows)} result(s)[/dim]")


@app.command("search")
def search(
    query: str = typer.Option(..., "--query", help="Search query"),
    category: Optional[str] = typer.Option(None, "--category", help="Filter by category"),
    limit: int = typer.Option(10, "--limit", help="Max results"),
    config: str = DEFAULT_CONFIG,
):
    """Semantic search over memories using vector embeddings."""
    config_path = Path(config).resolve()
    if not config_path.exists():
        console.print("[red]Error: Not initialized.[/red]")
        return

    cfg = Config.load(config_path)
    root = config_path.parent.resolve()
    db_path = root / "memory.db"

    embedder = create_embedder(
        provider=cfg.embedder.provider,
        model=cfg.embedder.model,
        dimension=cfg.embedder.dimension,
        ollama_base_url=cfg.embedder.ollama_base_url,
        ollama_timeout=cfg.embedder.ollama_timeout,
        openai_api_key=cfg.embedder.openai_api_key,
        openai_model=cfg.embedder.openai_model,
    )

    if embedder is None:
        console.print("[yellow]Embedder not available. Falling back to text search.[/yellow]")

    embedding = get_embedding(embedder, query, cfg.embedder.dimension)

    rows = search_memories(db_path, embedding, category=category, top_k=limit)

    if not rows:
        console.print("[dim]No results found.[/dim]")
        return

    table = Table(title=f"Search: {query}")
    table.add_column("ID", style="cyan")
    table.add_column("Category", style="magenta")
    table.add_column("Title", style="bold")
    table.add_column("Score", style="dim")

    for r in rows:
        score = r.get("score")
        score_str = f"{score:.4f}" if score is not None else "-"
        table.add_row(
            r.get("id", ""),
            r.get("category", ""),
            (r.get("title") or "")[:60],
            score_str,
        )

    console.print(table)
    console.print(f"[dim]{len(rows)} result(s)[/dim]")


@app.command("get")
def get(
    id: str = typer.Argument(..., help="Memory ID"),
    config: str = DEFAULT_CONFIG,
):
    """Get a memory entry by ID."""
    config_path = Path(config).resolve()
    if not config_path.exists():
        console.print("[red]Error: Not initialized.[/red]")
        return

    root = config_path.parent.resolve()
    db_path = root / "memory.db"

    row = get_memory_by_id(db_path, id)
    if not row:
        console.print(f"[red]Memory '{id}' not found.[/red]")
        return

    from .storage import read_front_matter
    from pathlib import Path as P

    fp = root / row["file_path"]
    fm, body = read_front_matter(fp) if fp.exists() else ({}, row.get("content", ""))

    console.print(f"\n[bold cyan]{row.get('title', id)}[/bold cyan]")
    console.print(f"[dim]ID: {row['id']} | Category: {row['category']} | Status: {row['status']}[/dim]")
    if row.get("priority"):
        console.print(f"[dim]Priority: {row['priority']}[/dim]")
    console.print()
    console.print(body[:500] + ("..." if len(body) > 500 else ""))


if __name__ == "__main__":
    app()
