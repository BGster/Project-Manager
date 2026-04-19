---
category: knowledge
title: "JWT 工作原理"
created_at: "2026-04-08T11:00:00Z"
updated_at: "2026-04-08T11:00:00Z"
status: open
---

# JWT 工作原理

JWT（JSON Web Token）由三部分组成：

1. **Header**：包含算法和类型
2. **Payload**：包含声明（claims）
3. **Signature**：签名，验证数据完整性

JWT 是无状态的，适合分布式系统的认证场景。
