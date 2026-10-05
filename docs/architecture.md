# 模块、连续性与数据流

DuduLove Memory 的核心不是某一种数据库或检索算法，而是一条 **Resident-Centric Continuity** 数据流：

```text
client / MCP / HTTP
        ↓
authenticated Resident principal
        ↓
live read scope + server-side permissions
        ↓
Resident Context Assembler
   ├─ Identity
   ├─ Association
   ├─ Evidence
   ├─ Work / Ops
   └─ recent activities when applicable
        ↓
current model context
```

写入走另一条受控路径：

```text
client / organizer / agent
        ↓
Memory Admission
        ↓
ownership + lifecycle + provenance + duplicate checks
        ↓
memory store + revision / rejection journal
        ↓
optional embedding index
```

网页、HTTP API 与 MCP 最终使用同一套身份校验、记忆规则和召回核心。不同接口可以拥有不同参数表面，但不应各自发明一套“谁是谁、谁能读什么”的逻辑。

## Resident 是长期主体

Resident 用固定 ID 标识，显示名可以变化。

请求进入服务后，服务端根据连接凭据构造 principal。模型可见的参数不能自行伪造 principal，也不能仅靠提交另一个 owner/resident 参数获得其私人资料。管理连接和受控维护流程拥有独立能力，普通 Resident 连接不会因为模型“说自己是管理员”而升级。

Resident 的读取权限在每次操作时重新解析，因此：

- 已建立的 MCP 会话也会看到后续授权变化；
- `selected` 只读取明确选择的身份；
- `all` 可以覆盖以后新增的身份；
- 读取别人的私人资料不会自动获得修改、整理或活动权限；
- 私人写入仍绑定调用者自己的 Resident。

这让同一个身份可以跨不同客户端继续使用，而不需要把每个前端当成新的记忆主人。

## Surface 与 Runtime 的边界

DuduLove 负责 Resident 的长期连续性，但不要求接管每个客户端的全部运行状态。

聊天窗口、Coding Agent、个人工作台等 Surface 可以拥有自己的 session、工具和临时缓存；终端输出、浏览器状态、文件中间态、凭据和任务日志等 Runtime 数据通常应留在执行环境。只有真正值得跨会话继续使用的结果，才通过 activity、`pulse`、`ops` 或 Memory Admission 进入长期体系。

外部平台如果也提供自己的自动记忆，建议把它视为 Surface-local cache 或待审核候选，而不是未经确认就成为与 DuduLove 同等权威的长期真相源。

具体接入流程与检查项见 [Resident 跨 Surface 接入指南](surfaces.md)。

## 四层资料结构

主要资料层保持少而稳定：

| layer | 作用 |
| --- | --- |
| `world` | 多个 Resident 共用的事实、背景与知识 |
| `private` | 某个 Resident 的私人历史、身份、关系、偏好与长期经验 |
| `pulse` | 近期碎片、临时状态和等待整理的材料 |
| `ops` | 工程、工具、项目与可复用工作经验 |

“候选”“长期有效”“未完”“归档”“拒绝”等变化主要由 lifecycle 表达，而不是不断增加新的资料柜。

常见 lifecycle 包括：

- `inbox`
- `active`
- `core`
- `open_loop`
- `archived`
- `rejected`

内核还支持用于稳定身份召回的角色标记，例如 identity、relationship、boundary、self digest 等。它们是召回语义，不意味着每个角色都必须拥有独立的物理存储区。

## Identity / Association / Evidence

`memory-core/context.js` 负责统一组装 Resident Context。

### Identity

Identity lane 从当前 Resident 自己的长期资料中选择稳定身份、关系、边界和高重要度内容。

它不依赖“当前问题和身份描述是否语义相似”才能出现。对于普通聊天和 awakening，Identity 可以保留比普通关联记忆更完整的正文；工作和任务模式则缩小身份包，避免大量私人历史占用工作上下文。

### Association

Association lane 根据当前 query 在 `world`、`private`、`pulse` 中查找相关材料。工作与维护场景可以额外加入 `ops`。

不同 layer 的结果会交错组合，而不是先让某一个大库把其他层全部挤掉。

### Evidence

当调用场景需要来源证据时，Evidence lane 保留来源关系，用来回答“以前到底记录了什么”“这个结论从哪里来”等问题。

Evidence 不应把调用方随手填写的 source 标签直接当成可信事实。可信来源由 provenance 层解析和验证。

## Recall Ledger

`memory-core/recallLedger.js` 保存轻量的 session 级召回状态，它不是长期人格记忆。

Ledger 记录一条内容最近是否已经浮现、最后出现在哪一轮，并支持：

- cooldown：降低连续几轮重复端出同一条记忆；
- sticky topic：同一话题短时间持续时允许相关材料保持可用；
- session TTL：旧会话状态自动过期。

它解决的是“什么时候再次想起”，而不是“这件事是否永久重要”。

## Memory Admission

长期写入经过 `memory-core/admission.js` 与 `admissionPolicy.js`。

Admission 负责在保存前检查和规范：

- Resident / shared 归属；
- board 与 lifecycle；
- 长期记忆晋升条件；
- source references；
- 重复正文；
- 管理员强制覆盖及其理由；
- 不应写入长期记忆的 runtime / credential 数据。

