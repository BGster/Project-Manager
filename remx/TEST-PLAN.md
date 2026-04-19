# RemX Plugin Test Plan

**Date:** 2026-04-19
**Status:** Updated for v2 semantic autonomous behavior
**Plugin:** remx (id: remx, path: /home/claw/RemX/remx-skill)

---

## Hook 选择测试结论（2026-04-19）

### 测试过的 Hook

| Hook | 可用性 | 原因 |
|------|--------|------|
| `message_received` | ⚠️ 部分 | QQ 消息能触发，但 Web UI/内部消息不触发 |
| `message_sent` | ❌ 不可用 | QQ 发送走 gateway 直发路径，不触发 `message_sent` |
| `before_prompt_build` | ✅ 可用 | 每次 LLM 推理前触发，返回 `prependContext` 可注入 prompt |
| `agent_end` | ✅ 可用 | 每次 LLM 推理完成后触发，无返回值，只能做事后处理 |

### 结论

- **最终选择：`before_prompt_build`** — 每次推理前触发，能访问 `event.prompt`，能返回 `prependContext` 注入召回的记忆内容
- `agent_end` 保留为候选 — 可用于事后判断（如决定是否写入新记忆），但不参与 prompt 注入
- `message_received/sent` 放弃 — channel 层面差异大，QQ 不走标准 delivery 流程

### 关键调试经验

1. **注册方式要正确**：用 `api.on("hookName", handler)` 而非旧的 `api.registerHook()`（后者注册到 `registry.hooks`，不被调用）
2. **日志推断 > 文档猜测**：遇到 hook 不触发的问题，加日志、重现，比查文档更快定位
3. **channel 差异**：hook 是否触发取决于 channel 实现，不是框架问题。QQ 发送不走 `message_sent` 是 channel 层面设计，不是 bug
4. **注入位置选择**：`event.messages.push()` 对 prompt 的影响取决于 channel；`prependContext` 是标准化的 prompt 注入方式
5. **短路逻辑**：简单消息（如"你好"）可能绕过 LLM 推理，导致 `agent_end` 不触发

---

## Core Behavior Change (v1 → v2)

| | v1（触发词） | v2（语义自主） |
|--|------------|--------------|
| 召回触发 | 必须说「之前」「我记得」 | 任何涉及项目内容的讨论 |
| 创建触发 | 必须说「记住」「决定」 | 任何有意义的新决策/结论/方案 |
| 用户感知 | 弹卡片提示 | 回答末尾一行摘要 |
| Hook 判断 | 关键词匹配 | 语义相关性 + 记忆价值分析 |

---

## Setup Verification

```bash
cat ~/.openclaw/openclaw.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('plugins:', list(d.get('plugins',{}).get('entries',{}).keys())); print('hook loads:', d.get('hooks',{}).get('internal',{}).get('load',{}))"
```

Expected:
```json
plugins: ["duckduckgo", "minimax", "github-copilot", "remx"]
hook loads: {"extraDirs": ["/home/claw/RemX/remx-skill"], "paths": ["/home/claw/RemX/remx-skill"]}
```

---

## Test Cases

### TC-1: Plugin Registration
**Command:** `openclaw plugins list`
**Expected:** `remx` listed (format: native, hooks: 1)

---

### TC-2: Hook Discovery
**Command:** `openclaw hooks list`
**Expected:** `remx` listed with events `message:received`, `message:sent`

---

### TC-3: Gateway Startup
**Command:** `openclaw gateway restart`
**Expected:** No errors, remx plugin loaded

---

### TC-4: Semantic Recall — No Trigger Words
**Setup:** 先创建一些记忆（用 `remx index` 或直接写入）

**Test messages（不说「之前」「记住」）：**
- "我们这个项目用的什么数据库来着？"
- "认证模块当时为什么选 JWT？"
- "这个接口的设计思路是什么？"

**Expected:** 
- Agent 自然回答（引用了记忆内容）
- 回答末尾有 `📚 召回: ...` 行

---

### TC-5: Semantic Create — No Trigger Words
**Test messages（不说「记住」「决定」）：**
- "我们最后决定用 Postgres 作为主数据库"
- "认证方案定了，是 OAuth2 + JWT"
- "这个问题我们达成了一致：用事件溯源"

**Expected:**
- 新记忆被静默创建
- 回答末尾有 `🆕 新建: ...` 行
- `remx retrieve` 能查到新记忆

---

### TC-6: Agent Output — Auto-Capture Decisions
**Action:** 向 Agent 提问让它产出决策/结论

**Test:**
1. 问 Agent：「为什么我们系统用微服务架构？」
2. 或者让 Agent 分析问题并给出结论

**Expected:**
- Agent 输出有决策/结论
- 回答末尾有 `🆕 新建: ...` 行（如果是新内容）

---

### TC-7: Topic Continuation
**Setup:** 之前的对话提到了某个具体模块/方案

**Test:**
- 继续讨论同一个话题，但不重复背景

**Expected:**
- Hook 识别 topic 延续，主动召回之前相关记忆
- Agent 回答时自然引用上下文

---

### TC-8: No False Positives on Small Talk
**Test messages：**
- "你好"
- "谢谢！"
- "好的"
- "在吗？"

**Expected:** 回答末尾**无**记忆摘要行（不触发任何记忆操作）

---

### TC-9: Correction Updates Existing Memory
**Setup:** 某条记忆存在

**Test:**
- 告诉 Agent 一个和现有记忆不同的做法

**Expected:**
- 回答末尾有 `🔄 更新: ...` 行

---

## Success Criteria

- [ ] TC-1: `remx` in `openclaw plugins list`
- [ ] TC-2: `remx` hook with both events in `openclaw hooks list`
- [ ] TC-3: Gateway starts without errors
- [ ] TC-4: 项目相关问题触发召回，末尾有摘要
- [ ] TC-5: 新决策/结论触发静默创建，末尾有摘要
- [ ] TC-6: Agent 决策输出触发创建
- [ ] TC-7: Topic 延续时召回相关记忆
- [ ] TC-8: 闲聊不触发记忆操作
- [ ] TC-9: 修正触发更新操作

---

## Config

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "remx": {
          "enabled": true,
          "minContentLength": 30,
          "dbPath": "~/.openclaw/remx/remx.db",
          "metaPath": "~/.openclaw/remx/meta.yaml",
          "skipEmbed": true
        }
      }
    }
  }
}
```
