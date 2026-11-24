# 角色风格对比

当前心动陪伴验收用 `node evaluations/companion.mjs` 查看离线计划。加 `--live` 最多6次实际请求，两位角色各3个独立合成会话；`--character yume` 限单角色，`--case action-bait` 可只复测对应场景。其他 case 为 `new-affection` 和 `familiar-concern`。保存原始对白、请求正文和前后源码哈希；后台熟悉阶段明示为人工 fixture。标签/动作包装按生产格式检查，第三人称启发式只提示人工复核，不打可爱分。最终快照须包含新增的 dialogue-contract.mjs 与既有 proactive-runtime.mjs。最新实际记录和限制见 `../research/2026-10-14-companion.md`。

`presence.mjs` 用固定的中性用户脚本比较两个版本，每个版本调用各自的 `createSession`、`prepareTurn`、`buildMessages`、`parseResponse` 和 `commitTurn`。它不访问用户存档，也不读取真实用户聊天。默认的四个场景是 Yume / Nari 各一组安静陪伴和轻微撒娇，共 20 轮；比较两个版本需 40 次模型请求。

先查看计划，不联网、不消耗模型额度：

```sh
node evaluations/presence.mjs --baseline /tmp/character-chat-presence-v1 --variant both
```

只选一组和两轮，小范围比较；只有加 `--live` 才请求真实模型：

```sh
node evaluations/presence.mjs --baseline /tmp/character-chat-presence-v1 --variant both --scenario yume-quiet --turns 2 --out /tmp/yume-presence-comparison.json --live
```

版本目录必须包含可导入的 `engine.mjs` 及 `characters.mjs`，各版本会话独立。凭据与模型由当前服务的 `loadEnvironment()` / `providerConfig()` 读取；请求参数和聊天服务相同。模型标识、源码 SHA-256、固定的模拟时间、提示内容、完整回复、终止原因、用量、延迟和每轮记忆引用核对写入 JSON，凭据、请求头和原始 HTTP 错误体不会保存。

相邻场景交替版本运行顺序。默认模拟时间为 2026-10-07 10:00（Asia/Shanghai），每轮推进一分钟，可用 `--start-time` / `--time-zone` 改变。`yume-familiar` 为可选的人工关系状态夹具，需显式 `--scenario yume-familiar` 或 `--include-familiar`；其熟悉程度不是通过真实历史建立的，报告会注明。

`yume-style` 是可选的表达偏好场景，覆盖一句话撒娇、称呼纠正、短回复与临时停止撒娇，需要显式 `--scenario yume-style`。它不自动加入默认四组或熟悉关系场景。

`yume-content` / `nari-content` 是可选的实际内容场景：让角色选择轻松话题，用“嗯，然后呢”接话，再要求换题。Yume 另外覆盖具体职场烦恼与拥抱晚安。比较示例：

```sh
node evaluations/presence.mjs --live --baseline /tmp/character-chat-tavern-baseline --variant both --scenario yume-content --out evaluations/results/tavern-content-yume-2026-10-07.json
```

每次使用新的输出文件名保存后续迭代，避免覆盖已完成的比较记录。

`yume-memory` 为两轮可选场景：明确姓名与游戏偏好，随后询问回忆及尚未提供的住址，验证轻量生成后的来源与未知事实边界。

输出文件每轮原子保存。HTTP、超时或解析错误会记录失败和已完成轮次，并以非零退出码结束。中断也会尽量保留已完成内容。每次运行从头开始，不做隐式重试或断点续跑；请为后续运行选择新的 `--out` 文件，避免覆盖旧实验。

这些脚本检查回应方式、用户纠正、短回复、话题结束和语言切换，适合小规模探索。记忆来源核对只验证保存记录中的引用，不把关键词命中当“活人感分数”。请匿名随机排列两个版本的回复，由人比较角色声音、是否接住用户意图、是否过度安慰、是否反复追问、是否自然收尾并注明原因。固定脚本不会随回复自适应；不能单靠这组结果证明开放聊天或长期关系质量。

## 分条回复和主动补话

`initiative.mjs` 使用当前生产 provider 的同一请求方式，六次中性调用覆盖 Yume 普通轮/主动轮/小情绪/一句话要求，以及 Nari 普通轮/主动轮。默认只写计划，`--live` 才生成。主动步骤明确模拟15秒空闲；界面实际等待、输入取消与显示节奏需另做浏览器验证。

```sh
node evaluations/initiative.mjs --out /tmp/initiative-plan.json
node evaluations/initiative.mjs --live --out evaluations/results/initiative-2026-10-07.json
```

报告保存模型 ID、low配置、四个模块的源码哈希、实际请求与回复、用量、延迟、分条结果及来源检查。主动数组为空是允许的结果；不将“不主动说话”自动判为失败。输入全为自写脚本，无用户存档；不保存凭据或请求头。

## 2026-10-11：真实多轮与开场主动

新 `cute-presence.mjs` 通过快照中真实的 `provider.generate` / `generateInitiative({now})` 运行：Yume12轮、Nari8轮，覆盖短招呼、撒娇、贡献内容、称呼/记忆、换题、临时办事、一句话和去忙。`initiative` 场景最多5次请求，测试开场两个到期机会、一次真实用户输入与之后两个到期机会；模型结束计划时不强制续链。