凭据、cookie、OAuth token、私钥等内容会被拒绝进入长期记忆主链。浏览器状态、任务日志、虚拟电脑状态等运行时字段也不应该被当成人格记忆保存。

对于人格推断一类内容，系统可以把“候选理解”和“已经成为稳定身份的一部分”分开处理，而不是让一次模型推断直接覆盖长期 identity。

## Provenance 与来源权威

`sourceAuthority.js` 和 `provenance.js` 将“调用方提交了 sourceRefs”与“服务端能够证明这个来源存在”区分开。

来源可信度可以来自：

- 当前可读取的 memory resolver；
- 当前 Resident 自己的 conversation/archive resolver；
- 服务端 adapter 签发的 opaque grant；
- 受控 maintenance / migration capability。

opaque grant 不属于模型可见输入，调用方不能通过伪造一个看起来像 sourceRef 的对象自行获得同等信任。

当原始来源被拒绝或失效时，依赖它的派生资料会退出正常可信召回路径；记录本身可以继续留在审计与管理视图中。

## Revision、rejection 与“不会诈尸的纠错”

修改一条记忆不会伪造新的原始记录时间。系统保留 `createdAt`，单独更新 `updatedAt`，并记录 revision history。

拒绝使用单独的 journal / tombstone 语义：

1. 用户拒绝某条记忆或来源；
2. rejection 记录被持久化；
3. 相同正文或相同来源不能被普通整理流程再次 admission；
4. 依赖已拒来源的派生内容不能继续充当可信 Evidence 或正常自动召回依据。

因此，删除和纠错不是“界面上看不见了”，而是会真正影响之后的记忆形成。

## 搜索与可选向量索引

原始记忆先保存，再异步建立可选 embedding 索引。

搜索可以组合：

- 本地关键词；
- 可用时的语义结果；
- Resident 权限与 layer 过滤；
- project / lifecycle / work recall 等结构信息。

Resident scope 在结果参与最终召回前受到服务端约束。语义服务不可用时，系统保留关键词搜索能力，不会因为 embedding 供应商失败而让原始资料不可用。

## 工作召回

工作身份使用 `workRecall.js` 提供更窄的召回配方：

- 自己的工作规则与必要身份边界；
- 与当前 query / project 相关的 private、pulse、world；
- 相关 `ops`；
- 明确记录为 `open_loop` 或 unresolved 的事项；
- 已上报的真实活动结果。

这里的 open loop 是“已经保存的状态”，不是根据普通聊天自动猜出的待办。

工作助手可以被用户授予其他 Resident 的只读权限，但这些资料保留原 owner。读取授权不会变成代写或代删权限。

## 活动与近期简报

活动记录与长期记忆分开，因为“Agent 实际做了什么”不应该仅靠语言模型回忆。

活动使用稳定 `actionId`，状态包括：

- `running`
- `succeeded`
- `failed`
- `unknown`
- `skipped`

后续回执沿用相同 actionId 更新结果。

近期简报按 Resident 生成，并按 `consumerId` 分别维护接收进度。一次真正被某个客户端处理过的简报通过 `snapshotId + runId + ACK` 确认，因此“预览过”和“已经成功消费”是两件不同的事。

如果活动结果仍是 `running` 或 `unknown`，它会继续出现在待核实内容中，而不会被包装成已经完成。

## 资料整理与 source freshness

整理流程可以读取：

- Resident 的 pulse；
- 用户明确选择的 memory；
- 粘贴或导入的聊天文本。

模型先生成可编辑 draft，保存后形成新的 summary memory，同时保留原始材料和 source links。

摘要不是原文替代品。原始来源更新后，旧摘要可以被标记为 stale 并退出自动召回，而原记录仍可搜索和重新整理。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `memory-core` | Resident principal、Admission、召回 lanes、provenance、权限、整理、活动与简报 |
| `storage` | 本地数据文件、关键词与语义检索 |
| `services` | 可重试和幂等写入流程 |
| `routes` | HTTP 参数与响应 |
| `connectors` | MCP 与通用客户端发现 / 绑定接口 |
| `platform` | 服务配置、登录和请求身份 |
| `public` | 管理网页 |
| `tests` | 隔离的真实服务与接口验证 |
| `scripts` | 源码检查与发布包生成 |

## 数据与备份

数据集中在配置目录，包括：

- `memories.db`
- `settings.db`
- `access.json`
- `memory_audit.db`
- `embeddings.db`
- 整理、聊天和简报进度等模块数据

备份应以整个数据目录为单位。身份口令、模型配置和历史记录都属于敏感数据。

## 发布边界

`scripts/files.js` 明确列出允许进入发布包的源码、文档、测试和示例文件。

`npm run pack:release` 会：

1. 运行源码检查；
2. 只打包白名单文件；
3. 重新读取归档清单，确认没有额外文件混入；
4. 生成 SHA-256；
5. 生成发布 manifest。

`data/`、真实 `.env`、数据库、日志和本地归档不会因为“打包当前目录”被顺手带进发布物。

`npm run check` 还会检查语法、依赖方向、循环依赖、文件规模和发布内容。
