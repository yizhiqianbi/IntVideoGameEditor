# DZMM 模型指纹：分词计数与文本行为

核验日期：2026-10-14。本文仅整理一手论文与官方文档，不操作 DZMM UI/API，不对目标模型身份作判断。

**用户提出的 tokenization 方向有价值，但首先必须找到可信的 token 观测量。** 固定提示包装下的真实输入 token 数，可以排除部分 tokenizer；它通常不足以区分共用 tokenizer 的模型、参数规模、微调版本或供应商路由。让模型口述自己的分词、数 token，不能代替 tokenizer/API 返回值。

## 证据分层

| 可见信号 | 可以支持 | 不能单独支持 |
|---|---|---|
| 官方授权诊断暴露具体上游 model/version/provider | 该次请求的服务端标识 | 所有请求都走同一模型，或权重经过独立核验 |
| 真实 input-token usage，固定模板下多文本复测 | tokenization 与请求包装的一致性 | 相同权重、精确版本、模型家族血缘 |
| token IDs/bytes，且确认来自上游 tokenizer | 比计数更细的分词一致性 | 模型参数相同 |
| 字数、积分、估算 token、网页流式块数 | UI/计费/传输实现特征 | 原生 tokenizer 指纹 |
| 文本回答，已知模型对照池与校准 | 在候选集合内的行为匹配证据 | 候选池外模型必然能识别 |
| 自报身份、拒答措辞、知识截止日期 | 弱线索 | 模型身份证明 |

## 最直接相关的一手资料

### Token Counts Are Not Model Lineage（2026-08-30 预印本）

Bo Chen 的研究直接测试 API 输入 token 计数：30 条不同文本、固定请求、3 次重复，通过两个端点计数差的众数，检查能否用同一个固定偏移解释全部样本。开发集看似完美，但留出集只有一半满足可观测性要求，符合要求者的同家族识别灵敏度也仅为一半。适合借鉴的是有效性门槛与“无信号≠不匹配”，不是把其阈值直接搬到 DZMM。它检测的是分词与封装栈，不是权重血缘。论文也明确代理可改写 usage。

