# AIGF-API 2.0 渠道接口测试记录

测试日期：2026-10-19 23:53–23:57（北京时间）

对照文档：`AIGF-API 2.0 渠道对接文档_20261019.html`（文档版本 2026.10.17，依据 main `5c907cdf`）

环境：生产 `https://api.aiaigirl.com/aigf/v1`。请求头 `API-Key` 使用当次联调密钥。本文不记录密钥。

本次只验证目录读取、用户创建，以及一条剧本聊天全链路。图片、视频、语音生成没有提交，避免产生媒体计次。

## 结论

这把密钥可以完成「创建用户 → 创建剧本会话 → 异步发消息 → 轮询到 `usage.status=final`」。

当前渠道没有可用角色卡，普通角色房间聊天开不了。现成内容是 11 个多人剧本，加上图片风格、视频风格和姿势模板。文档里的世界书、预设、正则、滑动换回复都不在这 35 个接口里，这次也没有对应入口。

剧本会话在用户开口前就写入了亲密向状态栏。本轮回复没有接上开场里的酒馆、魔物和女骑士。

## 鉴权

| 请求 | HTTP | 结果 |
|---|---|---|
| `GET /characters/list`，不带 `API-Key` | 422 | `请求参数验证失败`，`header.API-Key` 缺失 |
| 同一接口，带渠道 `API-Key`，curl | 200 | `code=0` |
| 同一接口，Python urllib 默认客户端 | 403 | 未再复测。curl 同时可用，暂不能确定是 User-Agent 拦截还是瞬时拒绝 |

## 目录接口

### 模型 `GET /models/list`

HTTP 200，`data` 为 6 条。目录不返回价格。

| name | model | remark |
|---|---|---|
| `gemma` | `gemma4-31b-heretic-nvfp4` | 空 |
| `gemma4-26b-a4b-ultra-heretic` | `gemma4-31b-heretic-nvfp4` | 空 |
| `aigf-rpmax-04` | `aigf-rpmax-04` | 对齐 `app/llm/profiles.py` 常量 |
| `qwen3.6-27b-heretic-v2-mtp-nvfp4` | `qwen3.6-27b-heretic-v2-mtp-nvfp4` | extra 为 client.py 顶层读取的键 |
| `gemma4-31b-heretic-nvfp4` | `gemma4-31b-heretic-nvfp4` | 空 |
| `deepseek-v4-flash-0731-abliterated` | `deepseek-v41-flash-uncensored` | 空 |

`name` 和底层 `model` 可以不同。`gemma` 与 `gemma4-26b-a4b-ultra-heretic` 都指向 `gemma4-31b-heretic-nvfp4`。

### 角色卡 `GET /characters/list`

`page=1&size=8` 与 `page=1&size=50` 都是 HTTP 200，`total=0`，`items=[]`。

因此没有继续测角色详情、建房、普通聊天、消息配图、图生视频和消息语音。这些都依赖一个可访问的角色或一条已完成的 AI 回复。

### 剧本 `GET /scripts/list?page=1&size=50`

HTTP 200，`total=11`。本页 11 条，没有第二页。

| id | 标题 | primary_character_id | 标签 |
|---|---|---|---|
| 35 | 碎星遗誓：异界寻踪 | 空 | 无 |
| 34 | 逆风破晓：普通人的逆袭法则 | 空 | 无 |
| 12 | 贵族学院里的隐藏身份 | 41 | 校园、傲娇、反差、老师 |
| 11 | 初恋重逢后的都市恋曲 | 37 | 反差、性瘾、高冷、多人、暗恋、主导、邻居、男高、剧情、纯爱、攻略 |
| 10 | 皇城暗卫与四位贵女 | 33 | 修仙、职场、温柔、暗恋、内向、强势、男高、剧情、古代、支配 |
| 9 | 总裁助理的双面人生 | 30 | 职场、傲娇、温柔、反差、多人、强势、主导、男高、双性向、强制、精神控制 |
| 8 | 继兄回家后的秘密夏天 | 26 | 乱伦、邻居、兄妹、姐弟、攻略、羞辱、NTR |
| 7 | 侯府少爷姻缘录 | 22 | 病娇、暗恋、主导、大叔、剧情、古代 |
| 6 | 合租公寓里的故事 | 18 | 反差、人妻、自慰、多人、兄妹、姐弟、剧情 |
| 5 | 办公室恋爱禁止条例 | 15 | 职场、男高、大叔 |
| 4 | 转学生的心动校园日记 | 11 | 校园、傲娇、温柔、暗恋、老师、纯爱 |

