# NariYume 模型与 tokenizer 指纹核验

## 结论

当前仍不能仅凭 tokenizer 命名 NariYume 的底层模型，但已经取得一条真实 completion 计数。离线参考向量可以区分 `cl100k_base`、`o200k_base`、Qwen3 和 DeepSeek-V3 这四类 tokenizer；本次 NariYume 返回的原始内容为 `今天吃到了热乎乎的早餐，心情很好。🙂 [happy]`，响应给出的 `completion_tokens=16`，恰好与 Qwen3 参考 tokenizer 的裸文本计数一致。DeepSeek-V3 和 `o200k_base` 各为 15/17，`cl100k_base` 为 31。这个结果是“Qwen3 tokenizer 兼容”的弱指纹，不是模型身份确认：一次短输出可能被 EOS、特殊 token、供应商计数范围或输出包装抵消 1 个 token，且多个模型可以共享 Qwen 系 tokenizer。

静态前端给出了一条更短、证据等级更高的确认路径：请求不携带 `model` 或 `provider` 参数，响应解析器却读取 `m.model`、`m.provider` 和 `m.usage`，并读取 `x-nariyume-openrouter-route`。若在本人正常登录会话中保存一次合法 `/api/chat` 响应的这几个字段，模型名通常可以直接确认；如果服务端省略它们，再进行 tokenizer 差分。

## 离线参考实验

本目录 [tokenizer-candidates](tokenizer-candidates) 生成了 16 条探针，覆盖中文、英文、emoji、NFC/NFD、代码、数字、随机 ASCII 和聊天格式。参考计数如下（顺序为 `cl100k_base / o200k_base / Qwen3 / DeepSeek-V3`）：

| 探针 | 计数 |
|---|---:|
| `zh_common` | 41 / 26 / 19 / 16 |
| `zh_rare` | 46 / 39 / 29 / 36 |
| `zh_traditional` | 38 / 24 / 19 / 14 |
| `emoji` | 59 / 42 / 38 / 43 |
| `unicode_nfc` | 16 / 13 / 16 / 14 |
| `unicode_nfd` | 30 / 25 / 16 / 28 |
| `chat_chinese` | 41 / 29 / 26 / 23 |
| `chat_english` | 19 / 18 / 19 / 19 |

最接近的一对是 `o200k_base` 和 DeepSeek-V3，16 条探针的最小分离仍为 13；这说明即使拿到一组真实计数，也要固定包装、隐藏上下文、历史、摘要和 Unicode 清洗，不能只看一条中文句子的长度。共享 tokenizer 的不同模型也无法靠 token 数区分，模型尺寸、微调、量化和 OpenRouter 路由更无法由 tokenizer 计数推出。

## NariYume 实际运行观测

在用户自己的已登录 Chrome 会话中发送了一条中性测试消息。DevTools Network 列表和 Response 面板可见：

```text
POST https://www.nariyume.com/api/chat
status: 200 OK
type: fetch
duration: about 1.47 s
transferred/resource size: about 1.5 kB
usage.prompt_tokens: 3659
usage.completion_tokens: 16
usage.total_tokens: 3675
usage.prompt_tokens_details.cached_tokens: 2048
response header x-nariyume-openrouter-route: gateway
server-timing: auth=0, admission=127, brain=165, relay=877, openrouter=662
```

`cached_tokens=2048` 占本次 prompt usage 的约 56%。这与“稳定的角色/系统前缀进入上游 prompt cache、变化的 history/dynamic 放在后缀”的架构相容，但 OpenRouter 的缓存口径没有在响应里说明，不能把 2048 直接当作 system prompt 长度。

页面随后展示了指定的 18 个 Unicode 字符：`今天吃到了热乎乎的早餐，心情很好。🙂`；Response JSON 的原始内容还带有 `[happy]`。响应没有返回 `model` 或 `provider` 字段，因此具体模型仍未知；但 token usage 和 OpenRouter 路由元数据已经得到。响应大小不能反推 token 数。

## 为什么 tokenization 不能直接“测模型”

对一个未知服务，观测到的 token 数大致是：

```text
实际 prompt token = system + developer + 角色卡 + memory + summary + history
                   + 当前消息 + 消息模板 + tokenizer 特殊 token
```

NariYume 的 `dynamic` 每轮会带关系等级、用户事实、情绪、共享故事、时间和主动消息标记；这些字段在服务器端还可能被拼成隐藏 prompt。未知常量远大于不同候选 tokenizer 在短句上的差异，因此一次 `prompt_tokens` 无法反解。需要固定同一会话、同一 history 和同一请求模板，至少发送三组长度/字符集不同的探针，再对 token 差分拟合候选 tokenizer；这也只能得到 tokenizer 兼容性，不能得到模型权重身份。

## 下一次可直接执行的核验

保留本人会话中后续响应的非内容元数据即可；本轮已经拿到一条真实样本：

```json
{
  "model": null,
  "provider": null,
  "usage": {
    "prompt_tokens": 3659,
    "completion_tokens": 16
  },
  "headers": {
    "x-nariyume-openrouter-route": "gateway"
  }
}
```

删除 Authorization、Cookie、Firebase token、请求消息和历史内容后，再将更多 `prompt_tokens`/`completion_tokens` 填入 [prompt-observations-template.json](tokenizer-candidates/prompt-observations-template.json) 和 [completion-observations-template.json](tokenizer-candidates/completion-observations-template.json) 做差分。不要把角色自报模型、SSE 分块数、页面显示字符数、打字动画速度或响应字节数当作 native token 计数。

## 证据等级

- **已观察**：同源 `/api/chat` 返回 200；响应给出 `prompt_tokens=3659`、`completion_tokens=16`、缓存 2048；`x-nariyume-openrouter-route=gateway`；Server-Timing 含 `openrouter`；客户端读取 `model/provider/usage`；中文说明提到 NariYume 服务端 → OpenRouter → 路由模型服务商。
- **可复现参考**：四组本地 tokenizer 的 16 条探针向量，脚本和 SHA-256 资产在 [tokenizer-candidates](tokenizer-candidates)。
- **未取得**：本轮真实响应 JSON 的 `model/provider`、最终 system prompt、服务端路由配置。`usage` 已取得，但不能单独命名模型。
