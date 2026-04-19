---
name: remx
description: "RemX memory hook — analyzes user input AND agent output to auto-recall/create/update memories"
homepage: https://github.com/openclaw/remx
metadata:
  {
    "openclaw": {
      "emoji": "🧠",
      "events": ["message:received", "message:sent"],
      "requires": {
        "config": ["workspace.dir"]
      },
      "install": [
        {
          "id": "bundled",
          "kind": "bundled",
          "label": "Bundled with RemX"
        }
      ]
    }
  }
---

# RemX Memory Hook

Analyzes both **user input** and **agent output** in real-time to:

1. **Auto-recall** relevant memories before agent processes a message
2. **Suggest** creating/updating memories when meaningful content is detected
3. **Monitor** agent output for decisions, conclusions, and key facts worth remembering

## What It Does

### On `message:received` (user input)

1. Extract text content from the user message
2. Run lightweight intent detection (create/update/query/skip)
3. If intent = `query` or memory-relevant keywords detected → push a silent recall notice
4. If intent = `create`/`update` → push a memory suggestion to the user

### On `message:sent` (agent output)

1. Extract text content from the agent response
2. Analyze for memorable content:
   - Contains a **decision**, **conclusion**, or **solution**
   - Explains **why** something works
   - Provides a **factual answer** to a user question
3. If memorable → push a suggestion: "Should I remember this?"

## Event Flow

```
User message received
  → extract content
  → intent detection (MemoryManager.analyzeContent)
  → [query intent]     → push recalled context silently
  → [create/update]   → push memory suggestion card
  → [ignore]          → no action

Agent response sent
  → extract content
  → memorable content detection
  → [memorable]       → push "remember this?" suggestion
  → [ordinary]        → no action
```

## Configuration

Hook config in `~/.openclaw/openclaw.json`:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "remx-memory": {
          "enabled": true,
          "minContentLength": 30,
          "autoRecall": true,
          "notifyOnCreate": true,
          "dbPath": "~/.openclaw/remx/remx.db",
          "metaPath": "~/.openclaw/remx/meta.yaml"
        }
      }
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minContentLength` | number | 30 | Minimum text length to process |
| `autoRecall` | boolean | true | Push recalled context on query intent |
| `notifyOnCreate` | boolean | true | Notify user when create/update detected |
| `dbPath` | string | `~/.openclaw/remx/remx.db` | RemX database path |
| `metaPath` | string | `~/.openclaw/remx/meta.yaml` | RemX meta.yaml path |

## Requirements

- **Config**: `workspace.dir` must be set
- **RemX**: Database initialized via `remx init --db <path> --meta <path>`

## Graceful Degradation

If RemX is not initialized or the database is unavailable, the hook:
- Silently skips memory operations
- Does NOT push any notifications to the user
- Does NOT block or slow down message processing
