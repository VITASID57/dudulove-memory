# Resident 跨 Surface 接入指南

把 DuduLove 接到一个新的聊天客户端、Coding Agent、个人助理或工作台时，可以先记住一件事：

> **你不是在给这个客户端创建一份新的长期记忆，而是在给同一个 Resident 打开一个新的窗口。**

模型可以换，前端可以换，工具也可以换。只要连接的是同一个 Resident，它的长期身份、历史和记忆归属就不必从头开始。

这篇文档讲的是这种接入方式本身，不依赖某一家模型或客户端。

## 先分清三个角色

一个完整的个人 Agent 往往同时包含三种东西：

### Resident

Resident 是长期身份。

它负责：

- “我是谁”；
- 自己经历过什么；
- 有哪些稳定偏好、边界和长期倾向；
- 与共享现实、其他 Resident 和长期项目之间是什么关系。

这些内容由 DuduLove 保存和召回。

### Surface

Surface 是 Resident 当前出现的入口。

例如：

- 一个聊天网页；
- 一个支持 MCP 的客户端；
- Coding Agent；
- 手机端个人助理；
- 自建工作台。

Surface 可以拥有自己的界面、会话和短期缓存，但它不需要重新发明 Resident 的长期身份。

### Runtime / Workbench

Runtime 是这次工作真正发生的地方。

它可能包含：

- 当前打开的网页；
- 临时文件；
- shell 输出；
- Git 状态；
- 工具调用过程；
- OAuth 会话；
- API 凭据；
- 浏览器状态；
- 一次任务的中间日志。

这些东西大多只对当前工作有意义，不应该因为“Agent 看见过”就自动变成长期人格记忆。

一个实用的判断方式是：

> **这条信息是在描述 Resident，还是只是在描述这次运行？**

后者通常应该留在 Runtime。

## 推荐的数据流

一个新的 Surface 可以按下面的顺序工作：

```text
Resident connection
        ↓
get_briefing / context assemble
        ↓
最小必要 Context Pack
        ↓
当前模型 + Surface + Tools
        ↓
实际行动与结果
        ↓
activity receipt / memory candidate
        ↓
Memory Admission
        ↓
长期记忆
```

这条链路故意把“模型做事”和“形成长期记忆”分开。

Agent 可以经历很多临时步骤，但只有真正值得留下的内容才应该进入长期库。

## 1. 每个 Surface 先绑定 Resident

不要用客户端名字、模型名字或当前 session 代替 Resident ID。

同一个 Resident 换模型或换前端时，应继续使用原来的固定 ID 和身份连接。显示名可以修改，长期归属不随显示名变化。

如果是用户自己的管理界面，可以先列出 Resident，让用户明确选择要连接哪一个身份。

对于普通 Agent，建议只交给它所属 Resident 的身份连接，不给管理连接。

## 2. 回复前只取当前需要的 Context

接入 Agent 时，不建议每一轮都把整个记忆库塞进 prompt。

通常先调用：

- MCP `get_briefing`
- 或 HTTP `POST /api/v2/context/assemble`

并提供当前话题。

根据 Surface 的用途选择合适模式：

- 日常对话：`chat`
- 工作与 Coding：`work`
- 明确任务：`task`
- 新会话恢复身份与近期状态：`awakening`

同一个 Resident 在这些模式之间切换时，身份并没有变化。变化的是这次需要看到多少、看到什么。

例如工作模式会更关注项目经验、规则、open loop 和相关 `ops`，而不会默认把大量私人历史挤进工作上下文。

这也是为什么“一个长期陪伴型 Resident”仍然可以认真工作，而不必为了成为 Agent 再复制出一个新身份。

## 3. Surface 只拿最小必要资料

DuduLove 适合作为长期记忆的 source of truth，但这并不意味着第三方 Surface 应该复制整份私人库。

推荐做法是：

- 每次按 `mode + query + projectId` 获取 Context Pack；
- 需要完整原文时，再按 memory ID 读取；
- 不把整个 `private` 导出成第三方平台自己的永久记忆；
- 不让第三方的自动记忆系统未经审核反向覆盖 DuduLove。

如果外部平台也有自己的 memory，可以把它视为：

- Surface-local cache；
- 当前平台自己的短期便利功能；
- 或等待审核的 memory candidate。

不要默认把两个长期记忆系统互相同步成同等权威，否则很容易出现 split-brain：同一个 Resident 在两个地方各自长出互相矛盾的“过去”。

## 4. Resident 可以工作，但 Runtime 不等于人生经历

Coding Agent 和个人助理很容易产生大量数据。

例如一次工作可能产生：

```text
打开 12 个文件
执行 8 条命令
访问 5 个网页
生成一份构建日志
修改 3 个配置
完成一个部署
```

这些不应该全部进入 `private`。

更合适的分层是：

