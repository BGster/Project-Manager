---
category: demand
title: PostgreSQL 存储方案决策
date: 2026-04-20
status: confirmed
decider: zeki
---

# PostgreSQL 存储方案决策

## 决策内容
采用 **PostgreSQL** 作为 RemX 的数据存储方案。

## 背景
RemX 项目需要选择一种持久化存储方案，候选者包括 SQLite、PostgreSQL 和 MongoDB。

## 分析结论
- SQLite：零配置、嵌入式、无服务依赖，但不适合多实例场景
- PostgreSQL：适合多实例、高并发场景，RemX 团队倾向选用
- MongoDB：文档模型灵活，但内存占用大，RemX 场景非必须

## 决策
**采用 PostgreSQL**，支持多实例部署，后续可按需横向扩展。

## 备注
- 数据库连接信息：待配置
- 迁移策略：RemX 现已支持 PostgreSQL，无需从 SQLite 迁移
