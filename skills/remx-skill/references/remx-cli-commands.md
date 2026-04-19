# RemX CLI 命令速查（TypeScript 版本）

> 本文档为 remx-skill 编写，为 Skill 层提供所有 CLI 命令的精确调用规范。
> 所有记忆操作必须通过 CLI，禁止直接调用 Python/TypeScript 源码。

## 环境要求

```bash
# remx CLI 已安装（通过 npm install -g 或 local node_modules）
which remx || node /path/to/remx-core/dist/cli.js

# 环境变量
export REMX_DB=/path/to/memory.db        # 默认数据库路径
export REMX_META=/path/to/meta.yaml      # 默认 meta.yaml 路径
```

---

## 命令清单

| 命令 | 功能 |
|------|------|
| `remx init` | 初始化数据库 |
| `remx index` | 索引记忆文件 |
| `remx retrieve` | 过滤/语义检索 |
| `remx gc` | 垃圾回收 |
| `remx stats` | 数据库统计 |
| `remx parse` | 验证 meta.yaml |
| `remx relate` | 拓扑关系管理 |

---

## remx init

初始化或重建数据库（创建 `files`/`chunks`/`remx_lifecycle` 表）。

```bash
remx init --db <path> --meta <meta.yaml> [--reset]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--db` | ✅ | SQLite 数据库路径 |
| `--meta` | ✅ | meta.yaml 路径 |
| `--reset` | 否 | 重建模式（清空已有表）|

**输出示例：**
```
[remx] database initialized: /path/to/memory.db (dimensions=1024) (reset)
```

---

## remx index

索引单个记忆文件，自动写入 `files` + `remx_lifecycle` + `chunks`。

```bash
remx index <file> --db <path> --meta <meta.yaml> [--dedup-threshold <float>] [--no-embed]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `<file>` | ✅ | 要索引的文件路径 |
| `--db` | ✅ | 数据库路径 |
| `--meta` | ✅ | meta.yaml 路径 |
| `--dedup-threshold` | 否 | 语义去重阈值（0.0~1.0），默认 0.95 |
| `--no-embed` | 否 | 跳过 embedding（仅索引文本）|

**front-matter 关键字段（决定索引行为）：**

| 字段 | 值 | 行为 |
|------|------|------|
| `category` | `demand`/`issue`/`knowledge`/`principle`/`tmp` | 必填，决定衰减组 |
| `status` | `open`（默认）/ `closed` / `archived` | 控制状态 |
| `status: deprecated` | 特殊值 | 索引时自动软删除（`deprecated=1`）|
| `priority` | `P0`/`P1`/`P2`/`P3` | 可选 |
| `type` | `default`/`bug`/... | 可选 |
| `created_at` | ISO 8601 | 可选，默认当前时间 |
| `expires_at` | ISO 8601 | 可选，由 decay_group 自动计算 |

**输出示例：**
```
remx index: indexed path/to/file.md
  memory_id: path/to/file.md
  category: knowledge
  chunks: 4
  expires_at: 2026-04-25T00:00:00Z
