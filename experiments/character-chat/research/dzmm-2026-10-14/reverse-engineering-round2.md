# 提示词与模型逆向：第二轮方法和结果

> 最新官方诊断核验（2026-10-14）：现已通过自有未上架测试卡取得 2649 字符的平台 system、完整四条组装输入及 5 份生成参数/token 记录。分词复验明显支持 DeepSeek 系计数特征，但实际型号与 provider 仍隐藏。下文为此前阶段记录；最新结论见 [官方诊断实测报告](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/verified-runtime-2026-10-14/results.md)。

> 后续实测更新（2026-10-14）：浏览器控制已恢复，已取得真实生成和提取候选；下文的“未生成/超时”是此前阶段记录。诊断权限中的 owner 已纠正为角色卡作者/所有者。详见 [本轮实验记录](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/prompt-extraction-2026-10-14/results.md) 与 [权限核验](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/prompt-extraction-2026-10-14/diagnostics-access-gate.md)。

2026-10-14，Asia/Shanghai。

**提示词工程已经能还原出一部分具体机制和公开字段提示；完整平台私有 prompt、上游底模与训练方法仍未取得。**本轮补齐 5 个公开依赖并单独运行 REA，累计静态解析 15 个精选文件。没有把模型别名、产品描述、作者开场或模板误当成真实生成记录。

## 实际尝试的方法

| 方法 | 本次结果 | 证据边界 |
|---|---|---|
| 沿普通聊天依赖继续追踪 | 取得设置、消息分支、模型选择、状态 schema 与默认配置的 5 个精确声明文件 | 静态代码；未执行目标 JS |
| 提取公开提示内容 | 找到默认状态字段的好感度/关系 hint；已有作者写作模板也有可核验原文 | 作者可编辑提示，不是完整平台私有指令 |
| 追踪输出处理 | 确认 SSE 消费、建议/状态尾段剥离、旧状态格式兼容与快照恢复 | 说明客户端支持这些协议，没有观察某次生成是否使用 |
| 查询现行公开模型目录 | 已取得 44 项、5 系列、目录默认 `x-apex-surge-0505` | 内部调用名和产品能力配置，未披露底模映射 |
| 追查官方公告与模型卡 | 没有新增可核验供应商/基础模型映射；显示名与调用名有不一致的直接例子 | 公告镜像保持待核验，不能升级为官方训练事实 |
| 检查作者公开对话分享 | 两张明确公开角色页没有可追踪的分享 URL | 没有取得独立的真实生成样本，不证明平台不存在分享 |
| 检查声明的 source map | 115 个已下载 JS 未发现 sourceMappingURL 指令 | 未猜测 map 地址；不能证明全站或后台没有源文件 |
| 读取自己的会话诊断 | 本轮新增错误日志读取也超时，未恢复浏览器控制 | 0 条测试消息、0 条真实生成/诊断；不能认定为游客权限拒绝 |

我创建的临时恢复标签页已关闭，并核对标签列表确认移除；原用户角色页面保留。

## 1. 实际找到的状态提示

公开状态模板的默认关系字段如下。它们属于作者可编辑配置，而非每个角色强制采用的全局规则。

| 字段 | 公开默认值或提示 |
|---|---|
| 好感度 | 初值 20；范围 0–100；提示依据本轮事件调整，每轮变化最多 10 |
| 关系阶段 | 初值陌生；好感度低于 30 为陌生，30–59 熟人，60–84 暧昧，85 以上恋人 |
| 其他默认状态 | 时间、地点、心情、背包 |

