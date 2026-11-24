# NariYume tokenizer 指纹实验（离线）

这组文件只做候选 tokenizer 的**参考向量**，没有向 NariYume 发请求，也没有把 DZMM 的在线诊断结果移植过来。目录中 16 条中文、英文、emoji、Unicode、随机字符串和代码探针由本地公开 tokenizer 实测生成；目标站没有原生 `prompt_tokens` 或 `completion_tokens` 观测，所以当前状态是 `target_observations: 0`，不能据此命名模型。

参考集合包含 `cl100k_base`、`o200k_base`、Qwen3 tokenizer 和 DeepSeek-V3 tokenizer。它们的有限计数向量在允许一个固定包装偏移后仍彼此可分；这个结论只表示这四个参考集合可以做筛选，不能排除未收录 tokenizer，也不能区分共享同一 tokenizer 的模型、尺寸、微调、量化或供应商路由。

## 使用

依赖是 Python 的 `tiktoken==0.12.0` 和隔离路径中的 `tokenizers==0.22.1`；资产已从本地 DZMM 研究目录复制并用 SHA-256 校验，运行下面命令不需要网络：

```sh
TOKENIZER_RUNTIME=/tmp/dzmm-tokenizer-fingerprint-runtime \
  python3 tokenizer_fingerprint.py prepare
TOKENIZER_RUNTIME=/tmp/dzmm-tokenizer-fingerprint-runtime \
  python3 tokenizer_fingerprint.py self-test
```

若日后从用户自己合法会话的原始 `/api/chat` 响应中取得了**精确的** `usage.prompt_tokens`，需将探针对应值填入 `prompt-observations-template.json`，并声明：

```json
{
  "measurement_type": "native_prompt_tokens",
  "overhead_assumption": "fixed",
  "native_counter_source": "captured response usage.prompt_tokens",
  "observations": {"zh_common": 123}
}
```

然后运行：

```sh
python3 tokenizer_fingerprint.py prompt \
  --observations prompt-observations.json --tolerance 0
```

这要求角色、人设、关系状态、记忆、历史、摘要、时间注入、Unicode 清洗、消息模板及路由都固定；对 NariYume 来说，每轮请求的 `dynamic` 和 history 会变化，因此不应把一组不同聊天的 token 差值硬拟合成常量。至少需要三条以上重复探针和固定上下文。

也可以对原始响应 `choices[0].message.content` 做 `completion_tokens` 参考，但必须明确 provider 的计数范围（是否包含 EOS、隐藏 reasoning/tool 内容等）：

```sh
python3 tokenizer_fingerprint.py completion \
  --observations completion-observations.json --tolerance 0
```

回复里模型自报 token、SSE 分块数、显示字符数、打字动画速度、前端估算值都不是 native token usage，不能作为输入模型或 tokenizer 的观测。

## 当前结论

静态包只证明 NariYume 客户端会读取响应的 `model`、`provider` 和 `usage` 字段，并读取 `x-nariyume-openrouter-route` 响应头；它没有公开默认模型，也没有公开完整 system prompt。故最短的确定路径是从本人正常、已授权的一次合法聊天响应保存这些字段，而不是继续猜测 tokenizer。就算 tokenizer 向量唯一匹配，也最多得到 tokenizer 家族兼容性，不能等同于模型身份。
