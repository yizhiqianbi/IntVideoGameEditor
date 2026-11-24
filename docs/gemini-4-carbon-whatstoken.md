# 调用 Gemini 4 Carbon（WhatsToken）

模型页：[Gemini 4 Carbon](https://www.whatstoken.ai/home/models?tab=models&model=Gemini+4+Carbon)

这是 WhatsToken 上的 **Chat** 模型，走平台统一网关。把官方 SDK 的 Base URL 换成下面的地址，`model` 填本页给出的 Model ID 即可。

## 关键信息

| 项 | 值 |
| --- | --- |
| Base URL | `https://www.whatstoken.ai` |
| Model ID | `gemini-4-carbon-economy` |
| 类型 | Chat，按 Token 计费 |
| 供应商渠道 | Google / HA |
| 页面更新 | 2026-11-11 |

当前标价（90% OFF，红色为实付价，美元 / 100 万 Token）：

| 项目 | 标价 | 实付 |
| --- | --- | --- |
| 输入 | $4 | **$0.4** |
| 输出 | $20 | **$2** |
| 缓存读取 | $0.2 | **$0.02** |

请求头（任选一种）：

```http
Authorization: Bearer sk-你的Token
```

```http
X-Goog-Api-Key: sk-你的Token
```

Token 在 WhatsToken 控制台创建。不要写进前端代码，放到环境变量里。

## 方式一：OpenAI 兼容接口（推荐）

`POST https://www.whatstoken.ai/v1/chat/completions`

### curl

```bash
curl -X POST https://www.whatstoken.ai/v1/chat/completions \
  -H "Authorization: Bearer sk-你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-4-carbon-economy",
    "messages": [
      {"role": "system", "content": "你是一个简洁的助手。"},
      {"role": "user", "content": "用三句话解释什么是上下文窗口。"}
    ],
    "temperature": 0.7,
    "stream": false
  }'
```

回复在 `choices[0].message.content`。

### Python

```bash
pip install openai
```

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["WHATSTOKEN_API_KEY"],
    base_url="https://www.whatstoken.ai/v1",
)

resp = client.chat.completions.create(
    model="gemini-4-carbon-economy",
    messages=[
        {"role": "user", "content": "用三句话解释什么是上下文窗口。"},
    ],
)
print(resp.choices[0].message.content)
```

流式输出把 `stream=True`，逐段读 `delta.content`：

```python
stream = client.chat.completions.create(
    model="gemini-4-carbon-economy",
    messages=[{"role": "user", "content": "写一首四句的短诗。"}],
    stream=True,
)
for chunk in stream:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)
```

### Node.js

```bash
npm install openai
```

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.WHATSTOKEN_API_KEY,
  baseURL: "https://www.whatstoken.ai/v1",
});

const resp = await client.chat.completions.create({
  model: "gemini-4-carbon-economy",
  messages: [{ role: "user", content: "用三句话解释什么是上下文窗口。" }],
});

console.log(resp.choices[0].message.content);
```

常用参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | `gemini-4-carbon-economy` |
| `messages` | 是 | `role` 为 `system` / `user` / `assistant` |
| `stream` | 否 | 默认 `false`；`true` 时按 SSE 逐字返回 |
| `temperature` | 否 | 0～2，越大越随机 |
| `max_tokens` | 否 | 输出 Token 上限 |

## 方式二：Gemini 原生接口

适合官方 Google SDK，或需要 `systemInstruction`、JSON Mode 时使用。

非流式：

`POST https://www.whatstoken.ai/v1beta/models/gemini-4-carbon-economy:generateContent`

流式：

`POST https://www.whatstoken.ai/v1beta/models/gemini-4-carbon-economy:streamGenerateContent`

```bash
curl -X POST \
  "https://www.whatstoken.ai/v1beta/models/gemini-4-carbon-economy:generateContent" \
  -H "X-Goog-Api-Key: sk-你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "用三句话解释什么是上下文窗口。" }]
      }
    ],
    "systemInstruction": {
      "parts": [{ "text": "你是一个简洁的助手。" }]
    },
    "generationConfig": {
      "temperature": 0.4,
      "maxOutputTokens": 2000
    }
  }'
```

Python 官方 SDK 只改网关地址。`base_url` 不要带 `/v1beta`，SDK 会按 `api_version` 自己拼路径：

```python
import os
from google import genai
from google.genai import types

client = genai.Client(
    api_key=os.environ["WHATSTOKEN_API_KEY"],
    http_options=types.HttpOptions(
        base_url="https://www.whatstoken.ai",
        api_version="v1beta",
    ),
)

resp = client.models.generate_content(
    model="gemini-4-carbon-economy",
    contents="用三句话解释什么是上下文窗口。",
)
print(resp.text)
```

## 常见错误

| HTTP | 含义 |
| --- | --- |
| 402 | 余额不足 |
| 400 | 请求体不合法，或被内容过滤拦住 |
| 403 | Token、IP 或模型权限不对 |
| 429 | 触发 RPS / RPM，或并发任务上限 |

模型页上的名字是 “Gemini 4 Carbon”，请求里要填的是 **`gemini-4-carbon-economy`**。填成展示名会 400。