```sh
node evaluations/cute-presence.mjs --character yume --scenario natural
node evaluations/cute-presence.mjs --live --directory /tmp/character-chat-release-snapshot --character nari --scenario natural --out /tmp/nari-natural.json
node evaluations/cute-presence.mjs --live --directory /tmp/character-chat-release-snapshot --character yume --scenario initiative --out /tmp/yume-initiative.json
```

快照包含 engine/characters/provider/server，当前版本也须有 streaming.mjs。每步原子保存请求正文、原始JSON输出、结果、前后会话、用量、时延与源码哈希，不存请求头或密钥。默认不读取环境、不联网、不写用户存档。主动评估只推进模拟时间到实际 notBefore，不伪造用户消息；休息和新输入取消的末尾单元检查明确标为合成检查。

首批 `release-2026-10-11-*-natural.json` 是**未发布的第一候选版**，实际出现笔记/画纸重复；`candidate-v2-*` 是小事生命周期版本（其中 Yume 第5次调用因 `beat:null` 被错误拒绝），`candidate-v3-*` 是兼容修复后的版本（仍有被动和薄内容）。这些记录保留失败证据，不当作最终效果。

`final-2026-10-11-*` 对应上一轮交付，随后用户明确指出不够 diverse，不能继续作为当前修订的效果证明。`*-natural.json` 保存未挑选多轮，`*-initiative.json` 保存实际模型主动/安静选择，`*-live-ui.json` 保存临时浏览器服务的生产 provider 请求与完整消息流时序。最新发布记录和实际限制见 `../VERIFICATION.md`。模拟到期时钟只验证主动生成内容与状态，真实页面等待、输入取消和显示节奏由浏览器另验。

## 回复多样性与具体意图

`diversity.mjs` 每角色9次：6轮连续聊天（低信息、续聊、换题、具体问题），再用相同开放输入独立开局3次。每步保存完整请求、原始输出、写作方向、usage和前后会话，不把题材标签或气泡数当质量分数。默认只生成计划，不读凭据、不联网；只有 `--live` 调用模型。

```sh
node evaluations/diversity.mjs --character yume
node evaluations/diversity.mjs --directory /tmp/frozen-version --character nari --out /tmp/diversity-nari.json --live
```

固定快照必须有 engine、characters、conversation-direction、provider、streaming、server 六模块。`cute-presence.mjs` 也记录新依赖，仍兼容之前四/五模块快照。输出使用新的版本文件名：`diversity-v1-*` 为中断候选，`diversity-v2-*` 为发现切入抢掉用户具体问题的候选，后续记录保留完整轨迹供人工比较，不能只挑最好听的一句话。

## Companion transcript benchmark

`companion-benchmark.mjs` 是不调用模型的硬回归门。它读取一段 `{ role, text, kind?, intentKey? }` 消息，检查四类最容易让角色显得像模板的问题：完全重复和近似重复、用户发言后仍沿用旧话题的主动连发、模型声称看到了头像/上线/回信等它无法观察的界面事实，以及重复追问。主动消息如果携带同一个 `intentKey`（例如 `game_coop`），即使换了说法也会命中同意图连发。结果同时给出原始命中位置、类别分数和通过条件；分数用于定位回归，不能替代人工对语气和关系感的判断。

先跑内置的反例（对应最近的 Yume 轨迹）：

```sh
npm run benchmark
```

它应当失败并报告 `noExactDuplicates`、`noNearDuplicateBursts`、`noStaleProactiveBursts` 和 `noUngroundedObservations`。用健康样例检查基线：

```sh
node evaluations/companion-benchmark.mjs --fixture healthy
node evaluations/companion-benchmark.mjs --input /tmp/chat-transcript.json --out /tmp/companion-audit.json
```

这组检查是应用层的可重复验收，专门防止“生成了几条听起来不错的句子”掩盖连续上下文里的重复；正式体验仍需要匿名的人评和多轮场景测试。

`npm run test:ui` 运行 `frontend-smoke.mjs` 的36项离线DOM检查，覆盖流式预览/最终替换、草稿、失败重试、过期与取消，以及独立生活机会、presence 唤醒、无事件停止与输入/隐藏/安静门控。只执行本地模拟，不启动浏览器、读取模型配置或调用网络；真实界面证据另存上述浏览器记录与截图。

## 2026-10-12：角色自己的持续事项

`node evaluations/agency.mjs` 保存计划；加 `--live` 最多调用 6 次，`--character yume` 或 `--character nari` 限定为 3 次。流程是实际建立自身事项、模拟时间到期并耗尽旧续聊预算、一次具体主动机会、一句告别。输出保存原始模型文本、使用量、调用参数、状态和代码哈希；不读取用户存档。模拟时间只检验机会与提交，不证明现实动作或后台送达。

`node evaluations/replay-agency.mjs` 使用两份保存的历史真实文本，在当前 engine 中重新 parse/commit。它禁止网络，输出源记录和最终代码哈希，并核验生活进展与来源、预算隔离、机会消费、用户事实/关系不变及告别暂停。重放不是新模型生成或可爱度评测。详细候选失败与最终证据见 `../research/2026-10-12-proactive-core.md`。
