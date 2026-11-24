# 离线 tokenizer 参考向量

以下为本地官方 tokenizer 实测，不是 NariYume/DZMM 的目标观测。

| ID | cl100k | o200k | Qwen3 | DeepSeek V3 |
|---|---:|---:|---:|---:|
| zh_common | 41 | 26 | 19 | 16 |
| zh_rare | 46 | 39 | 29 | 36 |
| zh_traditional | 38 | 24 | 19 | 14 |
| zh_mixed | 32 | 28 | 34 | 26 |
| en_morphology | 20 | 21 | 20 | 18 |
| code | 27 | 27 | 27 | 27 |
| digits | 32 | 32 | 92 | 32 |
| numbers | 43 | 43 | 68 | 45 |
| whitespace | 19 | 18 | 19 | 19 |
| emoji | 59 | 42 | 38 | 43 |
| unicode_nfc | 16 | 13 | 16 | 14 |
| unicode_nfd | 30 | 25 | 16 | 28 |
| random_ascii | 88 | 87 | 93 | 87 |
| random_hex | 71 | 72 | 113 | 73 |
| chat_chinese | 41 | 29 | 26 | 23 |
| chat_english | 19 | 18 | 19 | 19 |

参考向量允许常量偏移后仍可分；未覆盖候选不能被排除。

| Pair | 差值范围 |
|---|---:|
| cl100k_base / o200k_base | 18 |
| cl100k_base / qwen3 | 82 |
| cl100k_base / deepseek_v3 | 27 |
| o200k_base / qwen3 | 70 |
| o200k_base / deepseek_v3 | 13 |
| qwen3 / deepseek_v3 | 72 |