id 4 的简介写明是高中最后一年。多个剧本带 `校园`、`老师`、`男高` 标签。id 8 带 `乱伦`、`兄妹`、`姐弟`。这是目录事实，本次没有进入这些剧本。

### 媒体目录

| 请求 | HTTP | 结果 |
|---|---|---|
| `GET /media/styles?type=image` | 200 | 3 条，均 `status=1`，底层模型字段为 `qwen` |
| `GET /media/styles?type=video` | 200 | 2 条 |
| `GET /media/styles?type=audio` | 200 | 0 条 |
| `GET /media/templates?type=image&category=pose` | 200 | 38 条，`status=1` |

图片风格：

| id | key | 名称 | max_size |
|---|---|---|---|
| 1 | `photo-style-01` | 真人写实 | 1280 |
| 2 | `photo-style-02` | 日本卡通 | 2048 |
| 5 | `photo-style-03` | 欧美卡通 | 2048 |

三条图片风格的 `prompt` 都是成人向场景说明，要求按角色设定出图。提交生图应传 `key`，不传展示名。

视频风格：`video-style-01` 真人写实，`video-style-02` 卡通动漫。

姿势模板 38 条，类别都是 `pose`。名称以性行为姿势为主，也有少量中性姿势（站立、蹲姿、淋浴、泡澡、坐姿托脸）。id 不连续，例如没有 9–15、21、34–37、48。本次没有提交生图，所以没有验证模板是否真的能出图。

## 用户创建

`POST /users/create`

```json
{
  "user_id": "cursor-probe-001",
  "username": "CursorProbe",
  "app_id": "channel-app"
}
```

HTTP 200，`code=0`。

| 字段 | 值 |
|---|---|
| user_id | `cursor-probe-001` |
| username | `CursorProbe` |
| avatar | `null` |
| app_id | `channel-app` |
| channel_id | 63 |

文档要求 `app_id` 由平台约定。这次用文档示例值 `channel-app` 创建成功，没有返回 409。未做重复创建和更换 AppID 的冲突测试。

## 剧本一轮

选的是 id 35《碎星遗誓：异界寻踪》。开场是边境酒馆、门外魔物、女骑士破门，不是成人向剧本。

### 创建会话

`POST /scripts/cursor-probe-001/sessions`

请求体：`{"script_id":35}`

HTTP 200。顶层另有 `already_exists: false`。

| 字段 | 值 |
|---|---|
| data.id | 110599 |
| session_name | 碎星遗誓：异界寻踪-游玩记录 |
| status | `active` |
| created_at | `2026-10-19 23:54:50` |
| 开场 | `opening_1` / `开场1`，正文 249 字 |

会话自带的模型配置：

| 字段 | 值 |
|---|---|
| model | `gemma4-26b-a4b-ultra-heretic` |
| mode | `simple` |
| temperature | 0.7 |
| top_p | 0.8 |
| presence_penalty | 0 |
| frequency_penalty | 0 |
| max_tokens | 9999 |

四名角色的状态栏在用户发消息之前就已经写好，而且和冒险开场不一致：

| 角色 | 好感 | 初始状态摘要 |
|---|---|---|
| 莉奥拉 | 15/100 | 心情为害羞、心跳加速 |
| 卡伦 | 15/100 | 心情为害羞；内心是想多了解这个陌生人 |
| 艾瑟兰 | 11/100 | 心情平静中带好奇；内心是心跳很快、不敢多看 |
| 修 | 未给好感数字 | 心情为害羞；侧身保持距离 |

场景状态只写了地点「星落大陆」，时间为空。

### 发送消息

`POST /scripts/cursor-probe-001/messages`

```json
{
  "session_id": 110599,
  "script_id": 35,
  "content": "我握紧吊坠，没有冲出去。先从门缝看清门外的人，再问她这里是哪里。",
  "client_request_id": "script-probe-001"
}
```

