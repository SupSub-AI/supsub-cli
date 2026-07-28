# `mp` 公众号

用于**发现一个具体的公众号账号**——你想订阅某个号，但手上没有它的 ID。

| 命令 | 功能 |
|---|---|
| `supsub mp search <name>` | 搜索公众号。后台异步任务，CLI 自动等待最长约 30 秒，返回候选列表（含 `mpId` / 名称 / 描述）。`mpId` 可直接用于 `sub add --mp-id` |
| `supsub mp search-cancel <searchId>` | 取消正在执行的公众号搜索任务 |

## 典型流程

```shell
# 1. 搜索，拿到 mpId
supsub mp search "机器之心"

# 2. 用 mpId 订阅（--type 可省，默认 MP）
supsub sub add --mp-id "MzA3MzI4MjgzMw=="
```

## 异步与超时

`mp search` 是异步任务：CLI 会等待约 30 秒。若到时仍未结束，会返回一个 `searchId`，可用它继续跟进或取消：

```shell
supsub mp search-cancel <searchId>
```

## 什么时候**不**该用它

::: warning 搜文章内容请用 `search`
`mp search` 只找账号，不搜文章。按关键词找内容（包括「大模型」「RAG」这类话题词）应该用 [`supsub search`](./search)。
:::
