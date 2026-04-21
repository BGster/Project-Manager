# RemX 环境准备

---

## 一、sqlite-vec 安装

sqlite-vec 是 remx 语义检索的向量数据库扩展，通过 npm 全局安装。

### 安装命令

```bash
npm install -g sqlite-vec
```

npm 会根据当前系统（OS + 芯片架构）自动选择正确的预编译包。

**系统与芯片对应：**

| OS | Chip | 安装包 | 说明 |
|----|------|--------|------|
| `Linux` | `x86_64` | sqlite-vec（Linux x64）| Ubuntu / Debian / WSL2 |
| `Linux` | `aarch64` | sqlite-vec（Linux arm64）| AWS Graviton / 树莓派 |
| `Darwin` | `x86_64` | sqlite-vec（macOS x64）| Intel Mac |
| `Darwin` | `arm64` | sqlite-vec（macOS arm64）| Apple Silicon M1/M2/M3 |

**手动指定架构（罕见场景）：**

```bash
# 强制安装特定平台版本
npm install -g sqlite-vec --platform=linux --arch=x64
npm install -g sqlite-vec --platform=darwin --arch=arm64
```

**验证安装：**

```bash
npm list -g sqlite-vec --depth=0
# 输出类似: └── sqlite-vec@0.1.x
```

### 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `npm ERR! notsup` | OS/arch 组合无预编译包 | 检查 `uname -s` / `uname -m`，或从源码编译 |
| `SqliteError: no such module: vec0` | vec0 扩展未加载 | 确认 npm 安装成功，或检查 NODE_PATH |

---

## 二、meta.yaml 配置

remx CLI 的配置文件，支持语义检索、衰减策略、索引范围等核心功能的配置。

### 最小可用配置

```yaml
index_scope:
  - "memory/"

embedder:
  provider: ollama
  model: bge-m3
  dimensions: 1024

decay_groups:
  knowledge:
    function: never
  tmp:
    function: ttl
    ttl_hours: 24
```

### 完整配置字段说明

```yaml
# ─── index_scope ──────────────────────────────────────────────
# 定义哪些路径下的文件属于项目记忆（用于 remx index 和检索过滤）
# 支持相对路径（相对于项目根目录）和绝对路径
index_scope:
  - "memory/"              # 项目记忆目录（必需至少一项）
  - "demands/"             # 决策类记忆
  - "issues/"              # 问题类记忆
  - "docs/"
  - "principles/"

# ─── embedder ─────────────────────────────────────────────────
# 向量嵌入配置。语义检索（remx retrieve --query）必需。
embedder:
  provider: ollama          # 向量生成 provider（当前仅支持 ollama）
  model: bge-m3            # Ollama 模型名（需提前 pull）
  dimensions: 1024         # 向量维度（必须与模型输出维度一致）
  # base_url: http://localhost:11434  # 可选，默认 localhost:11434

# ─── decay_groups ─────────────────────────────────────────────
# 记忆衰减策略。控制不同 category 记忆的过期行为。
# 当 meta.yaml 无显式配置时，使用 Skill 内置默认值。
decay_groups:
  # 临时笔记（24 小时后过期）
  tmp:
    function: ttl          # ttl | stale_after | never
    ttl_hours: 24

  # 设计决策（168 小时后变为 stale，不自动删除）
  demand:
    function: stale_after
    stale_after_hours: 168

  # 问题/bug（720 小时后 stale）
  issue:
    function: stale_after
    stale_after_hours: 720

  # 知识积累（永不过期）
  knowledge:
    function: never

  # 原则规范（8760 小时 = 1 年）
  principle:
    function: ttl
    ttl_hours: 8760

# ─── chunk（可选）──────────────────────────────────────────────
# 记忆分块策略
chunk:
  strategy: heading         # heading: 按 H1/H2/H3 标题切分（默认）
                            # paragraph: 按段落切分
  # max_chars: 500          # 可选，每 chunk 最大字符数（paragraph 模式）
```

### 辅助书写规范

**Skill 层应具备的 yaml 辅助能力：**

| 能力 | 说明 |
|------|------|
| **格式验证** | 调用 `remx parse --meta <path>`，非零退出码时报错 |
| **字段完备性检查** | 确保包含 `index_scope`、`embedder`、`decay_groups` 三个根字段 |
| **embedder.dimensions 合理性** | bge-m3 默认 1024，若配置值异常应警告 |
| **decay_groups category 合法性** | 仅允许 `tmp`/`demand`/`issue`/`knowledge`/`principle` |
| **index_scope 路径有效性** | 检查路径是否存在（可跳过，仅提示）|

**yaml 书写辅助脚本示例：**

```bash
# 验证配置格式（CLI 方式）
remx parse --meta /path/to/meta.yaml

# 若想看解析后的完整 JSON（用于调试）
remx parse --meta /path/to/meta.yaml 2>&1 | jq .
```

### 配置文件放置

```bash
# 推荐：放在项目根目录
project/
├── meta.yaml              # remx 配置文件
├── memory.db              # SQLite 数据库（remx init 时生成）
├── memory/                 # 项目记忆目录
├── demands/
├── issues/
└── ...

# 环境变量方式指定（可选）
export REMX_DB=./memory.db
export REMX_META=./meta.yaml
```

### 初始化数据库

```bash
remx init --db ./memory.db --meta ./meta.yaml
```

---

## 三、环境快速启动

```bash
# 1. 安装 sqlite-vec
npm install -g sqlite-vec

# 2. 创建 meta.yaml（使用上方模板）

# 3. 验证配置
remx parse --meta ./meta.yaml

# 4. 初始化数据库
remx init --db ./memory.db --meta ./meta.yaml

# 5. 设置环境变量（可选，简化后续命令）
export REMX_DB=./memory.db
export REMX_META=./meta.yaml

# 6. 索引记忆文件
remx index memory/example.md --db ./memory.db --meta ./meta.yaml

# 7. 验证环境
bash /path/to/env-check.sh
```