来源：[官方状态模块](https://www.dzmm.ai/assets/Cyr5iadJ.js)。编辑器把作者配置保存为 `extensions.status_template`。

客户端会从初值开始，逐条应用 assistant 消息的 `statusSnapshot.values`，忽略未知字段或错误类型，并限制数值范围。**没有看到客户端强制每轮最多变化 10，也没有在该重建函数里按好感度重新计算关系阶段。**这些约束目前是字段 hint 的预期；后台是否强制及怎样注入仍未知。

这说明一个可借鉴的工程思路：角色行为与可保存状态分开，字段给模型表达含义，程序负责校验和恢复。关系是否自然、是否有因果，还需要实际生成和阶段控制检验。

## 2. 抗复读是明确的风格入口，但范围很窄

公开客户端有 `standard`、`creative`、`divergent` 和 `apex_dry` 代码值。第四项中文文案为“灵动(抗复读)”，设置修改发送 `{style:值}`。[普通角色设置](https://www.dzmm.ai/assets/Dm7jYsLH.js)、[中文文案](https://www.dzmm.ai/assets/D58JO2kB2.js)

精确门控只识别 `x-apex-sigma-0417` 及其上下文后缀，且要求没有体验锁定。**它不是所有 Apex 的通用选项。**当前已取得的 44 项目录没有这个旧系列，不能据此认定 Surge、Dash 或新 Sigma 同样可选。也不能从 dry 一词推断低温、重复惩罚或某个特定采样算法；源码没有公开这些参数映射。

## 3. 回复正文和控制内容分开消费

普通角色共享组件消费 init、token、step、compaction、complete、error 事件。它先积累原始 token 文本，再根据启用条件剥离建议/状态尾段及尚未完成的协议标签。候选选项可单独显示，正文交给 Markdown 渲染；还兼容旧状态栏格式。[普通回复消费代码](https://www.dzmm.ai/assets/1OYk4JId.js)

这里能还原的是**输出解析与呈现契约**。尚未取得要求模型生成这些尾段的完整服务端指令，也不清楚服务端是否做了额外转换。隐藏控制内容不等于只说角色台词，叙述仍可保留在正文。

对我们的本人聊天模式，可学习正文与状态分离及流式显示处理，表面输出继续独立禁止旁白、动作括号和代替用户发言。

## 4. 模型已经查到哪里

普通模型选择器确实查询 `chat.models({service:'chat'})`，缓存 5 分钟，优先采用 API 目录 defaultModel。静态 fallback 却是 `x-apex-surge-0923-b-16k`，另有 `nalang-xl-0826-16k` 等旧配置。因此静态 fallback、在线目录默认、某个会话当前值和上游实际模型是四类信息。[模型选择器](https://www.dzmm.ai/assets/DGlS3pRw2.js)、[静态配置](https://www.dzmm.ai/assets/B2vKkOtb2.js)

目录还存在展示名与调用名不同的例子：Prism-0626 对应内部 prism-0408，Turbo-0101 对应内部 turbo-1115。这使“按名称或日期后缀猜底模”缺乏依据。官方模型卡检索与公告归属追查也没有补上供应商映射。

目前不能区分独立训练、微调、蒸馏、第三方路由、提示词差异或这些方法的组合。自报身份、相似语气、价格和上下文标称都不能给出可靠归属。详细出处和检索范围见 [模型归属追查](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/model-attribution-followup.md)。

## 证据与剩余缺口

本轮 5 个新文件共 31555 bytes，REA 解析无失败。application complete 仅指本轮输入；semantic 为 unknown，各子类 partial，保留 1845 项 semantic unknown。它没有恢复后台代码或观察实际模型执行。

- [提示词工程详细核验与 20 项短段](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/prompt-engineering-followup.md)
- [新增资源清单](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/public/followup-script-manifest.json)
- [REA 新增摘要](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/rea-followup-summary.json)
- [公开分享检查](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/public-shared-evidence.md)
- [总证据索引](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/evidence-index.json)

真正仍缺的是用户自己的生成诊断：最终输入、模型/供应商配置、世界书触发与预算记录。当前浏览器错误日志读取也超时，无法取得这些运行证据。REA 的被动浏览器路线还要求已配置的 loopback CDP endpoint，当前没有提供这个端点；其文档明确写“Supply the existing browser or Electron instance's literal-port loopback CDP endpoint in the request.”，见 [REA runtime reference](/Users/pencil/.agents/skills/reverse-engineer-anything/references/runtime-observation.md)。这属于具体能力所需的数据，不是新的审批要求。

已知工程机制可以据此做独立实现；完整私有 prompt 和底模身份仍应标为未知。
