# DZMM 模型归属追加调查

日期：2026-10-14（Asia/Shanghai）。范围是公开官方模型资料、原始发布和模型卡，未登录、调用生成接口、读取私人 API 或测试模型回答。已有的 44 项匿名目录和 Gamefy 文档作为基线，不重新采集。

## 这轮的结论

**本轮没有取得 Apex / Surge / Dash / Sigma 或 nalang-* 到具体底模、模型供应商的可靠映射。**进一步检索发现发布公告的线索，以及“显示名与内部别名并不一致”的直接证据，足以说明不能用产品名、日期后缀、口吻或模型自报身份来认定底模。

这不意味着它们一定是同一个模型、一定是提示词包装，也不意味着它们一定拥有自研权重。当前公开证据还不能区分独立训练、微调、蒸馏、第三方路由、系统提示词差异或这些方法的组合。

## 新增的可确认观察

### 展示名不是权重版本号

已保存的官网匿名目录是官方公开返回，采集于上海时间 2026-10-14 07:23:59；无 Cookie、Authorization 或用户凭证。目录没有 `provider`、`base_model`、参数量、训练方法、模型仓库或供应商部署 ID 等归属字段。以下两个例子直接否定“显示名的日期后缀必然标识底模版本”的推断：

| 系列展示标识 | 实际调用标识 | 能得出的结论 |
|---|---|---|
| Prism-0626 | x-apex-prism-0408 / x-apex-prism-0408-16k | 展示系列与内部调用后缀可以不同 |
| Turbo-0101 | nalang-turbo-1115 / nalang-turbo-1115-16k / nalang-turbo-1115-10k | 展示名更新不必同步改内部别名 |

它们不能证明一定没换权重，也不能证明 0626、0101、0408、1115 分别是哪一年或哪次训练。来源：[官网公开目录](https://www.dzmm.ai/api/trpc/chat.models?input=%7B%22json%22%3A%7B%22service%22%3A%22chat%22%7D%7D)、[已保存原始响应](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/public/anonymous-model-catalog-response.json)、[采集清单](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/public/anonymous-model-catalog-manifest.json)。

目录里的情绪反应、长线剧情、速度、会员门槛、深度思考与上下文容量，仍是产品描述和能力配置。不能用“thinkingSupported=true”认定它是某个推理模型；也不能用 128K、价格或速度匹配同样规格的供应商。匿名目录默认 `x-apex-surge-0505` 也不是当前用户会话实测的选择。

### 模型卡检索没有找到可用的公开条目

本次通过 Hugging Face 官方公开模型搜索 API，以 `nalang` 和 `dzmm` 分别搜索（limit=30），两次均 HTTP 200，返回空数组。查询原始入口：[nalang](https://huggingface.co/api/models?search=nalang&limit=30)、[dzmm](https://huggingface.co/api/models?search=dzmm&limit=30)。

这是有限的负面检索证据：这两个字符串没有返回公开模型条目。它不能排除别名下的仓库、未被搜索命中的模型、私人仓库、已删除发布或未公开权重。因此报告不写“没有训练模型”或“没有权重”。

## 发布公告线索：暂未达到原始发布核验

检索命中了 [@DZMM_OFFICIAL 的第三方镜像](https://www.sotwe.com/DZMM_OFFICIAL)，其中呈现几组可能有价值的公告：Nalang-0826 的角色扮演行为升级、一个由 XL 剪枝的实验 Flash 模型，以及对旧历史进行稀疏化的记忆增强描述。

这些属于**待核验线索**。本次 [X 账号原始页](https://x.com/DZMM_OFFICIAL)返回 403，[Twitter 原始页](https://twitter.com/DZMM_OFFICIAL)没有取得正文；镜像页面没有给出可核验的具体原帖 URL、完整绝对发布时间或模型卡。也尚未从官网声明链接确认此账号的归属。不能把镜像的技术措辞直接升级为已确认的官方算法或训练报告，更不能据此给 Surge、Dash、Sigma 归属底模。

镜像的“剪枝”说法即使将来确认为原始公告，最多先成为该实验产品的作者声称；仍需要参数量、架构、训练/恢复流程、基准与权重等资料，才能解释它是否对应目前的模型目录。“旧记忆稀疏化”也不自动证明采用某篇长上下文论文、压缩模型或向量召回。

## 已排除的归属捷径

- 社区适配包和代理站列出 nalang-* 或 x-apex-*，只能证明作者使用这些服务名；不能由 OpenAI 兼容接口认定底模为 OpenAI。
- 社区机器人同时接 NaLang、Gemini、DeepSeek，不表示 NaLang 由后两者提供。
- 搜索出现 AI 生成的“Nalang GGUF、类似 Qwen”等建议，没有官方权重链接或原始训练证据，不能作为事实。
- DZMM 同名菲律宾广播资料、普通英语 Surge/Dash/Sigma 结果均与本任务无关。
- 已在上一份报告排除的 dzmm.app、dzmm.one、aidzmm.com 等未确认关联站点，其“自研”营销词没有新增可信性。

## 对后续逆向的实际影响

应先把可观测的服务行为与归属身份分开记录。对于用户关心的活人感，可在明确选择同一产品模型与版本、相同关系阶段和上下文后，比较本人直接聊天、替用户说话、称呼、主动进展、示例复制和长聊记忆；这是行为测量，不能恢复权重身份。

底模归属需要更直接的证据：官方模型卡/训练报告、明确供应商与版本映射、官方原始发布中的具体架构说明，或正常授权接口已经返回且经过核验的上游标识。客户端展示名、通用输出格式、服务域名、模型自述和体验相似度都不具备这种证明力。

本轮保持原结论：可以继续深入 prompt 编排、状态与上下文工程，但不能承诺完整恢复 DZMM 服务端私有提示词或模型训练配方。
