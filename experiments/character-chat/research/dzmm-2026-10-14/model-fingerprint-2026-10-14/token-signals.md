# DZMM token 信号静态审计（2026-10-14）

本次只检查此前已经下载的公开资料和前端 JavaScript，没有访问登录后的接口、修改网页状态或发起模型生成。范围为 `public/scripts/` 的 **115 个 JS，4,567,627 字节**，另核对现有匿名模型目录。完整字段命中表、精确片段、文件 SHA-256 和语料清单见 [token-signals-evidence.json](token-signals-evidence.json)。下列 offset 均为文件开头起算的 UTF-8 字节偏移，不是 JavaScript 字符偏移。

## 结论

**当前静态证据没有提供可以直接与候选 tokenizer 比对的原生输入/输出 token 计数、token IDs 或 logprobs。** 找到的 `token` 信号分属文本流事件、世界书预算估算、产品设置和说明文案。它们不能直接当作模型分词指纹。该结论只针对已下载客户端代码；服务器或实际响应中可能存在前端没有显式读取的字段，需要真实响应另行验证。

| 信号 | 实际来源 | 能否直接用来辨认 tokenizer |
|---|---|---|
| SSE `type: "token"` | 应用层增量字符串 | 不能保证单事件对应一个模型 token |
| `estimatedTokens` | 世界书诊断条目的服务端返回字段 | 名称明确为估算；计算器和精度未知 |
| `usedTokens / tokenBudget` | 世界书占用与注入预算 | 仅局部上下文预算，不是整次原生 usage |
| `maxTokens` | 用户配置的最大回复额度 | 是上限，不是实际消耗 |
| 字数/字符数 | JavaScript 字符串 `.length` | 不是 tokenizer；`.length` 为 UTF-16 code unit 数 |
| 10K/16K/32K 等 | 站内产品可选上下文额度 | 不能确认底层模型原生窗口 |
| `usage` | 另一个 agent 分支捆绑的通用 AI SDK 对象字段 | 未发现普通角色聊天将其作为原生用量展示 |
| `tokenizer` | HTML/Markdown 解析依赖 | 与大模型 tokenizer 无关 |

## 普通角色流：事件名不是分词证明

共享角色聊天代码 [1OYk4JId.js](../public/scripts/1OYk4JId.js) 中：

- byte **43465**：`ca()` 对 `/api/chat` 发起普通 POST，并处理生成流。
- byte **44990**：`da()` 用 `getReader()`、`TextDecoder` 和换行缓冲处理恢复的流。网络块先拼接，再按 `\n` 拆分 SSE 行。
- byte **45564**：`fa()` 解析 `data: ` 后的 JSON，识别 `init / token / step / compaction / complete / error`。
- byte **45743** 附近：`case "token"` 的有效逻辑为 `let e=t+a.data`，随后将累计字符串送到 `onToken`；没有 token ID 或 tokenizer 序列。
- `complete` 直接返回 `a.data`；在 byte **51059** 后的完成处理会读取 `content`、`createdAt`、`partial`、`userAborted`、消息位置与 voice 等业务字段，并通过展开运算继续传递对象。**因此无法仅凭源码字段未出现就断言实际 complete 响应绝无额外 usage/model 字段。**

分清三种边界：HTTP reader 的网络块、应用 SSE 事件、模型 token。现有代码仅确证前两者的解码方式，未证明 SSE 文本事件保持上游单 token 边界。即使今后抓到很多很短的事件，也应先查是否有服务端合并、字符切分、格式过滤或回放缓冲；统计网络包长度不能直接识别模型。

## 世界书诊断是局部预算信号

[Dm7jYsLH.js](../public/scripts/Dm7jYsLH.js) 的 byte **95411** 是世界书诊断读取函数 `ys()`。该响应在 UI 中显示：

- byte **96120**：汇总 `usedTokens / tokenBudget`。
- byte **97099** 附近：各 source 的 `usedTokens`。
- byte **100098**：每个条目的 `estimatedTokens`。

这条 provenance 是“诊断 JSON → 世界书表格”，不是“上游 provider usage → 消耗统计”。前端没有本地计算 `estimatedTokens` 的实现，也没有声明采用何种 tokenizer。它可能是估算器、预算统一计量或实际 tokenizer 包装；静态材料无法选择其中一种。

[D58JO2kB2.js](../public/scripts/D58JO2kB2.js) byte **129777** 的预设编辑文案还写明：后端目前使用上下文 25% 的固定预算，编辑器值仅供参考。这是产品说明证据，不能视作运行时公式已被测量。