HTTP 200，立即返回，没有正文。

| 字段 | 受理时 |
|---|---|
| turn_id | `c295b161-7e57-49dd-819b-313345502cc5` |
| status | `running` |
| user_message_id / ai_message_id / text | 都是 `null` |
| usage.status | `collecting` |
| token 与 call_count | 都是 0 |

### 轮询

`GET /scripts/cursor-probe-001/turns/c295b161-7e57-49dd-819b-313345502cc5`

约每 5 秒查一次。正文在终态之前一直是空的，token 会先涨。

| 次数 | status | usage.status | total_tokens | 正文长度 |
|---|---|---|---|---|
| 0 | running | collecting | 2598 | 0 |
| 1 | running | collecting | 4214 | 0 |
| 2 | running | collecting | 4214 | 0 |
| 3 | running | collecting | 4214 | 0 |
| 4 | completed | final | 7248 | 453 |

从发消息到终态大约 20–25 秒。

终态：

| 字段 | 值 |
|---|---|
| status | `completed` |
| error | 空 |
| user_message_id | 153613 |
| ai_message_id | 153614 |
| usage.status | `final` |
| prompt / completion / total | 5509 / 1739 / 7248 |
| call_count / expected_call_count | 3 / 3 |
| stat_date | `2026-10-19` |

三次调用都是 `resource=llm`、`scene=aigf_script`、`purpose=main_reply`、`status=succeeded`、`quantity=0`。

| 调用 id | model | 输入 | 输出 | 合计 | gateway_request_id |
|---|---|---|---|---|---|
| 754942 | `aigf-rpmax-04` | 2193 | 405 | 2598 | `202610191554598485797648268d9d6UBllfzqi` |
| 754949 | `qwen3.8-27b-uncensored-fp8` | 1282 | 334 | 1616 | `202610191555046389017378268d9d6jvc6Qdf8` |
| 754959 | `gemma4-31b-heretic-nvfp4` | 2034 | 1000 | 3034 | `202610191555046417798308268d9d6f8ZgVuzi` |

三行合计与 `usage` 总分一致。会话配置里的 `gemma4-26b-a4b-ultra-heretic` 没有出现在本轮 `usage.models` 里。实际记账模型还有一个目录里没有的名字：`qwen3.8-27b-uncensored-fp8`。目录里相近的条目是 `qwen3.6-27b-heretic-v2-mtp-nvfp4`。

回复约 450 字。它没有写门外的女骑士和魔物，而是改到昏暗室内，让卡伦脸红、整理腰带，并说这里不是可以随意走动的神殿。用户问的「这里是哪里」没有得到和开场一致的答案。

## 和文档的差异

- 路径确实仍是 `/aigf/v1`，不是 `/aigf/v2`。
- 剧本消息立即返回 `running`，终态要靠轮询。本次没有接 WebSocket。
- `usage.status` 从 `collecting` 变为 `final` 后，输入、输出和三次调用都在。文档说的「完成即带 final 用量」在这一轮成立。
- 运行中的轮询已经能看到部分 token，但正文仍为空。不能用中途 token 当最终账单，也不能用中途查询显示回复。
- 角色目录为空，和文档示例里的 `character_id=20001` 对不上。示例 ID 不能直接拿来用。
- 媒体风格和姿势模板能读到，语音风格为空。

## 这次没测的接口

下面这些文档有，本次没有发请求。

- 角色详情、创建、导入、编辑
- 房间创建、列表、历史、删除
- 普通聊天 `POST /messages/{uid}/create`，以及轮次查询
- WebSocket `/websocket/{uid}/message`
- 剧本历史、`POST /usage/turns/{turn_id}/reconcile`
- `GET /usage/calls`、`GET /usage/daily`
- 消息配图、配图转视频、消息语音、文本语音
- 相册初级生图、进阶生图、进阶视频
- `POST /upload/image`
- 幂等重放：没有用同一个 `client_request_id` 再提交一次
- 同一 UID 更换 `app_id` 是否返回 409

## 测试身份

后续如果要接着测，用的是渠道用户 `cursor-probe-001`、剧本会话 `110599`、轮次 `c295b161-7e57-49dd-819b-313345502cc5`。这是联调探针，不是正式用户。
