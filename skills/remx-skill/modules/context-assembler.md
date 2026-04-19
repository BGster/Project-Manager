# ContextAssembler

将 `remx retrieve` 的检索结果组装成 LLM 可直接使用的上下文文本。**只读不写。**

---

## 核心职责

- 接收查询意图（自然语言问题或结构化 filter）
- 构造合适的 `remx retrieve` 命令（过滤模式或语义模式）
- 将 JSON 结果格式化为连贯的上下文文本
- 返回给 Agent 用于生成回答

---

## 操作接口

### `assemble(query, options?) → string`

**触发场景：** Agent 分析上下文时自动调用，无需用户提醒。

```bash
# 语义模式（推荐，自动判断意图）
remx retrieve \
  --db "$REMX_DB" \
  --meta "$REMX_META" \
  --query "认证模块是怎么实现的" \
  --limit 10 \
  --decay-weight 0.3

# 过滤模式
remx retrieve \
  --db "$REMX_DB" \
  --filter '{"category":"demand","status":"open"}' \
  --limit 20
```

**返回值格式：**
```
## 记忆上下文（{count} 条）

[{chunk 1 标题}]
{chunk 1 正文}

---

[{chunk 2 标题}]
{chunk 2 正文}

---

...
```

### `by_category(category, options?) → string`

**触发场景：** 显式指定 category 检索。

```bash
remx retrieve --db "$REMX_DB" --filter "{\"category\":\"demand\"}" --limit 50
```

### `by_filter(filter_json, options?) → string`

**触发场景：** 高级场景，直接传 filter JSON。

```bash
remx retrieve --db "$REMX_DB" --filter '{"category":"issue","priority":"P0","status":"open"}' --limit 20
```

---

## 过滤条件参考

| filter 条件 | 说明 |
|------------|------|
| `{"category": "demand"}` | 所有设计决策 |
| `{"category": "demand", "status": "open"}` | 进行中的决策 |
| `{"category": "issue", "type": "bug"}` | 所有 bug |
| `{"category": "knowledge"}` | 知识积累 |
| `{"deprecated": 0}` | 未废弃的记忆 |
| `{"category": "tmp", "status": "open"}` | 活跃的临时记忆 |

---

## 上下文组装策略

### 截断策略

若所有 chunks 的 token 数超过 LLM context 预留空间（建议 ≤ 8k tokens），按优先级截断：

1. 最新创建的排前面（`created_at` 降序）
2. chunk 内嵌的 heading 层级越高越重要
3. 用户 query 中关键词匹配度越 高越重要

### 多 chunk 拼接规则

- 同一个 memory 的多个 chunks：按 `chunk_id` 中的 `chunk_index` 升序拼接，chunk 之间用 `\n\n---\n\n` 分隔
- 不同 memory 之间：按 `created_at` 降序排列（最新的在前），memory 之间用 `\n\n=======\n\n` 分隔

---

## 降级处理

| 场景 | 降级行为 |
|------|---------|
| `remx retrieve` 返回空 | 返回空字符串（不代表错误）|
| vec0 扩展不可用 | `remx retrieve --filter` 仍可用（文本过滤）|
| ollama 不可用（`--query` 模式）| 降级为 `--filter` 模式的文本搜索 |
| `remx retrieve` 超时 | 返回空字符串 |

---

## 错误处理

| 场景 | 返回 |
|------|------|
| 数据库不存在 | 空字符串（Agent 自行判断"RemX 未初始化"）|
| filter JSON 格式错误 | 空字符串 + 警告日志 |
| 零结果 | 空字符串 |

---

## 使用示例

### 场景 1：Agent 讨论项目架构时自动召回

```
用户: "认证模块的方案是怎么考虑的"
→ Agent 调用 assemble("认证模块 方案", {category: "demand"})
→ 返回相关记忆上下文
→ Agent 自然引用这些记忆回答
```

### 场景 2：会话开始时检查快过期记忆

```bash
remx gc --db "$REMX_DB" --dry-run
```

---

## 与 MemoryManager 的协作

```
MemoryManager 分析上下文
    ↓ 判断需要召回记忆
ContextAssembler.assemble()
    ↓ 返回格式化上下文
MemoryManager 将上下文注入 Agent prompt
    ↓
Agent 生成回答
```
