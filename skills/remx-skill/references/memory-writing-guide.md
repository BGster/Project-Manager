# 记忆写作指南

如何编写能被 RemX 精确切割、语义完整检索的记忆文件。

---

## 核心原则

**每个 H1/H2/H3 标题 = 一个独立语义单元 = 一个 chunk。**

RemX 按 Markdown 标题层级切分文件，每个标题及其后续内容构成一个 chunk。如果标题层级设置正确（`heading_levels: [1, 2, 3]`），每个 chunk 会自然对应一个完整的知识点或主题。

---

## 记忆分块规范

### 1. 每块最大 360 字

记忆文件应按章节拆分，每个 chunk 不超过 360 字（约 500-800 中文字符）。

**超出时的处理：**
- 如果一个 H2/H3 章节超过 360 字，继续往下写直到语义完整，再在下一个 H2/H3 开始新 chunk
- 不要为了强行分块而在段落中间截断

### 2. 标题层级清晰

```
# 第一章 — 架构设计          ← chunk 边界
内容...

## 1.1 认证模块              ← chunk 边界
内容...

### 1.1.1 Token 验证          ← chunk 边界
内容...
```

**原则：**
- H1 = 大章/主题
- H2 = 子模块/功能
- H3 = 具体实现细节
- 不要跳层级（如 H1 后直接 H3）

### 3. 每个 section 长度适中

单个 section 建议在 **150-360 字** 之间。

**太长：** 超过 `max_tokens`（默认 512 tokens）的 section 会被按句子断句，语义可能不完整。

**太短：** 每个句子一个 chunk，信息碎片化。

### 4. 避免长段落

```
# Bad — 3 页内容没有换行
## 认证模块
本模块负责处理用户登录、Token 管理、会话维持等功能。系统使用 JWT Token...

# Good — 多个短段落
## 认证模块

负责处理用户登录、Token 管理、会话维持。

### 登录流程
用户提交凭证，系统验证后生成 JWT Token。

### Token 管理
Token 存储在 httpOnly Cookie 中，有效期 24 小时。
```

---

## 双向链接规范

### 格式

在记忆文件末尾添加与其他相关记忆的双向链接：

```
标题1 <--> 标题2
标题1 <--> 标题3
```

### 链接规则

- **功能记忆块**：最多 3 条双向链接；超出时创建中转记忆块
- **中转记忆块**：链接条数不限，仅用于组织关系
- **稀疏链接**：仅严格依赖关系之间才链接，避免全连接

### 示例

**功能记忆块（auth-decision.md）：**
```markdown
---
category: demand
priority: P1
---
# 认证模块决策

## 概述
使用 JWT Token 方案。

## 方案对比
| 方案 | 优点 | 缺点 |
|------|------|------|
| JWT | 无状态 | 注销困难 |
| Session | 注销简单 | 占用服务器内存 |

## 结论
采用 JWT 方案。

<--> 认证模块架构 <--> JWT 实现细节
```

**中转记忆块（auth-index.md）：**
```markdown
---
category: knowledge
---
# 认证模块索引

本文档用于组织认证相关的所有记忆链接。

<--> 认证模块决策
<--> JWT 实现细节
<--> OAuth2 集成方案
<--> SSO 配置指南
<--> 认证模块测试用例
```

---

## front-matter 规范

每个记忆文件必须包含 front-matter：

```markdown
---
category: demand        # demand | issue | tmp（必填）
priority: P1          # P0/P1/P2（可选）
status: open          # open | in_progress | closed（可选）
type: bug             # 任意字符串（可选）
created_at: "2026-04-01T10:00:00Z"  # ISO 8601（可选，默认当前时间）
---
# 标题
```

**category 说明：**

| 值 | 含义 | 衰减 |
|----|------|------|
| `demand` | 需求、设计决策 | 无 |
| `issue` | 问题、bug | 无 |
| `tmp` | 临时笔记 | TTL=1h（按 decay_groups）|

---

## 命名与路径规范

### 项目记忆（project memory）

放在 `index_scope` 配置的目录下：

```
demands/
  feature-A.md
  feature-B.md
issues/
  bug-01.md
  rfc-01.md
tmp/
  meeting-notes-2026-04.md
```

### 全局记忆（global memory）

放在 `~/notes/` 或任意 `index_scope` 之外的路径：

```
~/notes/
  architecture.md
  api-design.md
```

路径含 `..` 会**被系统拒绝**，无法索引。

---

## 代码块的注意事项

代码块（\`\`\`）会被当作普通内容，包含在所在 chunk 内。如果代码块非常大（超过 `max_tokens`），它会被按换行符断句，可能破坏代码完整性。

**建议：**
- 代码块控制在 100 行以内
- 超出时拆分为多个代码块，分别用 H3/H4 标题说明
- 不在代码块内容内使用 `#` 标题语法（会被误识别为 Markdown 标题）

---

## 重索引

修改文件后重新索引：

```bash
remx index <file> --db ./pm.db --meta ./meta.yaml --no-embed
```

系统会自动删除旧记录（通过 memory_id 去重），不会产生重复。

---

## 示例：一个好的记忆文件

```markdown
---
category: demand
priority: P1
status: open
created_at: "2026-04-01T10:00:00Z"
---
# Feature-A 认证模块

Feature-A 的认证模块负责处理用户登录和会话管理。

## 登录流程

用户提交用户名+密码，后端验证后返回 JWT Token。

### Token 格式

```json
{"sub": "user_id", "exp": 1234567890}
```

Token 有效期 24 小时，存储在 httpOnly Cookie 中。

## 会话维持

每次请求携带 Token，中间件验证签名和有效期。

## 错误处理

认证失败返回 401，Token 过期返回 401 并提示刷新。

<--> JWT 实现细节 <--> 认证模块架构
```

**预期切割结果：**
- chunk 0: `# Feature-A 认证模块` + 概述
- chunk 1: `## 登录流程` + Token 格式
- chunk 2: `## 会话维持`
- chunk 3: `## 错误处理`

---

## 反面例子

```markdown
---
category: demand
---
# 项目说明（太长，没有层级）

本文档描述了整个项目的所有内容blabla...（省略1万字）...项目终于结束了。
```

**问题：**
- 没有标题层级，全部内容在一个 chunk 里
- 超过 `max_tokens` 后被机械断句，语义完全破碎
- front-matter 缺少必填的 `category`
