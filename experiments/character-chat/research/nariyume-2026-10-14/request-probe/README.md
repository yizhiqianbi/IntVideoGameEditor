# NariYume request-level 离线取证

`probe.py` 只解析操作者主动提供、已经授权且脱敏的文件，不提供请求发送器。没有网络客户端、shell 执行、浏览器控制、浏览器存储读取、凭据环境变量读取或输出文件写入。无参数启动只显示用法；所有解析命令都要求 `--input` 和 `--authorized-redacted-input`。脚本不会取得、刷新、保存 token，也不会执行 curl、补齐授权头或绕过登录。输出只写标准输出；需要保存报告时由操作者选择重定向目的地。

依据是现有 [静态分析](../static-findings.md)：前端把 `kind`、`characterId`、`history`、`conversationSummary` 和 `dynamic` 等交给同源 `/api/chat`，读取响应的 `model`、`provider`、`usage`，以及 `x-nariyume-openrouter-route`、`x-nariyume-gated`。这使响应元数据成为进一步确认路由的直接证据；客户端字段和路由头不等于后端权重身份。

## 取证流程

1. 用户在自己已经获授权的正常会话中使用正常产品流程。此脚本不会代发消息或读取当前登录态。一次请求可能收费、改变历史和记忆；仅在用户明确选择开展新样本时使用中性公开探针。
2. 在用户自己的网络面板查看该次响应，手工摘录下面允许的响应字段。先在输入文件之外删除 Authorization、Cookie、Set-Cookie、Firebase/access/refresh token、账号 ID、请求历史、用户资料、私密内容及可识别请求 ID。不把 HAR、浏览器 profile、原始 “Copy as cURL” 或完整请求/响应直接交给脚本。
3. 提供一个最小 JSON 元数据文件。若只想核对请求结构，提供已经替换字符串的 curl 模板；模板只被解析。`--authorized-redacted-input` 是调用者声明，不能替代事先脱敏；此工具不是原始凭据清洗器。
4. 优先看响应自报的 model/provider；缺失即保持未知。路由头 `gateway` 或 Server-Timing 中 `openrouter` 仅证明观测到相应标记。
5. 有多条符合计数口径的 native usage 时，再进行离线 tokenizer 对比。不要从角色自述、字符数、流式分块数、HTTP 字节数或动画速度生成 token 观测值。

## 一次最小直连边界探针

在用户授权的范围内，向同源 `https://www.nariyume.com/api/chat` 发送过一次不带认证头的最小 JSON POST；请求只含空历史、空动态和空消息，没有读取浏览器存储，也没有重放用户的真实请求。服务端返回 `403`、`content-type: text/plain; charset=UTF-8`、响应体 17 字节。它证明了：知道公开的请求字段还不够，脱离浏览器认证上下文无法直接调用模型；这不是模型或 system prompt 的泄露。该结果记录在 [network-observation.json](../network-observation.json) 的 `direct_probe_without_auth` 节点中。

## 响应元数据

在本目录执行命令，输入文件路径由用户明确提供：

```sh
python3 probe.py metadata --input /path/to/redacted-response.json --authorized-redacted-input
```

文件结构示例（数字是演示值，不是目标观测）：

```json
{
  "status": 200,
  "response": {
    "model": null,
    "provider": null,
    "usage": {
      "prompt_tokens": 100,
      "completion_tokens": 20,
      "total_tokens": 120,
      "prompt_tokens_details": {"cached_tokens": 64}
    }
  },
  "headers": {
    "content-type": "application/json",
    "x-nariyume-openrouter-route": "gateway",
    "x-nariyume-gated": "false",
    "server-timing": "openrouter;dur=100"
  }
}
```

