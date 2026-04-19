---
category: issue
title: "JWT Token 刷新存在竞态条件"
created_at: "2026-04-14T09:15:00Z"
updated_at: "2026-04-14T09:15:00Z"
status: open
---

# JWT Token 刷新存在竞态条件

**问题描述：**
多个并发请求同时触发 token 刷新时，可能产生多个 refresh token 请求，导致服务端逻辑混乱。

**影响范围：**
- 用户频繁切换页面时可能出现 401
- 严重情况下可能导致用户被踢出登录

**修复方案：**
引入 token refresh 的分布式锁机制。