诊断可见性受角色卡作者/特殊 debug 权限控制；本次没有调用这些受限路径。有关门控的已验证来源见 [diagnostics-access-gate.md](../prompt-extraction-2026-10-14/diagnostics-access-gate.md)。如果未来通过正常权限取得自有卡诊断，可以用已知世界书内容做差分检查；即使计数匹配，首先识别到的也可能只是**平台预算 tokenizer**，还不能直接归因到生成模型。

## 容易误读的其他命中

- [Dm7jYsLH.js](../public/scripts/Dm7jYsLH.js) byte **6561**、**8642** 附近限制创建角色卡所选聊天内容的 `u.length > 10000`；随后 `E=u.length` 用于“字符”展示。这是字符长度限制。
- 同文件 byte **52595** 开始的“中文平均 1 token ≈ 2–3 汉字”、500 字约 250 token 等是静态教程示例，没有调用计数器。不能用作站点 tokenizer 实测证据。
- [D58JO2kB2.js](../public/scripts/D58JO2kB2.js) byte **7992** 起解释 `maxTokens` 为单次回复上限，且深度思考和正文共用额度。输入 `maxTokens` 与实际 output token 数不是同一个变量。
- [gDs7nKvi.js](../public/scripts/gDs7nKvi.js) byte **147576** 处的 `tokenizer` 带有 `activeFormattingElements`、HTML `treeAdapter`、fragment parser 等上下文，属于 HTML parser；全部 `tokenizer` 命中均在此依赖文件。
- [C58mxSVt2.js](../public/scripts/C58mxSVt2.js) byte **93304** 的 `usage` 位于 `AI_NoObjectGeneratedError`/通用 AI SDK 代码。角色聊天实际走上述 `1OYk4JId.js`，不能拿打包了某家 SDK 来推断 provider。

在 115 个 JS 中不区分大小写检索下列字符串均未命中：`inputTokens`、`outputTokens`、`promptTokens`、`completionTokens`、`totalTokens`、`input_tokens`、`output_tokens`、`prompt_tokens`、`completion_tokens`、`total_tokens`、`logprobs`、`token_ids`、`tokenIds`、`countTokens`、`tiktoken`、`sentencepiece`。这是有范围的负面证据，不排除未下载页面、动态字段、服务器实现或实际响应的额外属性。

## 模型别名能确认到哪一层

[匿名模型目录原始响应](../public/anonymous-model-catalog-response.json) 有 44 个站内模型条目、5 个 category。可确认的映射是：

| 层次 | 已有证据 |
|---|---|
| 当前实测页面名称 | `Surge-0923-b (16K)`（此前实测 DOM） |
| 目录对应站内标识 | `x-apex-surge-0923-b-16k` |
| 目录显示额度 | `maxContext: 16000` |
| 匿名目录默认项 | `x-apex-surge-0505`；不是当前选中项 |
| provider / 基础模型 / checkpoint / tokenizer | 此匿名目录没有提供 |

`models` 条目字段只有 `internalName / displayName / price / description`。category 内分组增加产品能力和权限信息，context 增加 `maxContext` 等，但没有原生模型、provider 或 tokenizer 映射。不能凭 Surge/Sigma/Prism、日期尾缀、价格或叙事风格映射为 Grok/Claude/Gemini。

另一个正规证据入口是组装诊断： [Dm7jYsLH.js](../public/scripts/Dm7jYsLH.js) byte **106835** 读取 `record.config.provider`，byte **109607** 附近读取 `finalInput`，同一 UI 还会显示 `record.model`。这些是“该界面支持展示字段”的证据，**当前没有已授权诊断的实际值**；拿到以后也需区分站内 provider 适配器名与真实上游模型名。

## 对下一步实测的意义

1. 首先看自己正常生成的原始响应是否有 `usage`、原生 `model`、token IDs、logprobs 或结束原因。抓到响应后只保存与研究相关的字段，去除认证材料。源码允许 complete 携带任意业务字段，值得实际检查。
2. 有精确 token 计数时，才用等长度但分词差异大的字符串做成对差分；固定卡、历史、预设、思考设置，随机化实验顺序并重复测量。不可把积分变化或字符计数代替 token usage。
3. 只有文本输出时可做行为指纹，但应建立候选模型参考池、固定测试集并保留“候选池之外”结果；不得将自报模型、一次拒绝或一次格式响应当身份证明。
4. SSE 事件边界只能作为待验证的弱信号。当前没有依据将其当成原生 tokenizer 的分词结果。