脚本只接受上述 response 字段和整数 usage；usage 也支持常见 input/output、reasoning/cache/audio 子计数。模型/供应商接受短字符串或 null。响应头大小写不敏感，只保留 `content-type`、两个 `x-nariyume-*` 头、`server-timing`、`retry-after`、`x-ratelimit-limit` 和 `x-ratelimit-remaining`；其他头省略且不打印名字。凭据相关头直接拒绝。缺失字段保持 null 或空对象，不猜测值。输入失败的错误消息不回显内容或路径。

## 只检查 curl 模板

以下内容保存为文本后交给解析器；**不要在 shell 里运行该 curl**：

```text
curl 'https://www.nariyume.com/api/chat' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <REDACTED>' \
  --data-raw '{"kind":"chat","characterId":"Nari","userMessage":"<REDACTED>","history":[],"dynamic":{}}'
```

```sh
python3 probe.py curl-template --input /path/to/redacted-curl.txt --authorized-redacted-input
```

仅接受已知 NariYume HTTPS `/api/chat` URL，不接受 query、userinfo、外部文件、curl 配置文件、输出路径、代理或任意 shell 语法。除 JSON Content-Type 外，每个头的值必须为 `<REDACTED>` 或 `Bearer <REDACTED>`；除允许的 kind/characterId 外，body 字符串必须为空或 `<REDACTED>`。输出只包含已知端点、方法、头名和顶层 body 字段名，不打印请求内容或头值。不会产生响应、model、usage 或“请求成功”的虚构结论。

## Tokenizer comparison

本工具不下载或运行 tokenizer，直接使用相邻 [tokenizer-baseline.json](../tokenizer-candidates/tokenizer-baseline.json) 的现有离线参考向量，标准库即可运行。覆盖 cl100k、o200k、Qwen3、DeepSeek-V3 四个参考；未知候选仍可能匹配，共享 tokenizer 的模型无法区分。

```sh
python3 probe.py compare --input /path/to/authorized-counts.json --authorized-redacted-input --tolerance 0
```

Prompt 样本输入示例（数字纯属格式演示）：

```json
{
  "measurement": "prompt_tokens",
  "fixed_context_verified": false,
  "samples": [
    {"probe_id": "zh_common", "native_tokens": 119},
    {"probe_id": "zh_rare", "native_tokens": 129},
    {"probe_id": "digits", "native_tokens": 192}
  ]
}
```

必须使用 reference 中对应的精确 UTF-8 探针。程序按候选拟合一个常量包装偏移，报告最大/平均残差，至少需要三个不同 probe_id 才报告参考兼容性。`fixed_context_verified` 默认未验证；只有确认 system、角色、history、summary、memory、dynamic、时间注入、消息模板、Unicode 处理及路由均固定，才可写 true。**NariYume 连续普通聊天会改变这些变量，不满足固定上下文条件**；不能靠任意多轮相减越过这个限制。即使声明 true，也只是操作者声明；脚本无法验证隐藏服务端状态。BPE 边界合并也可能破坏常量偏移假设。

Completion 对比使用 `measurement: "completion_tokens"`、`visible_raw_content_only_verified` 和同样的 samples。每条 sample 额外提供 `raw_completion_text`，必须与其 reference 探针逐字节一致。读取的是响应 JSON 原始 content，包含 `[happy]` 等标签，不能从展示气泡还原。仅当供应商计数确实只包含可见原始内容时才将验证字段设为 true；隐藏 reasoning、tool、EOS、过滤前内容等会影响 usage。Completion 模式不拟合任意偏移，避免以偏移制造短样本匹配。

任意公开中性 completion 文本的重新分词可使用已有 [tokenizer_fingerprint.py](../tokenizer-candidates/tokenizer_fingerprint.py) 的 `completion` 模式与本地 tokenizer 资产；它的输出也仅支持家族兼容性。此目录的解析器不会代调用它，不隐式安装依赖，不下载资产。

所有模式输出 `network_requests_sent: 0`；compare 始终输出 `model_identity: null`。一次短回答的精确匹配仍只是弱指纹，不能从 tokenizer 家族推出模型名称、规模、微调或供应商。
