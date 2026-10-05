# 客户端连接与身份选择

客户端可以提供一个简单流程：填写记忆服务地址和连接口令 → 检查连接 → 显示已有身份 → 用户选择绑定。

服务提供 `/v1` 接口，用于能力发现、身份选择和分类式资料管理。响应包含 `schemaVersion: 1`，服务有稳定的 `sourceId`。

| 接口 | 返回或行为 |
| --- | --- |
| `GET /v1/health` | 连接状态 |
| `GET /v1/describe` | `sourceId`、能力表、分类 |
| `GET /v1/identities` | `{identities: [{id, displayName}]}` |
| `POST /v1/identities/validate` | 校验 `{identityId}` 是否仍可访问 |
| `GET /v1/categories` | 当前连接可管理的分类 |
| `POST /v1/search` | `{query, categoryIds?, cursor?, limit?}`；返回 `memories` 和 `nextCursor` |
| `GET /v1/memories/:id` | 完整记忆和原始/编辑时间 |
| `POST /v1/memories` | `{categoryId, title, content, metadata?, requestId?}` |
| `PATCH /v1/memories/:id` | `{content?, title?, metadata?, expectedUpdatedAt?}` |
| `DELETE /v1/memories/:id` | 软删除 |
| `POST /v1/memories/:id/restore` | 恢复 |

口令通过 Bearer 请求头传递。命名空间为 `default`。调用能力以 `describe.capabilities` 为准；未支持的操作返回 501，响应同时带 `code` 和可显示的 `message`。

身份连接列出本人；用户管理连接可列出全部身份。客户端持管理连接时，通过 `actor: {kind: "resident", id: "选中的固定ID"}` 发起所选身份的请求。GET 请求使用 `actorKind=resident&actorId=...`。管理操作使用 `actor: {kind: "user", id: "operator"}`。

身份口令始终限于本人的身份，`actor` 字段须与之相符。让模型操作资料时优先使用该身份自己的口令。管理口令保存在用户可信的管理环境。

分类包括 `private:<id>`、`pulse:<id>`，以及共享的 `world`、`pulse`、`ops`。选中身份的列表绑定保存 `{sourceId, identityId}`，显示名可随时更新。工作助手读取其他身份资料的授权由记忆服务实时处理；完整授权配置与上下文召回使用 `/api/v2`。记忆响应的 `permissions` 描述所属身份与当前读取者，实际权限始终由服务端校验。
