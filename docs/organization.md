# 整理、活动与近期简报

## 整理资料

选择身份后进入「整理」。待整理碎片来自该身份的日常碎片；共享资料单独选择共享区处理。勾选记录，或粘贴、导入聊天文字，生成预览，编辑小结后保存。

导入支持 TXT、JSON 消息数组、`messages` / `chat_messages`、聊天导出的当前分支和文字档案。文件上限 2 MB，一次正文上限 48000 字。保留日期与说话者，导入后可检查和修改。无法完整读取时提示转换为文字，原输入保持可用。点击生成预览时才发送给整理模型。

在「模型与整理设置」填写 OpenAI 兼容 API 基址、模型名称和密钥。模型处理选中材料；保存小结时保留原文与引用。原文更新后，旧小结退出自动召回，管理记录中仍可查看并重新整理。普通记忆持续可搜索。

周期整理按身份开启，默认关闭。开启后每天检查，积累至少 3 条新碎片再处理。模型调用可能产生费用，连接失败保留原文与待处理状态。

## 活动记录

记忆保存、编辑等操作自动记录。Agent 执行外部行动后，调用 `POST /api/v2/organization/activities`：

```json
{"actionId":"invoice-001","action":"send_invoice","source":"desktop-agent","title":"已发送发票","status":"succeeded","detail":"已取得发送回执"}
```

`actionId` 标识同一次行动，后续回执沿用该 ID。状态支持 `running`、`succeeded`、`failed`、`unknown`、`skipped`。记忆库保存客户端上报的结果，执行端应核实回执，并在操作前检查是否已经完成。

## 近期简报

管理页面的「近期简报」预览最近资料和活动。「简报设置」可选 3 / 7 / 30 天、关注项、聊天材料及补充偏好。未连接整理模型时，使用原文摘录。

客户端接续运行流程：

1. 调用 `POST /api/v2/organization/briefing`，传固定的 `consumerId`，取得 `snapshotId`、新增内容、背景、已做事项和待核实结果。
2. 将简报交给本次运行的 Agent，执行行为后上报活动结果。
3. 成功处理后调用 `/api/v2/organization/briefing/ack`，传原 `snapshotId`、`consumerId`、本次唯一 `runId` 和 `success: true`。

下次取简报时，新增内容按该身份与客户端的接收进度计算。传 `preview: true` 仅预览。失败或不明结果保留待确认状态。

MCP 对应工具：`preview_memory_organization`、`save_memory_organization`、`record_activity`、`list_activities`、`get_recent_briefing`、`complete_briefing`。客户端调度 Agent 的运行时间，记忆服务提供接续资料与回执。