```

**软删除触发：**
```bash
# front-matter 中写 status: deprecated
# 索引时会自动将该记忆的 deprecated 设为 1
```

---

## remx retrieve

过滤模式或语义模式检索记忆。

### 过滤模式

```bash
remx retrieve --db <path> --filter '<json>' [--limit <n>] [--no-embed]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--filter` | ✅ | JSON 过滤条件 |
| `--limit` | 否 | 返回条数，默认 50 |

**filter JSON 示例：**
```json
{"category": "demand"}
{"category": "demand", "status": "open"}
{"category": "issue", "priority": "P0"}
{"deprecated": 0}
```

**输出格式（JSON array）：**
```json
[
  {
    "path": "path/to/file.md",
    "category": "knowledge",
    "priority": "P2",
    "type": "default",
    "status": "open",
    "deprecated": 0,
    "expires_at": null,
    "created_at": "2026-04-08T11:00:00Z",
    "updated_at": "2026-04-19T15:47:10Z",
    "chunk_id": "project::path/to/file.md::0",
    "start_line": 0,
    "end_line": 0,
    "chunk_hash": "e70aaf414d2f21f4",
    "content": "# JWT 工作原理"
  }
]
```

### 语义模式

```bash
remx retrieve --db <path> --meta <meta.yaml> --query '<自然语言>' [--limit <n>] [--decay-weight <float>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--query` | ✅ | 自然语言查询 |
| `--meta` | ✅ | meta.yaml（提供 embedder 配置）|
| `--decay-weight` | 否 | 衰减权重（0.0~1.0），默认 0.3 |
| `--limit` | 否 | 返回条数，默认 50 |

**注意：** 语义模式需要 ollama embedder 正常运行。deprecated=1 的记忆不会出现在结果中。

---

## remx gc

垃圾回收：软删除过期记忆 / 物理清理已废弃记忆。

### 干跑（查看）

```bash
remx gc --db <path> --dry-run
```

**输出示例：**
```
[remx] running dry-run collect...
[remx] expired memories: 0
[remx] deprecated memories: 1
[remx] associated chunks: 5

Deprecated memory IDs:
  tests/fixtures/memories/tmp/meeting-notes-tmp.md (category=tmp)
```

### 执行清理

```bash
remx gc --db <path> --purge
```

**输出示例：**
```
[remx] running purge...
[remx] purged: 1 memories, 5 chunks removed
```

---

## remx stats

显示数据库统计信息。

```bash
remx stats --db <path>
```

**输出格式：**
```
=== RemX Statistics ===
database: /path/to/memory.db
size: 136.0 KB
total memories (active): 3
total memories (deprecated): 1
total chunks: 12

by category:
  knowledge: 2
  tmp: 1
```

---

## remx parse

验证 meta.yaml 配置。

```bash
remx parse --meta <path>
```

**输出：** JSON 格式的配置内容，用于确认 embedder / decay_groups 配置正确。

---

## remx relate

拓扑关系管理（子命令）。

```bash
remx relate <subcommand> --db <path> [options]
```

### 子命令清单

| 子命令 | 功能 |
|--------|------|
| `nodes` | 列出所有拓扑节点 |
| `insert` | 插入拓扑关系 |
| `query` | 查询某节点的关联关系 |
| `graph` | BFS 遍历从某节点出发的关联图 |
| `delete` | 删除拓扑关系 |
| `expand` | 语义结果经拓扑图扩展（stdin）|

### relate nodes

```bash
remx relate nodes --db <path> [--category <cat>] [--limit <n>]
```

**输出：**
```
nodeA [test] Node A chunk text...
nodeB [test] Node B chunk text...
(2 nodes total)
```

### relate insert

```bash
remx relate insert --db <path> --nodes <ids> --rel-type <type> [--roles <roles>] [--context <ctx>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--nodes` | ✅ | 逗号分隔的节点 ID |
| `--rel-type` | ✅ | 关系类型 |
| `--roles` | 否 | 逗号分隔的角色，默认 `cause,effect,...` |
| `--context` | 否 | 上下文标签，默认 `global` |

**关系类型：** `因果关系` `相关性` `对立性` `流程顺序性` `组成性` `依赖性`

**输出：** `rel_id=<number>`

### relate query

```bash
remx relate query --db <path> --node-id <id> [--current-context <ctx>]
```

**输出：** JSON 格式的关系列表。

### relate graph

```bash
remx relate graph --db <path> --node-id <id> [--max-depth <n>] [--current-context <ctx>]
```

**输出：** JSON 格式的 BFS 遍历结果。

### relate delete

```bash
remx relate delete --db <path> --rel-id <id>
```

### relate expand

```bash
cat semantic_results.json | remx relate expand --db <path> [--current-context <ctx>] [--max-depth <n>] [--max-additional <n>]
```

从语义检索结果（JSON array）读取，经拓扑图扩展后返回合并结果。

---

## 路径规范

| 概念 | 说明 |
|------|------|
| **记忆 ID** | 直接使用文件 `path`（相对或绝对路径） |
| **拓扑节点 ID** | 与记忆 ID（path）相同 |
| **chunk_id** | 格式：`{index_scope}::{path}::{chunk_index}`，如 `project::demands/auth.md::0` |

---

## 衰减策略（meta.yaml decay_groups）

| category | decay function | 说明 |
|----------|---------------|------|
| `tmp` | `ttl` 24h | 临时笔记 |
| `demand` | `stale_after` 168h | 设计决策 |
| `issue` | `stale_after` 720h | 问题/bug |
| `knowledge` | `never` | 知识积累（永不过期）|
| `principle` | `ttl` 8760h | 原则规范 |

---

## 错误处理规范

| 场景 | 表现 |
|------|------|
| 数据库不存在 | `SqliteError: no such table` 或 `no such file` |
| vec0 扩展未加载 | `SqliteError: no such module: vec0`（语义检索失败，降级为文本搜索）|
| ollama 不可用 | `--query` 超时，语义检索失败 |
| memory_id 不存在 | `remx relate` FK 约束失败 |

**降级策略：**
- vec0 不可用 → `remx retrieve --filter` 仍可用（文本过滤）
- ollama 不可用 → 语义检索超时，返回空结果