[论文全文](https://arxiv.org/html/2608.29930v1) · [作者代码与数据](https://github.com/ictchenbo/which-llm)

### LLMmap（USENIX Security 2025）

Pasquini、Kornaropoulos、Ateniese 利用多种文本问题产生行为特征，通过 embedding 和学习过的匹配器识别模型。论文中 42 个候选版本、8 次交互的超过 95% 准确率是其封闭集实验结果；开放集仍需要已知模型的指纹库，并支持未知项处理。其旧模型库不能直接认定 2026 年某个角色扮演站点。论文把 glitch tokens 视为值得研究但鲁棒性未确定的方向，因此几个“怪 token”复读结果不能直接确认模型。

[会议页面](https://www.usenix.org/conference/usenixsecurity25/presentation/pasquini) · [论文 PDF](https://www.usenix.org/system/files/usenixsecurity25-pasquini.pdf) · [作者仓库](https://github.com/pasquini-dario/LLMmap)

### AdaptPrint（2026-08-23 预印本）

Yilin Li、Yifei Zhang、Guozhu Meng 结合直接回答、基于目标回答前缀的续写、后续追问进行候选匹配，试图降低未知 system prompt 与采样配置的影响。论文对照池为 27 个模型，报告 Top-1 80.6%；还讨论移除真实模型后的未知候选拒绝。续写点选择使用一个本地模型的 logits，候选侧采用统一配置。我们的少量人工探针只能说受其启发，不能称为完整复现，更不能引用该准确率作为当前结论的置信度。

[论文全文](https://arxiv.org/html/2608.22213v1)

### One Token Is Enough（2026-07 预印本）

这里的 “one token” 是每次回答很短，不是一次提问就够。作者比较不同语言下随机数字、颜色、动物等回答分布，使用固定 system prompt、温度与关闭 reasoning 的配置，依赖重复采样和已知模型对照。角色扮演站点无法控制这些变量，人物喜欢的数字/颜色也会污染结果。适合作为后续补充统计实验，当前不应因某次回答“42”就判定模型。

[论文全文](https://arxiv.org/html/2607.10252v1) · [作者实现](https://github.com/HelixCraft/llm-fingerprint)

### The Challenge of Identifying the Origin of Black-Box Large Language Models（2025）

该研究专门讨论黑盒来源识别与微调衍生模型，检查了 30 个模型及两个真实 API 上既有方法的局限。其主动方法 PlugAE 涉及预先操作基础模型，不是对当前陌生聊天网页可直接执行的即插即用检测器。这说明“知道 tokenizer”“行为相似”“证明来自某组权重”是不同任务。

[论文全文](https://arxiv.org/html/2503.04332v1)

## 官方实现资料与容易误判的地方

- **xAI 的对照分词渠道存在。** 官方 `POST /v1/tokenize-text` 接受 `text` 与 `model`，返回 token IDs、字符串片段和 bytes。可在有合法账号/API 权限时构建 Grok 候选指纹；此文没有调用该接口，也没有任何 DZMM token-ID 结果。[xAI 官方 API](https://docs.x.ai/developers/rest-api-reference/inference/other)
- **不同模型可共享 tokenizer，计数接口也可能是估算。** Claude 官方文档说明部分模型共用分词器，并提示 Count Tokens 返回的数量可能与实际请求略有不同、可能包括自动添加而不计费的系统 token。因此要区分 actual usage 与预计算 count。[Claude Token Counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- **聊天模板影响总数。** 模板把 role、消息内容、结束符及 generation prefix 串起来。只对裸文本计算本地 token 数，不能要求它与包含隐藏角色卡/世界书/历史的服务器总数相等。[Hugging Face Chat Templates](https://huggingface.co/docs/transformers/chat_templating_writing)
- **SSE chunk 不是 tokenizer token。** 官方流式协议定义的是文本增量、工具增量、usage 等事件。代理可以重分块，前端还可能缓冲或打字机动画；传输到浏览器时看见的片段边界不能等同于模型分词边界。[Claude Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- **输出 token 数不能盲目由可见回答重算。** 推理、工具调用、控制 token、丢弃候选和后处理可能不可见。xAI 响应字段也将 reasoning tokens 单列。因此优先看原生输入计数，不用 total/output usage 除以可见文字长度猜模型。[xAI Responses API](https://docs.x.ai/developers/rest-api-reference/inference/responses)
- **确认元数据口径。** OpenRouter 官方生成统计存在 `native_tokens_prompt` 等字段，模型目录也有 tokenizer 类别。它们只是合法拥有该条生成记录时可读的参考；不能拿 DZMM 的内部 generation ID 去查询其他供应商账户。[OpenRouter Generation Metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation) · [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)

## 适合当前目标的有界实验设计（提案，尚未执行）

### 第一阶段：最多 3 次正常生成，检查是否真有计数

固定当前显示模型、同一角色卡、同一新会话位置，发送一条短中性消息；只检查当前访客正常获得的响应与 UI 诊断，记录是否存在真实 `prompt_tokens`、`input_tokens`、token IDs、logprobs 或上游 model 字段。若有，对同样输入在独立新会话重复两次，验证计数是否稳定。若只有历史条数、字数、点数、估计 token、时间或 SSE 片段，则 tokenization 识别状态记为 `unobservable`，不要让模型猜分词凑数据。

### 第二阶段 A：如果拿到真实输入计数

工程试验先使用 6 种文本，覆盖英文、中文、空白与换行、JSON/代码、组合 Unicode/emoji、混合文字与长数字；每类 1 条，再重复基准 2 次，总共 8 次。保持固定外壳，在新会话的相同位置发送，避免前次回答进入下一次输入。保持原始 UTF-8 字节并记录哈希；不要自行 NFC 正规化后再和另一侧原文混比。此阶段只筛选可用性，不给统计准确率。

对候选 tokenizer `j` 计算相同消息封装下的 `r_j(x)`，目标计数为 `u(x)`，记录残差 `e_j(x)=u(x)-r_j(x)`。若同一候选在多种独立文本上始终为固定偏移，且重复稳定，才支持“与该分词/包装方案一致”。也可看相对基准差 `u(x)-u(x0)`，但不能假设未知世界书检索/日期注入/记忆总是常数。若不同输入触发不同注入，固定偏移前提失效。

随后另留一组未参与挑选的文本做验证；报告候选冲突、覆盖率和失败原因。全部候选不匹配，可能是分词器未入库、模板变化或计数口径，不自动意味着自研模型。所有候选同样匹配时，只能报告无法细分。

### 第二阶段 B：当前仍然没有 token 信号

先在两个独立新会话中分别测试：①准确复写一串无害混合字符；②按固定 schema 返回三个字段。目的仅是检查角色系统是否容许非剧情任务。它们不是身份探针。若持续变为小说叙事，记录为应用层强干预，不把拒绝/跑题计作某个基础模型的特征。

若能遵守，再选 4 条中性且有明确长度/格式限制的文本问题，跨语言、歧义解释、轻量逻辑、约束创作，追加其中 2 条独立复测，总计 8 条。在合法可调用的候选模型池上用完全相同问题与记录过的配置建立对照，并包含“候选均不匹配”出口。先检查目标自身重复波动，再比较目标与候选间的差异；未经校准不要输出概率。不要使用模型自报姓名、单一拒答模板或某个随机数字作为决定性证据。

基于目标既有回答做续写对照，可减少额外目标请求；但把现有 500 字叙事先验直接复制给候选，会令候选语言风格被同化，需要和直接问答结果联合看待。以上是受论文启发的有界实务方案，不是 LLMmap/AdaptPrint 的全量复现。

## 当前可成立的结论

本轮文献任务没有获得 DZMM 的真实 token counts、token IDs、logprobs、供应商字段或候选模型实测。因此没有 Grok/Claude/Gemini/DeepSeek 等身份结论。最值得优先推进的是**可观测性验证 → 分词候选排除 → 有对照的行为复验**，而非先给模型标签再找措辞印证。
