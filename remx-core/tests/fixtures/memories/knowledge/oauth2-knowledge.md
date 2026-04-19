---
category: knowledge
title: "OAuth2 四种授权模式"
created_at: "2026-04-09T16:00:00Z"
updated_at: "2026-04-09T16:00:00Z"
status: open
---

# OAuth2 四种授权模式

1. **Authorization Code**：最安全，适合服务端应用
2. **Implicit**：已不推荐使用
3. **Password Credentials**：适合受信任的第一方应用
4. **Client Credentials**：机器对机器通信

我们选择 Authorization Code + PKCE 模式。
