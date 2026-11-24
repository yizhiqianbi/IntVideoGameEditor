# 离线 tokenizer 指纹工具

这套工具已经实际测出 4 组公开 tokenizer、12 条文本的参考 token 计数。**没有取得 DZMM 的原生 token usage；目标观测全为 null，尚不能识别 DZMM 模型。**

参考数据来自 OpenAI 的 `cl100k_base` / `o200k_base` 编码文件，以及 Qwen 官方 `Qwen3-0.6B`、DeepSeek 官方 `DeepSeek-V3` 的 `tokenizer.json`。只下载 tokenizer 数据，不下载模型权重，不调用付费 API，不执行模型仓库代码，不使用 `trust_remote_code`。Qwen3 的仓库名用于指定可复现的 tokenizer 来源，不表示测出参数量为 0.6B。

## 可复现文件

- `tokenizer_fingerprint.py`：下载、计数、匹配和轻量自测脚本。
- `tokenizer-sources.json`：固定官方 URL、仓库 revision、大小和 SHA-256。
- `tokenizer-baseline.json`：探针精确文本、UTF-8 SHA-256、计数、token ID。
- `tokenizer-probes.md`：计数对照表及常数偏移下的可分性。
- `observations-template.json`：未观测模板；所有目标计数均为 null。
- `offline-self-test-results.json`：合成数据测试，明确不是 DZMM 观测。
- `tokenizer-assets/`：24,565,354 bytes 的公开编码数据，完整重跑可离线使用。

已使用的本地依赖为 Python 3.9、已有 `tiktoken==0.12.0`，以及单独安装到 `/tmp/dzmm-tokenizer-fingerprint-runtime` 的 `tokenizers==0.22.1`。后者的 wheel 为约 2.9 MB；未改变项目依赖或系统 Python 包。该临时目录可能被系统清理，可在独立环境重装固定版本。

```sh
python3 -m pip install --only-binary=:all: --no-deps --target /tmp/dzmm-tokenizer-fingerprint-runtime tokenizers==0.22.1
TOKENIZER_RUNTIME=/tmp/dzmm-tokenizer-fingerprint-runtime python3 tokenizer_fingerprint.py prepare
python3 tokenizer_fingerprint.py self-test
python3 tokenizer_fingerprint.py compare --observations observations-template.json
```

`prepare` 使用固定 revision 下载官方 JSON，OpenAI 编码文件使用其官方包附带的校验值；已有来源清单也用于后续 SHA-256 检查。已下载文件存在时不会重新下载。`compare` 和 `self-test` 只需 Python 标准库和生成的参考 JSON，不需要 tokenizer 依赖或网络。

## 如何取得有意义的目标观测

必须从正常可访问的 API usage、可信生成诊断或原生 token 计数接口取得**输入 token 数**。不能把让模型“数自己有多少 token”的回答、SSE 分块数、打字动画、显示字数、计费积分或非原生估算值当成原生 token 数。当前没有这种 DZMM 观测，所以模板故意全空。

理想实验保持角色、人设、关系状态、历史、世界书激活、记忆、时间注入、消息模板、Unicode 预处理和模型路由固定，仅替换一条用户消息为探针的精确文本。分别生成的新会话也可能有不同隐藏文本或随机世界书，因此“新开会话”本身不能保证固定背景。应保留重复基准探针以检测背景漂移。此工具未对 DZMM 发出任何 UI 或 API 请求。

若原生计数满足 `usage_i = constant_overhead + tokenizer(probe_i)`，可以拟合共同偏移；它能消掉固定 system prompt 和消息包装的长度。**偏移假设只在上述隐藏输入固定时有效**；把内容拼接到模板时跨边界 BPE 合并、tokenizer 内部归一化、提供商截断或计数语义差异也会破坏该公式。不能通过随意增大容差掩盖这些差异。

填入另存的观测文件时，声明 `measurement_type: "native_prompt_tokens"` 和经过核验的 `overhead_assumption: "fixed"`。`observations` 是探针 ID 到非负整数的映射，缺失可用 null。脚本默认容差为 0，拟合绝对误差意义下的中位数偏移；不足 3 条、未验证计数来源、多个参考并列或全不匹配分别输出明确状态，不强行给出模型名。若使用明确不含任何包装的计数端点，可加 `--no-offset`。

## 这组探针证明了什么

12 条探针覆盖简繁中文、罕见汉字、中英文混合、英文形态、代码、连续数字、数字标点、空白、Emoji、NFC/NFD。其中代码和空白主要作为低差异对照；数字、中文和 Emoji 提供较强区分信息。它们是手工设计的候选集，并非通过所有 tokenizer 或大规模数据优化出的最优攻击集。

四个**有限参考向量**彼此不同，且不能通过一个常量偏移变得完全相同。最小的成对“差值范围”是 o200k / DeepSeek V3 的 13。这个指标是离线算术可分性，不是模型识别准确率、置信度或线上实验结果。token ID 只是各 tokenizer 内部编号，不能直接跨词表比较其数值大小。

Qwen3 的 tokenizer 自身带有 Unicode NFC 归一化；工具保留各官方 tokenizer 的内置归一化，但不额外归一化输入。这解释了 NFC/NFD 探针在 Qwen3 下计数相同，其他候选不一定相同。浏览器输入、后端清洗可能另做归一化，因此需核验目标实际接收文本。

即使测得唯一匹配，也仅支持“与该参考 tokenizer 家族兼容”。多个模型、不同尺寸、蒸馏、微调、量化和第三方部署可以共享 tokenizer；平台也可能用通用计数器估算费用。没有 Grok/Claude/Gemini 的当前官方可公开验证 tokenizer 参考时，**本工具不能排除或确认它们**。未收录的 tokenizer 也可能与这 12 条文本出现相同向量。

## 公开来源

- [OpenAI tiktoken](https://github.com/openai/tiktoken)：官方 BPE 编码实现和数据地址。
- [Qwen3-0.6B tokenizer，固定 revision](https://huggingface.co/Qwen/Qwen3-0.6B/blob/c1899de289a04d12100db370d81485cdf75e47ca/tokenizer.json)。
- [DeepSeek-V3 tokenizer，固定 revision](https://huggingface.co/deepseek-ai/DeepSeek-V3/blob/e815299b0bcbac849fa540c768ef21845365c9eb/tokenizer.json)。

记录日期：2026-10-14。以上是实测官方参考编码的技术记录，不是对 DZMM 后台实现的断言。
