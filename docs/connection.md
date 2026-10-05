# HTTP 与 MCP 接入

先在管理网页建立身份，再到「身份与连接」复制它的专属连接。把同一份连接用于不同客户端，即可使用同一身份的记忆。

本地默认地址为 `http://127.0.0.1:8787`。跨设备使用实际部署的 HTTPS 地址。

## HTTP API

请求附带 `Authorization: Bearer <身份口令>`。JSON 请求使用 `Content-Type: application/json`。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/v2/residents` | 查看当前连接的身份 |
| `POST /api/v2/memories` | 保存 `{title, content, board}` |
| `POST /api/v2/memories/search` | 查询 `{query, board?, ownerLibrary?, limit?}` |
| `GET /api/v2/memories/:id` | 读取完整记忆 |
| `PATCH /api/v2/memories/:id` | 编辑，建议携带 `expectedUpdatedAt` |
| `GET /api/v2/memories/:id/history` | 查看编辑历史 |
| `DELETE /api/v2/memories/:id` | 移入回收站 |
| `POST /api/v2/memories/:id/restore` | 恢复 |
| `POST /api/v2/context/assemble` | 根据 `{query, projectId?, limitTokens?}` 召回上下文 |

日常记录使用 `board: "pulse"`，长期记忆使用 `"private"`。碎片明确传 `shared: true` 才进入共享区。工作身份可用 `ownerLibrary` 筛选获准查阅的身份；所有请求都以连接口令确定调用者身份。

创建时可传 `requestId`，重试相同请求会返回同一条记录。编辑冲突返回 HTTP 409，应重新读取最新内容后处理。400 表示参数无效，401 表示连接无效，403 表示当前权限不足，404 表示记录不存在。

运行 [HTTP 示例](../examples/http-agent.mjs)需要环境变量 `MEMORY_API` 与 `MEMORY_TOKEN`：

```sh
npm run example:http -- "要查找的话题"
```

默认只搜索和召回。附加 `--save-demo` 会明确保存一条示例记忆。

## MCP（Streamable HTTP）

在支持远程 MCP 的客户端填写 `/mcp` 地址和身份 Bearer 口令。接受 `mcpServers`、`url` 和 `headers` 的客户端可使用以下配置结构：

```json
{
  "mcpServers": {
    "memory": {
      "url": "https://memory.example/mcp",
      "headers": {"Authorization": "Bearer YOUR_IDENTITY_TOKEN"}
    }
  }
}
```

管理网页可以生成并复制当前身份的配置。仅接受网址的客户端可使用「复制 MCP 专属链接」，链接中含身份口令，应按密码保管。能配置请求头时优先采用 Bearer 方式。具体配置文件位置及字段以客户端支持的格式为准。

## MCP（stdio）

接受本地命令的客户端可启动 `node /absolute/path/to/mcp-stdio.js`，为该进程设置 `MEMORY_API=https://memory.example` 和 `MCP_TOKEN`。它把调用转发到同一个记忆服务。

主要工具为 `get_briefing`、`search_memory`、`get_memory`、`save_memory`、`update_memory`、`delete_memory`、`restore_memory`。近期简报、活动和整理工具见[使用流程](organization.md)。

## 管理客户端

用户自己的资料管理客户端可以使用管理连接。它可列出身份、添加身份、改名和调整授权：

- `POST /api/v2/residents`：`{label, recallProfile: "companion" | "work"}`。
- `POST /api/v2/residents`：传入已有 `id` 和新的 `label` 改名。
- `PATCH /api/v2/residents/:id/profile`：更新 `recallProfile` 或 `readAccess`。
- `POST /api/v2/residents/:id/connection`：取得身份连接。

`readAccess` 为 `{mode: "self" | "selected" | "all", residentIds: []}`。管理连接负责用户操作，身份连接交给相应 Agent；查看[客户端身份选择流程](client-api.md)。
