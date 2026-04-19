# RemX v0.3.0 重构方案

> 重构日期：2026-04-20
> 状态：已完成 ✅

---

## 背景

当前 `remx-core/` 的 `runtime/`、`memory/`、`core/` 三层边界模糊：
- `runtime/triple-store.ts` 只是 `memory/topology.ts` 的转发层，无独立价值
- `runtime/db.ts` 与 `memory/crud.ts` 职责部分重叠
- `memory/` 与 `runtime/` 的定位不清楚

目标：**按数据模型划分，职责清晰，命名成对。**

---

## 现状

```
remx-core/src/
├── cli.ts
├── commands/
│   ├── init.ts
│   ├── parse.ts
│   ├── retrieve.ts
│   ├── relate.ts
│   ├── stats.ts
│   └── gc.ts
├── core/
│   ├── schema.ts
│   ├── storage.ts
│   ├── chunker.ts
│   └── embedder.ts
├── memory/
│   ├── crud.ts         # Memory chunk CRUD（files/chunks 表）
│   ├── topology.ts    # 图遍历 + 三表 CRUD
│   └── recall.ts       # 召回逻辑
└── runtime/
    ├── db.ts           # GC、retrieve（与 memory/crud 部分重叠）
    └── triple-store.ts # 纯转发 → memory/topology
```

---

## 目标状态

```
remx-core/src/
├── cli.ts
├── commands/           # 命令层（不变）
├── core/               # 纯文本处理层（不变）
└── memory/
    ├── memory.ts       # 记忆块的一生（CRUD + 文件 I/O）← 合并自 crud.ts + runtime/db.ts
    ├── graph.ts        # 图结构 + 遍历（三表 CRUD）← topology.ts 改名
    └── recall.ts       # 召回逻辑（不变）
```

**取消：`runtime/` 目录**（功能并入 memory，目录删除）

---

## 阶段划分

### 阶段 0：准备工作

- [x] 创建 `v0.3.0-refactor` 分支
- [x] 备份现有 `src/memory/` 和 `src/runtime/`

### 阶段 1：`memory/graph.ts`（topology → graph）

- [x] 复制 `memory/topology.ts` → `memory/graph.ts`
- [x] 删除 `memory/topology.ts`
- [x] 更新所有 import 引用（`commands/relate.ts` 等）
- [x] 确认编译无错
- [x] commit: "refactor: topology.ts → graph.ts"

### 阶段 2：`memory/memory.ts`（合并 crud + db）

- [x] 将 `runtime/db.ts` 的 GC / retrieve 功能并入 `memory/crud.ts`
- [x] 将 `memory/crud.ts` 改名为 `memory/memory.ts`
- [x] 删除 `runtime/db.ts`
- [x] 更新所有 import 引用
- [x] 确认编译无错
- [x] commit: "refactor: merge crud + db → memory.ts"

### 阶段 3：删除 `runtime/triple-store.ts`

- [x] 删除 `runtime/triple-store.ts`
- [x] 确认无任何 import 引用
- [x] 确认编译无错
- [x] commit: "refactor: remove redundant triple-store forwarding layer"

### 阶段 4：删除 `runtime/` 目录

- [x] 确认 `runtime/` 已空
- [x] 删除 `runtime/` 目录
- [x] commit: "refactor: remove empty runtime/ directory"

### 阶段 5：更新 `memory/recall.ts`

- [x] 检查 `recall.ts` 的 import 路径是否需要更新
- [x] 确认 recall 调用的接口未破坏
- [x] 确认编译无错
- [x] commit: "refactor: update recall.ts imports after restructure"

### 阶段 6：更新单元测试

- [x] 更新 `tests/topology.test.ts` → `tests/graph.test.ts`（文件改名）
- [x] 更新测试中的 import 路径
- [x] 更新 `tests/triple-store.test.ts`（已删除 — 对应模块已移除）
- [x] 运行测试确认全部通过
- [x] commit: "test: update tests after refactor"

### 阶段 7：更新 CLI 测试文档

- [x] 更新 `docs/CLI-TEST-PLAN.md` 中的模块引用路径
- [x] 更新 `docs/ARCHITECTURE-ANALYSIS.md`
- [x] commit: "docs: update CLI test plan and architecture docs"

### 阶段 8：最终验收

- [x] 全量编译 `npm run build` ✅
- [x] 全量测试 `npm test` ✅ 43 tests passed
- [ ] Merge 或 PR

---

## 关键接口变更

| 原路径 | 新路径 | 说明 |
|---|---|---|
| `memory/topology.ts` | `memory/graph.ts` | 改名 |
| `memory/crud.ts` | `memory/memory.ts` | 合并 db.ts 后改名 |
| `runtime/db.ts` | `memory/memory.ts` | GC/retrieve 并入 |
| `runtime/triple-store.ts` | 删除 | 转发层删除 |

---

## 编译验证

```bash
npm run build   # 必须全量编译通过
npm test        # 必须全量测试通过
```

---

## 回滚方案

若任何阶段失败：
```bash
git checkout <上一阶段commit>
git branch -D v0.3.0-refactor
# 从备份重新开始
```
