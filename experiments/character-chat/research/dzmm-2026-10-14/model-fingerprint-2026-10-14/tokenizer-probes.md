# Offline tokenizer reference counts

**No DZMM native token usage has been observed by this kit. This is not model identification.**

| ID | Category | cl100k | o200k | Qwen3 | DeepSeek V3 |
|---|---|---:|---:|---:|---:|
| zh_common | Chinese, common | 41 | 26 | 19 | 16 |
| zh_rare | Chinese, rare characters | 46 | 39 | 29 | 36 |
| zh_traditional | Chinese, traditional | 38 | 24 | 19 | 14 |
| zh_mixed | Chinese/English/punctuation | 32 | 28 | 34 | 26 |
| en_morphology | English morphology | 20 | 21 | 20 | 18 |
| code | Python code | 27 | 27 | 27 | 27 |
| digits | Long digit runs | 32 | 32 | 92 | 32 |
| numbers | Numbers and separators | 43 | 43 | 68 | 45 |
| whitespace | Whitespace and indentation | 19 | 18 | 19 | 19 |
| emoji | Emoji, ZWJ and modifiers | 59 | 42 | 38 | 43 |
| unicode_nfc | Unicode NFC | 16 | 13 | 16 | 14 |
| unicode_nfd | Unicode NFD | 30 | 25 | 16 | 28 |

The exact UTF-8 text, hashes, and token IDs are in `tokenizer-baseline.json`. Counts exclude message wrappers and special tokens.

## Pairwise separation after an unknown constant offset

For each pair, the range below is max(count difference) minus min(count difference) across the 12 probes. A nonzero range means these finite reference vectors cannot be made identical by adding one constant. It does not establish separation from all other tokenizers or shared-tokenizer models.

| Pair | Range of count differences |
|---|---:|
| cl100k_base / o200k_base | 18 |
| cl100k_base / qwen3 | 82 |
| cl100k_base / deepseek_v3 | 27 |
| o200k_base / qwen3 | 70 |
| o200k_base / deepseek_v3 | 13 |
| qwen3 / deepseek_v3 | 72 |
