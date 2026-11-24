# DZMM 模型指纹核验

> 最新官方诊断核验（2026-10-14）：现已通过自有未上架测试卡取得 2649 字符的平台 system、完整四条组装输入及 5 份生成参数/token 记录。分词复验明显支持 DeepSeek 系计数特征，但实际型号与 provider 仍隐藏。下文为此前阶段记录；最新结论见 [官方诊断实测报告](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/verified-runtime-2026-10-14/results.md)。

日期：2026-10-14。

**tokenization 可以作为筛选证据，但本轮尚未识别 DZMM 的基础模型。** 当前实测可确认界面选择为 `Surge-0923-b (16K)`，站内标识为 `x-apex-surge-0923-b-16k`。不能据此认定是 Grok、DeepSeek、Claude 或其他具体模型。

## 本轮实际完成

- 检查 115 个既有公开 JS（4,567,627 字节），追踪流式文本、世界书 token 预算及模型目录字段。
- 在已有中性测试会话上检查消息菜单、模型选择与浏览器可用的 token/usage 日志；未发起新生成、未改模型设置。
- 阅读 token-count 指纹、LLMmap、AdaptPrint 等一手资料，整理观测条件与验证方案。
- 已运行 4 个公开 tokenizer × 12 条文本的本地对照；这一层只测公开 tokenizer 对输入文本的分词，目标站点计数没有观测值。

## 离线对照实测

同一句 `我刚到家，今天有点累。你在做什么？晚饭想吃番茄鸡蛋面。` 的裸文本计数如下，不含聊天模板和特殊 token：

| tokenizer | token 数 |
|---|---:|
| cl100k_base | 41 |
| o200k_base | 26 |
| Qwen3-0.6B 所附 tokenizer | 19 |
| DeepSeek-V3 所附 tokenizer | 16 |

12 条文本覆盖中文、英文、代码、数字、空白、emoji 和 Unicode 组合形式；四个完整参考向量即使允许常量偏移仍互不相同。这仅证明本次参考集合可分，没有测得 DZMM 向量，也没有覆盖所有候选模型。Grok、Claude、Gemini 等不能因为没有参考数据就被排除。

见 [12 条对照表](tokenizer-probes.md)、[原始文本与 token IDs](tokenizer-baseline.json)、[固定来源版本与 SHA-256](tokenizer-sources.json) 和 [复现／比较脚本](tokenizer_fingerprint.py)。共下载约 24.6 MB 公开分词数据，没有下载模型权重或调用付费候选模型。

## 已找到与未找到的信号

| 信号 | 当前结果 | 解释 |
|---|---|---|
| 当前模型别名 | Surge-0923-b (16K) | 产品标识，不是基础权重证明 |
| 原生输入 token 数／token IDs／logprobs | 当前 UI 和已查源码未提供可用观测 | 不等于服务器绝无这些字段 |
| SSE `type: token` | 将字符串拼接到累计输出 | 事件边界未证明等于模型分词边界 |
| `estimatedTokens` 等 | 世界书条目与预算诊断 | 口径未知，不能代替整次 provider usage |
| 字符计数 | JavaScript `.length` | UTF-16 code unit 数，不是 token 数 |
| `complete` 返回数据 | 客户端原样传递对象，读取部分业务字段 | 真实响应可能有未显式使用的元数据，尚未捕获核验 |
| `record.model` / `config.provider` | 正规组装诊断界面支持展示 | 当前未取得获授权的实际记录 |

源码证据见 [token-signals.md](token-signals.md) 与 [精确片段和哈希](token-signals-evidence.json)；运行时 UI 范围见 [ui-observation.json](ui-observation.json)。没有使用模型口述的 token ID、猜测 token 数或自报身份充当观测数据。

## tokenization 应如何测

给不同候选 tokenizer 输入同一组原始文本，形成计数向量。若目标提供原生输入 usage，比较每个样本的差值：`目标输入 token 数 − 候选文本 token 数`。固定包装下，这组差值应能被一个稳定偏移解释；也可比较相对同一基准的计数差。

这需要隐藏角色卡、开场、历史、时间注入、世界书检索、模板、文本正规化及计数口径稳定。新会话并不自动保证这些条件。若同一输入复测计数都不稳定，应先定位包装或路由变化。无 usage 是“没有可比较信号”，不是“所有候选不匹配”。

即使全匹配，也首先支持 tokenizer／请求包装的一致性，不证明参数规模、微调版本或权重相同。2026 年预印本 [Token Counts Are Not Model Lineage](https://arxiv.org/html/2608.29930v1) 对这一局限作了直接实测；其阈值不能直接移植到本站。

## 其他可行信号

- **行为指纹：** 采用跨语言、格式遵循、歧义解释等多种题型，并在可合法调用的已知模型上采集同题对照；重复测量目标自身的波动，保留“候选之外”结果。参考 [LLMmap](https://www.usenix.org/conference/usenixsecurity25/presentation/pasquini)。没有候选对照数据时，单个回答不能给模型排名。
- **续写与追问对照：** 将目标回答的前缀用于候选模型的后续对照，联合直接回答特征，减少未知提示的干扰。参考 [AdaptPrint](https://arxiv.org/html/2608.22213v1)。本轮没有运行其训练或候选匹配流程。
- **供应商分词基准：** [xAI 官方 tokenize 接口](https://docs.x.ai/developers/rest-api-reference/inference/other) 可返回 Grok 指定模型的 token ID、文本片段和 bytes，但需合法 API 权限。本轮没有调用该接口，也不能用旧 Grok tokenizer 代表所有当前 Grok 版本。

最有价值的下一项缺失证据是本账号正常生成响应里的真实 `complete` 元数据，或正常授权取得的组装诊断。当前浏览器控制接口未提供网络响应体读取，本轮未取得原始 SSE，不应将静态代码的字段缺失报告为已经检查过响应体。

完整论文与有界试验方案见 [literature.md](literature.md)。
