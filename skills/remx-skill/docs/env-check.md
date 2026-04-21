# RemX 环境检测

在安装或调试之前，先检查当前环境是否满足要求。

---

## 检测项目

### 1. sqlite-vec（向量检索扩展）

sqlite-vec 是 remx 语义检索的底层依赖，通过 npm 安装。

**自动检测脚本：**

```bash
# ─── 系统信息检测 ───────────────────────────────────────────────
DETECT_OS=$(uname -s)        # Linux | Darwin | Windows
DETECT_ARCH=$(uname -m)      # x86_64 | arm64 | aarch64

# ─── npm 包检测 ────────────────────────────────────────────────
# 检查 sqlite-vec 是否已安装
if npm list -g sqlite-vec &>/dev/null; then
  echo "✅ sqlite-vec 已安装"
  npm list -g sqlite-vec --depth=0
else
  echo "❌ sqlite-vec 未安装"
fi

# ─── 加载状态检测 ───────────────────────────────────────────────
# 检查 SQLite 是否能加载 vec0 扩展（语义检索必需）
# 运行: node -e "const db = require('better-sqlite3')(':memory:'); db.enableLoadExtension(true); db.loadExtension('...');"
# vec0 加载成功 = sqlite-vec 安装正确
```

**系统与芯片架构对应表：**

| OS | Chip | npm 包 | 典型环境 |
|----|------|--------|---------|
| `Linux` | `x86_64` | `sqlite-vec` | Ubuntu / Debian / WSL2 |
| `Linux` | `aarch64` | `sqlite-vec`（Linux arm64 build）| AWS Graviton / 树莓派 |
| `Darwin` | `x86_64` | `sqlite-vec` | Intel Mac |
| `Darwin` | `arm64` | `sqlite-vec`（macOS arm64 build）| Apple Silicon M1/M2/M3 |

**检测逻辑（伪代码）：**

```
if npm list -g sqlite-vec 失败:
    → 报告: sqlite-vec 未安装
else if sqlite-vec vec0 扩展加载失败:
    → 报告: sqlite-vec 安装异常（包/平台不匹配）
else:
    → 报告: sqlite-vec 环境正常
```

---

### 2. meta.yaml 配置文件

remx CLI 的配置文件路径通过 `REMX_META` 环境变量指定，或在命令中显式传递 `--meta`。

**必需字段检测：**

```bash
# 使用 remx parse 验证配置格式
remx parse --meta /path/to/meta.yaml
```

`remx parse` 输出 JSON 格式的配置内容，若格式有误则报错退出（非零返回码）。

**完整配置的必需字段（yaml 结构）：**

```yaml
# ─── index_scope ──────────────────────────────────────────────
# 定义哪些路径下的文件算作项目记忆
index_scope:
  - "memory/"           # 相对路径，以项目根目录为基准
  - "docs/"
  - "demands/"
  - "issues/"

# ─── embedder ─────────────────────────────────────────────────
# 向量嵌入配置（语义检索必需）
embedder:
  provider: ollama        # 当前仅支持 ollama
  model: bge-m3          # 推荐模型
  dimensions: 1024        # 向量维度（必须与模型一致）
  # base_url 可选，默认 http://localhost:11434

# ─── decay_groups ─────────────────────────────────────────────
# 记忆衰减规则（category → 衰减策略）
decay_groups:
  tmp:
    function: ttl
    ttl_hours: 24
  demand:
    function: stale_after
    stale_after_hours: 168
  issue:
    function: stale_after
    stale_after_hours: 720
  knowledge:
    function: never
  principle:
    function: ttl
    ttl_hours: 8760

# ─── chunk（可选）──────────────────────────────────────────────
chunk:
  strategy: heading       # heading | paragraph，默认 heading
```

**检测判定：**

| 检测项 | 通过条件 |
|--------|---------|
| `remx parse --meta <path>` 退出码 | `0`（格式合法，可解析）|
| `index_scope` | 至少一个路径条目 |
| `embedder` | 包含 `provider`/`model`/`dimensions` |
| `decay_groups` | 包含至少一个 category 规则 |

---

## 完整检测脚本

```bash
#!/usr/bin/env bash
set -e

echo "=== RemX 环境检测 ==="
echo

# ─── 系统信息 ─────────────────────────────────────────────────
echo "系统: $(uname -s) $(uname -m)"

# ─── sqlite-vec 检测 ───────────────────────────────────────────
echo
echo "--- sqlite-vec ---"
if npm list -g sqlite-vec &>/dev/null; then
  echo "✅ sqlite-vec 已安装"
  npm list -g sqlite-vec --depth=0 | grep sqlite-vec
else
  echo "❌ sqlite-vec 未安装"
  echo "   → 运行: npm install -g sqlite-vec"
fi

# ─── meta.yaml 检测 ────────────────────────────────────────────
echo
echo "--- meta.yaml ---"
if [ -z "$REMX_META" ]; then
  echo "⚠️  REMX_META 未设置，跳过 yaml 检测"
else
  echo "配置文件: $REMX_META"
  if [ -f "$REMX_META" ]; then
    if remx parse --meta "$REMX_META" &>/dev/null; then
      echo "✅ meta.yaml 格式正确"
    else
      echo "❌ meta.yaml 格式有误"
      remx parse --meta "$REMX_META" 2>&1 || true
    fi
  else
    echo "❌ meta.yaml 文件不存在: $REMX_META"
  fi
fi

echo
echo "=== 检测完成 ==="
```
