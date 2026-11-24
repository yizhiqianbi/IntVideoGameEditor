# DZMM 官方生成诊断与 tokenizer 的实测对照

日期：2026-10-14。使用自己创建、未公开上架的测试角色，以及网站正常开放给角色作者的 Prompt Assembly / 生成诊断。**已取得 5 轮真实 UI 的 `prompt_tokens` 和完整组装输入。结果强烈支持 DeepSeek 系 tokenizer 的计数特征；尚未识别具体底层模型。**

当前显示型号为 `Surge-0923-b (16K)`，诊断中的 `model` 和 `provider` 均为 `[hidden]`。这些计数来自官方生成诊断，不是让模型自报。但它们由上游 provider 返回还是由平台自行计算，仍未独立确认。

## 5 轮输入的完整内容计数

每轮消息依次为 system、user（人物设置）、assistant（开场）、user（测试输入）。前 3 条消息逐字相同，已比较哈希；A 的首次与复测完整输入也相同。逐条 `content` 分词，不套未知聊天模板，不加 BOS/EOS，不额外归一化 Unicode。保留官方 tokenizer 自带的归一化。

| 样本 | 官方 prompt_tokens | cl100k 内容 | o200k 内容 | Qwen3 内容 | DeepSeek-V3 内容 | 官方减 V3 内容 |
|---|---:|---:|---:|---:|---:|---:|
| 基线 | 2011 | 3500 | 2465 | 2164 | 2002 | 9 |
| A：繁体中文 | 2022 | 3525 | 2482 | 2179 | 2013 | 9 |
| B：数字与标点 | 2052 | 3530 | 2501 | 2228 | 2044 | 8 |
| C：Emoji | 2050 | 3546 | 2500 | 2198 | 2042 | 8 |
| A 重复 | 2022 | 3525 | 2482 | 2179 | 2013 | 9 |

**V3 残差为 +9、+9、+8、+8、+9。** 残差范围仅 1 token；另外三份参考的残差范围分别为 25、11、28，且纯内容计数都已高于官方输入计数。DeepSeek-V3 在这组有限参考中明显更有解释力，但它仍未达到同一固定偏移下的零误差。不能把两次 1-token 差异删掉，也不能靠任意增加容差宣布成功识别。

A 为繁体中文句子，B 为长数字和标点，C 为 Emoji / ZWJ / 修饰符。均加上相同的“文本测试，只回复收到”前缀。A→B 的官方增量是 30；逐内容分词的参考增量分别为 cl100k 5、o200k 19、Qwen3 49、DeepSeek-V3 31。前缀及最后消息的精确文本保存在相应的 `probe-*-input.json`，没有用离线探针文本替换线上实际文本。

## 输出正文提供第二条证据

基线的官方 `completion_tokens=37`。从网站编辑框读取并取消编辑后保存的正文为 57 个 Unicode 字符，包含原有空格和换行。对这份文本分词：

| 参考 tokenizer | 基线正文 token 数 |
|---|---:|
| cl100k_base | 73 |
| o200k_base | 45 |
| qwen3 | 39 |
| deepseek_v3 | 37 |
| deepseek_v3_1 | 37 |

**DeepSeek-V3 和 V3.1 均精确得到 37，与官方输出计数一致。** 这是独立于未知输入聊天模板的交叉支持；仍不是 token ID 或完整概率分布的直接观测。编辑框内容可能也经过平台处理，不能称为原始上游响应。

另外 4 轮页面均显示“收到”，但 A/复测的 `completion_tokens=1`，B/C 为 2。渲染页面可能隐藏空白，故不能把差 1 擅自解释为 EOS，也不能据此否定模型。基线编辑框文本与渲染文本分别保存在 `completion-baseline-editor.txt` 和 `completion-baseline-rendered.txt`。

## 检查官方模板及新版 tokenizer

获取了固定 revision 的 DeepSeek-V3 官方 `tokenizer_config.json`。只手工转写其中 system/user/assistant 的纯文本序列化分支，设置 `add_generation_prompt=true`；没有执行下载的模板或模型仓库代码。官方模板对这些输入增加 6 个 token，计数依次为 2008、2019、2050、2048、2019。与官方 usage 仍差 +3、+3、+2、+2、+3，**未解释 DZMM 的序列化差异**。普通在消息头尾加空格/换行的有限检查也没有消除 A/B 的 1-token 差异。

又追加了官方 DeepSeek-V3.1 的固定 revision tokenizer（7,847,578 bytes，无模型权重）。V3.1 对 system 内容少计 1 token，5 轮内容残差变为 +10、+10、+9、+9、+10，区分度没有改善。因此不能用这组结果区别 V3、V3.1，也不能排除使用相同或近似 tokenizer 的其他模型、蒸馏或微调。

## 能下的结论与剩余未知

- 已核验：相同背景、多个不同用户输入、一次重复输入的官方计数；完整组装输入；基线输出与 DeepSeek 系参考计数相符。
- 支持：当前会话的生成/计量链路具有明显 DeepSeek 系 tokenization 特征，优于当前另外三份参考。
- 未核验：实际权重、provider、是否蒸馏或微调、是否路由混用、平台是否用统一计数器、真实上游聊天模板。
- 不能据此宣称：已确定是某个 DeepSeek 版本，或已经确认/排除 Grok。当前参考集不涵盖所有 tokenizer。

## 复现与证据

[token_match.py](token_match.py) 只对已保存的 JSON/文本和官方 tokenizer 数据离线计数，运行时不访问浏览器、网络或模型 API。运行前校验来源清单 SHA-256。[token-match.json](token-match.json) 保存 5 条请求、5 条正文对照、输入哈希、逐消息计数、模板对照及残差。

在本目录运行 [token-match-command.txt](token-match-command.txt) 中的完整命令即可重现；`TOKENIZER_RUNTIME` 默认沿用 `/tmp/dzmm-tokenizer-fingerprint-runtime`，依赖版本见上一轮 tokenizer-kit-README。来源：

- [原 4 份参考来源与固定哈希](../model-fingerprint-2026-10-14/tokenizer-sources.json)。
- [DeepSeek-V3 模板来源与哈希](deepseek-v3-template-source.json)。
- [DeepSeek-V3.1 固定 revision 来源与哈希](deepseek-v3.1-sources.json)。
- 官方参考：[OpenAI tiktoken](https://github.com/openai/tiktoken)、[Qwen3 tokenizer](https://huggingface.co/Qwen/Qwen3-0.6B/blob/c1899de289a04d12100db370d81485cdf75e47ca/tokenizer.json)、[DeepSeek-V3 模板](https://huggingface.co/deepseek-ai/DeepSeek-V3/blob/e815299b0bcbac849fa540c768ef21845365c9eb/tokenizer_config.json)、[DeepSeek-V3.1 tokenizer](https://huggingface.co/deepseek-ai/DeepSeek-V3.1/blob/c0781d039fb7a1ba2abc4add0bdc293e92d2b8db/tokenizer.json)。