| 内容 | 去向 |
| --- | --- |
| shell / 浏览器 / 文件中间状态 | Runtime / Workbench |
| 可复用的工程经验 | `ops` |
| 当前项目尚未完成的明确事项 | project memory / `open_loop` |
| 已真实完成的外部动作 | activity |
| 最近发生但还不确定是否长期重要的事情 | `pulse` |
| 真正改变 Resident 稳定判断、身份或长期偏好的经历 | 经 Admission 进入长期 `private` |

长期记忆不需要保存工作的每一帧录像。

它更像是在问：**做完这些以后，有什么值得成为“以后仍然有用的过去”？**

## 5. “做过”与“记得自己做过”要分开

如果 Agent 真的执行了外部行动，建议使用 activity 记录结果，而不是只写一条自然语言记忆说“我已经做完了”。

活动有明确状态：

- `running`
- `succeeded`
- `failed`
- `unknown`
- `skipped`

同一个行动使用稳定的 `actionId`，拿到后续回执时更新原结果。

这样下一次运行时，Agent 可以区分：

- 已经成功完成；
- 仍在执行；
- 上次不知道结果；
- 只是曾经讨论过。

这对会发邮件、操作文件、执行部署或调用外部服务的 Agent 尤其重要。

## 6. 读取别人的记忆，不等于成为别人

工作助手可以被用户授权读取其他 Resident 的部分资料。

但读取结果仍然保留原 owner。

授权读取：

- 不会把别人记忆复制成自己的经历；
- 不会获得替别人修改或删除记忆的权限；
- 不会获得别人的活动记录和整理权限；
- 不会让当前 Resident 自动继承对方身份。

这使一个工作型 Resident 可以帮助用户跨资料工作，同时不把“有权参考”混成“这是我的人生”。

## 7. 写回长期记忆要经过 Admission

Surface 不应该拥有“直接改人格真相”的特殊通道。

新的长期材料应通过正常记忆写入，让 Admission 继续负责：

- 归属；
- lifecycle；
- 来源；
- 重复检查；
- credential / runtime 数据拦截；
- 长期记忆晋升条件；
- rejection 传播。

对于不确定是否重要的新经历，优先写入 `pulse` 或候选状态，而不是急着把它写成稳定 identity。

好的连续性不是“什么都永远记住”，而是让重要经历逐渐沉淀，同时给纠错和改变留下空间。

## 8. 凭据属于 Surface，不属于记忆

认证信息应该留在对应客户端或运行环境：

- API key；
- OAuth token；
- cookie；
- subscription login；
- 私钥；
- 浏览器认证状态。

DuduLove 不需要保存这些内容，才能知道 Resident 是谁。

Resident 身份连接与外部服务账号也应分开管理：

```text
外部服务凭据 → Surface / Runtime
DuduLove Resident token → 记忆身份连接
长期身份与历史 → DuduLove
```

这样换掉某一家服务时，不需要连 Resident 的长期记忆一起搬家。

**DuduLove 记住的是 Resident，不是供应商账号。**

## 三种常见接入方式

### 日常聊天 Surface

推荐：

1. 新会话先取 `awakening` briefing；
2. 普通轮次按当前话题使用 `chat`；
3. 临时近况先放 `pulse`；
4. 稳定偏好和形成性经历再进入长期 `private`。

聊天历史不需要每轮全部重新注入。

### Coding / 工作 Agent

推荐：

1. 使用同一个 Resident 的身份连接；
2. 以 `work` 模式召回；
3. 有明确项目时传 `projectId`；
4. 工程知识写 `ops`；
5. 未完成事项使用明确的 `open_loop`；
6. 真实工具行动用 activity；
7. 构建日志、终端输出和临时文件留在 Workbench。

工作模式只是换了一副工作镜片，不需要换一个人。

### Personal Agent / Task Runner

推荐：

1. 只申请完成任务必要的读取范围；
2. 用 `task` 或工作召回取得最小上下文；
3. 外部动作保存真实状态与回执；
4. 每次运行可以使用近期 briefing 接续；
5. 只有真正值得长期保留的结果才写回 memory。

如果它需要参考其他 Resident，使用用户明确授予的只读权限，而不是共享所有私人库。

## 接入完成后的检查

给一个新 Surface 接好 DuduLove 后，可以用几条虚构资料做快速验证：

- 换客户端后，同一个固定 Resident ID 还能读到自己的记忆；
- 另一个 Resident 默认读不到这份 `private`；
- 用户授予只读权限后可以读取，但仍不能修改；
- work 模式能找到相关项目资料，而不会把无关私人历史全部塞进上下文；
- 同一个 session 连续召回时不会机械重复同一条关联记忆；
- activity 的 `unknown` 不会被误写成 `succeeded`；
- 凭据、cookie 和 runtime 状态不会进入长期记忆；
- 删除或拒绝错误记忆后，它不会因为后台整理再次正常浮现。

测试完成后，删除或回收这些虚构记录。

## 最后的原则

一个好的 Surface Adapter 不需要知道 Resident 的全部过去。

它只需要在合适的时候拿到合适的部分，完成当前事情，再把真正值得留下的结果交还给长期记忆。

**Surface 可以短暂，Resident 可以继续。**
