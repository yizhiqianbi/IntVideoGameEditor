# NariYume 公开前端取证与行为规格 · 2026-10-12

这是静态代码取证，范围是两个公开入口 HTML 及其明确声明的前端依赖。没有注册、接受付费条款、调用推理、读取登录用户数据、请求 vault-key、破解封装资产、猜测隐藏路径或探测服务器。主聊天后端的完整人设与 system prompt、真实模型 ID、采样配置及供应商路由仍不能从这些前端资源恢复。

**最值得学习的实现是：客户端主调用整段接收一个 content 字符串，再派生消息气泡；公开前端分别实现人物长期状态、主动触发、语音节奏和本地存储/云同步协议。**这不能证明后端只调用了一次 LLM，或模型供应商到后端之间没有流式传输。这里也没有“角色每隔几秒后台独立思考”或“多条消息一定由模型输出数组”的前端证据。

## 取证范围与可复查位置

新入口：`https://nariyume.com/app/`，应用入口 `index-DK0MxpT_.js`，主程序 `main-BHN5IlOI.js`。工作室入口：`https://www.nariyume.com/studio`。主程序为 772,079 字节；SHA-256 **32a8543b66faa82925f1baf9b7236bdb870397d4068742d58b2d27e48b1ff9c1**。与 2026-10-06 记录的 `main-DDqgCAPJ.js`（708,256 字节，SHA 7f8f260dc286cd67d4f44e786637b864008f35e917d65a1f0afc3d5396da3762）不同，不能沿用旧符号偏移。

`asset-index.json` 包含 367 个已声明并取回的 URL，366 个独立文件，共 8,101,362 字节；重复 URL 路径别名记为独立 URL。`declarations.json` 保存父资源和声明位置；`declared-not-downloaded.json` 明确列出未取回的 187 个声明（186 个其余预制语音 bank JSON、一个 Stockfish lazy JS）。没有下载视频、音频、图片、角色加密包或 map 猜测地址。已取回 JS 未声明外置 sourceMappingURL，因此未猜测 `.map` 地址。此处“可复查”指静态资源范围，**不代表服务器源码、运行配置或全部产品功能已经恢复**。

`code-index.json` 有 112 个定位点，字段包含 URL、SHA、0-based UTF-8 byte offset、0-based Unicode character offset、1-based line/column。以下短名称都是这一个版本里的 minified 符号。不要将旧版本同名符号理解成同一函数。

| 资源 | SHA-256 | 用途 |
| --- | --- | --- |
| [主程序](https://nariyume.com/app/assets/main-BHN5IlOI.js) | 32a8543b66faa82925f1baf9b7236bdb870397d4068742d58b2d27e48b1ff9c1 | 聊天、状态、记忆、语音、渲染、账户 |
| [入口](https://nariyume.com/app/assets/index-DK0MxpT_.js) | 1cb7db7bf538efd392a716a6d062572d46d5186adb1ad8f43226b6705df98201 | Vite lazy loader、账户隔离 storage facade |
| [写信](https://nariyume.com/app/assets/LettersScreen--aSE0-WC.js) | 950496edcca5aa9d2fe3bb2b722fef2f940024114fb44c967b147eee2759881a | 辅助功能的客户端 prompt，非主聊天 prompt |
| [活动包装器](https://nariyume.com/app/assets/nariGamesLLM-CL9Fg148.js) | c2cf88043d49b8c1d0b748d8099cdb39122f13d8e53b478d711360cf799e4908 | oneShot/activity/game 完成协议 |
| [预制语音索引](https://nariyume.com/app/assets/nativeVoiceIndex.generated-B9Kep8LJ.js) | f4473c9041a8b2edd64790a7adb972bb8a7c8c22750a65e777aef6b6020a25f9 | 场景→语音 bank URL 映射 |
| [本地化脚本](https://nariyume.com/app/assets/scripted-87fnqvAW.js) | e181a805cf6331c50ead0b7862f5fccaf5b14699fb789ada18545fcd142e5837 | 预写台词与带 SHA 的录音匹配 |

## 1. 前端模块与路由

确定：Vite 打包、React 18.3.1，Firebase JS SDK 12.18.0 用于身份认证。Firebase 项目公开配置位于 `jd`，认证域 `auth.nariyume.com`，project ID `nariyume-93564`；不将公开 Firebase 配置误叫为 LLM 密钥。当前 bundle 有 Firebase email/password、Google popup/redirect、email verification 等路径，以及自家 X OAuth start/finish。外发到 Firebase Cloud Functions 的公开 `authEmail` 路径仅用于账户邮件，不能据此认定聊天后端也在 Cloud Functions。

主界面是 React 状态/overlay 导航。`pM` 用 `history.state[ny.surface.v1]` 保存 `{version:1,depth,route}`；route 的 overlay 为 none/apps/settings/paywall/billing/scrapbook，activity 是可选字符串；使用 pushState/replaceState/popstate。`?feature=letters` 深链接到 apps/letters，`?account=billing` 到 billing。启动状态由 `bj` 选择 checking/welcome，再按认证和资料完成度转向主屏或名称/生日填写。Studio 是独立静态 HTML/CSS 页面。

可见状态主体：`mu` 负责用户资料、历史、关系和 memory graph；`PE` 是聊天会话协调器；`kE` 是 mood/arc/moments/memory harness；`ME` 是摘要器；`aE` 是批量记忆任务；`xi` 是人设提醒器；`vt` 是语音播放；Koro stage 负责 WebGL 人物。

## 2. 主聊天请求协议与重试

`PE.send` → `buildTurnRequest` → `gy` 冻结逻辑请求 → `Sf` → `hn` → `POST /api/chat`。请求需要 Firebase Bearer 身份，携带 `x-nariyume-timezone`。`gy` 把本轮请求复制并序列化，绑定 UID 与 `clientTurnId`；重试只替换 `rungIndex`，不会重新读取正在变化的记忆/时间/生日等上下文。这减少了同一逻辑回合重试时的漂移。

可见主请求形状（省略未定义字段）：

```json
{
  "kind": "chat",
  "characterId": "Nari | Yume",
  "clientTurnId": "uuid",
  "rungIndex": 0,
  "history": [{"role":"user | assistant | system","content":"...","ts":0,"imageDescription":"optional"}],
  "conversationSummary": "optional",
  "userMessage": "...",
  "imageDataURL": "optional",
  "pronunciation": {"name":"optional","override":"optional"},
  "locale": "non-English only",
  "dynamic": {
    "firstConversation": true,
    "userName": "...",
    "birthdayISO": "YYYY-MM-DD",
    "ageBand": "18-24",
    "justSubscribed": true,
    "affectionLevel": 1,
    "userFacts": ["..."],
    "harness": {"mood":"...","selfRecall":[{"key":"...","value":"..."}],"sharedStory":["..."]},
    "stickerCue": "optional",
    "lastAssistantAt": 0,
    "streakDays": 0,
    "gameRecord": {"game":"...","w":0,"l":0,"d":0},
    "nowMs": 0,
    "tzOffsetMinutes": 0,
    "personaReminder": "periodic | tier | mood | tier-mood | null",
    "proactive": {"kind":"...","key":"...","theme":"optional","entities":["optional"]}
  }
}
```

`buildTurnRequest` 的相关性检索输入是本轮消息加最近六条 wire 内容。默认不把 system prompt 或 model ID 放在主请求里；最强的结构推断是后端按 characterId + dynamic 装配主提示词与选择模型，但不能知道具体措辞、优先级或是否另有服务端检索/分类。

重试 rung 默认 6 次；部分路径 3 次；rung 之间间隔 400ms，后续尝试有 75s 总时长检查，每次 fetch 60s 超时。网络/timeout 类失败会重复较低 rung，其他失败可能继续提升 rung。429 `inference_in_progress` 最多等待重试 22 次，按 Retry-After 限于 250–3000ms；503 admission 超时/不可用可再等 500ms 重试一次。401/特定403可强制刷新身份。413 为 context error，402 进入额度/订阅提示。**rung 的具体模型/参数映射在后端，无法由次数反推出模型序列。**

主响应被 `await response.json()` 完整接收；内容读 `choices[0].message.content`，同时可读 `provider/model/usage/budget/pilot/voiceGrant`。没有在这条客户端主调用链里看到 token 级 SSE、WebSocket 或长轮询；这不限制后端内部调用次数，也不能判断模型供应商到后端的传输是否流式。`ReadableStream/getReader` 出现在语音/资源/同步等模块，不等于客户端 LLM token stream。存在 `chat_cheap_lane_v1` 实验及 `x-nariyume-lane: cheap/control` 曝光记录；403 时检查 `x-nariyume-openrouter-route`，这是当前程序有 OpenRouter 路由处理的证据，不是某次请求实际经过该路由的实测。

## 3. 响应解析、保存与展示是三个不同层次

`D2` 先清除 think/thinking/reasoning/scratchpad 等包裹；还有对明显英文推理开头的最终回答提取启发式。它不证明模型一定启用了 reasoning，更不等于看到了服务端思维链。

`xf` 解析 `<reply>` 可选外壳、`<text>`、`<emotion>`、`<photo_description>`；也接受末尾 `[emotion]` 风格的兼容标签。末尾方括号情绪优先于 XML emotion。支持 happy/sad/angry/surprised/shy/loving/playful/flirty/sexual/neutral，以及 silly→playful、saucy/spicy→sexual。清除 metadata/残余 tags 后，把双换行段落解析为 `bubbles`，`text` 仍是完整文本；图片描述单行化并限制 280 字符。空文本有内置丢失思路 fallback。

**但显示路径 `PE.presentReply` 不使用 `xf.bubbles`，而重新对整条 `e.text` 调用 `BE`。**完整回复只存一条 assistant history / wire；wire 内容带回末尾情绪标签。显示气泡的第一 ID 复用原 ID，其余为 `:piece:N`，携带 `{sourceMessage:{id,text,pieceIndex}}`。一条 LLM 回复与多条 UI 气泡是明确的不同实体。

`presentReply` 还按语言替换长破折号；`i=false` 路径保存/同步消息后直接结束，不执行人物反应和分泡播放。普通路径先映射情绪表情/动作，再生成显示气泡，经过 `revealBubbles`。摘要刷新通常等呈现完成后开始。

### 可独立实现的 PE 分块行为规格

以下描述的是 `PE/BE` 产生的逻辑 piece 与 TTS/caption 分块，**不是最终 DOM 消息行的全部拆分规则**。ChatLayer 还会再次拆行，见随后补充。

定位：`Gn` byte 371971；`wu` byte 372386；`ml` byte 372611；`zt` byte 371784；`BE` byte 430641。具体行列见 code-index。

1. 空白文本返回空数组。只有一个可识别句子时，返回完整 trim 后的原文本。
2. `Gn` 逐行处理非空行，保护 URL/email/path、3.5 等小数、英语常见缩写、首字母人名、列表编号与省略号；随后依据句末标点、空格和后继词特征分句。CJK 另以 `。！？` 或跟在中日韩字前的 `!?` 作为边界；边界紧跟部分闭引号/括号时有保护，不应简单做 punctuation.split。
3. 计量 `ml`：先按 Unicode 空白切片；没有字母/数字的片段计 0。有字母/数字的片段计 `max(1,其中 Han/Hiragana/Katakana 字符数)`。因此普通英文单词约 1 单位，中文每字 1 单位。韩文 Hangul 未在这个单字计数分支里。
4. 第一气泡先取一句，若累计少于 4 单位并且还有句子，则继续并入后句，直到至少 4 或耗尽句子。后续每两句合为一泡；最后只余一句则单独一泡。**输出并没有固定最多三条的限制。**
5. 合并规则 `zt`：中文标点/CJK 相邻时直接连接，英语一般插入空格。原始双换行不是最终气泡的一对一界线。
6. `BE` 优先 `replyBubbleChunks` 即 `wu`；若该函数不存在则回退到句子检测后每两句一泡，最终才回退双换行。

`bubble-contract.json` 保存七个从静态代码推导的合成例子；`offline-parser-audit.json` 通过本地隔离执行已审查的纯解析片段验证了7/7，另检查小数/缩写、URL、CJK闭引号边界。它们不是实测的远端回复；执行没有模型/API/网络请求，也没有DOM或账户访问。这些文件中的 `expected_display_bubbles` 只验证 `wu` 的第一层结果，不能当作最终 ChatLayer DOM 行数。例如「嗯。想你啦。今天下雨了。我没带伞。」对应两个逻辑 piece：首块「嗯。想你啦。」（1+3达到4），后块「今天下雨了。我没带伞。」。一句「我想你。」只有3字，会与后句「你呢？」合并；「我有点想你。」5字则可以单独作为首块。

### 补充：ChatLayer 还会再次拆成 DOM 消息行

新一轮原站 DOM 观察报告出现 `:piece:5:sentence:39`、`:piece:6:sentence:30`，促成对后续渲染层的复核；此处只静态读取归档代码，没有操作原站。确定路径为 **`rI(ChatLayer)` → `Im` → `Nw = eI(text,tI(bubble))` → `JS(分行,已揭示文本)` → `data-chat-id` rows**。最终气泡行数量可以多于 PE piece 数，并不是额外 LLM 调用或服务端另发了一条消息。

`Im` 给当前 bubble 的第一 DOM 行保留 `bubble.id`，后续行 ID 为 `bubble.id + ':sentence:' + start`。这里 start 是**当前 bubble.text 内的 UTF-16 起始位置**，不是句子编号或 token 编号。即时呈现时当前 bubble.text 是一个 PE piece，所以可以同时有 `:piece:N` 和 `:sentence:K`，K 为该 piece 内位置；历史重建时当前 bubble.text 是保存的完整回复，K 则变为全文位置，见下节生命周期。

当前新消息的规则（`ts ≥ 2026-10-05 15:20 UTC`，北京时间10月5日23:20）：

1. `tI` 用同一个 `Gn` 分句，再用 `Rw` 将句子重新定位到原字符串。必须按顺序完整覆盖原文本，间隙只能有空白；定位失败回退为原文本整块。若有 sourceMessage，使用原完整回复 ID 和 pieceIndex；恢复历史没有 sourceMessage 时，先按 `wu` 重建 PE 分块，再应用同样分行逻辑。
2. `Cm` 按含 Unicode 字母/数字的**句子数**分组，纯标点/emoji句段会附着在相邻组。它不采用4词、4汉字或字符长度门槛。**pieceIndex=0 固定每一个有内容的句子单独一行**，所以 PE 首块为了达到4词合并的短反应，渲染层仍可能再次分开。
3. 后续 piece 通常每两句一行，但有稳定变化：令 `r=pieceIndex−1`，每五个后续 piece 一组，以 `${原回复ID.toUpperCase()}:${floor(r/5)}` 做32位FNV式hash；`r%5 == hash%5` 对应的那个 piece 改为每一句一行，其余每两句一行。每个五-piece组恰有一个位置采用单句规则，ID与pieceIndex决定，同一消息回放结果稳定。逻辑piece 5与6跨组边界，因而可以都出现额外`:sentence:`行。
4. `Tw/ZS` 尝试维护原句段尾部换行边界；随后 `eI` 还按 `/[^\S\n]*\n\s*/gu` 将有非空文本的换行两边切成行。这一步也作用于用户消息及旧消息，不只是助手；多个空行归入同一个边界，不生成空白消息行。
5. `JS` 随已揭示字符串过滤行：首行保留，后续行只有其对应区间已出现非空文本才进入 DOM。`jw` 控制 piece 内逐字揭示，done 或 reduced-motion 时直接显示完整文本。因此一段正在播放的逻辑piece能逐渐“长出”更多DOM气泡，音频仍按上层piece播放，不会因新DOM行而另生成一次TTS。

兼容旧消息的日期门槛：`Lu=2026-09-29 10:40 UTC`；此前助手按原整块；Lu到`zS=2026-09-29 11:20 UTC`间的助手使用 `VS` 的逐有内容句分行；zS到上述10月5日门槛之间改用旧 `XS` 分组（每三个非首piece一个位置取两句，其余取一句）。用户、无有效时间或更早历史由 `VS` 先回退原块，随后仍会经过换行拆分。不能将当前新消息规则直接套到所有旧历史。

精确定位（同一主bundle SHA，0-based UTF-8 byte offset）：`jw` 581006、日期门槛581504、`VS`581596、`JS`582004、`XS`582139、`Rw`582353、`ZS`582668、`Cm`582915、`eI`583199、`Nw`583521、`tI`583560、`rI`585996、`Im`592340、`:sentence:`593135。`XS`至`tI`在line469，`rI/Im/DOM ID`在line470。新增定位仅补充在本报告，原112条code-index和7条离线fixture未覆盖这一渲染层。

### 补充：即时 piece 与历史重建的生命周期

另一条实时 DOM 观察报告指出，同一原始 UUID 的 `:piece:N` 在回复完成、恢复可输入状态后消失，变成原始 UUID 下的 `:sentence:34/44/86/90/...`，并出现单独的字面量 `**` 消息行。静态代码能解释这种转换，但此次没有实时事件追踪，不能确定那一刻具体是哪次同步或状态更新触发重建。

`PE.presentReply` **先保存一条完整回复 h，再创建临时 UI pieces**。保存的 h 只有 `id/role/text/characterId/ts` 以及条件 gated；`sourceMessage:{id,text,pieceIndex}` 在保存之后才加入另一个数组 m。`mu.appendHistoryBatch([h])` 将 h 记入 chat journal、history cache 和本地持久化。客户端云序列化 `P0` 与恢复 `$p` 也没有 sourceMessage 或 pieceIndex 字段。因此这种分条结构是暂时的呈现状态，未随普通聊天历史保存。

Home 层的 `gt()` 读取 `b.history()`，过滤系统行后，将整个 React 显示数组替换为 `history.map(j => ({bubble:j,state:'done'}))`。它不把临时 pieces 合并后保留，而直接使用保存的完整 h，因此 `:piece:N` ID 消失；`Im/Nw` 再对完整 h 拆 DOM 行，非首行就成为 `原始UUID:sentence:全文UTF-16位置`。`gt()` 在挂载、角色切换及历史同步等路径使用。`ny:chat-history-synced` 监听器在 `q || ne || Qt.current` 为真时设置待重建标记 `lo.current`，待三个忙状态解除后才调用 gt；正常聊天 onTurnDone 会清除这些忙状态。客户端 K0 同步协调器回调也会发出该事件，但这只证明存在客户端触发路径，不能据此确认特定账号某次同步的服务端行为。

**历史无 sourceMessage 时，并非把整段回复的 pieceIndex 默认成 0。**`tI` 先对完整 e 调用 `wu(e)`，逐块重新匹配 `Gn(e)` 的句子；每块以实际序号 h 调用 `Cm(e,句段,t.id,h,undefined,当前版本)`。因此首块单句分行与后续哈希选择的一/两句规则依然存在；只有匹配失败才回退整块，然后仍经过 `eI` 换行后处理。

即时与历史的 DOM 边界仍可能不同，原因是输入文本与换行保留方式不同。`Gn` 先按原始 `\n` 分行，每句 trim；多句 `wu` 用 `zt` 把句子重新连接，通常抹去原来的换行。历史保存的是完整 d，`Rw` 在 d 上定位出的区间仍保留原始空白/换行，`Cm` 默认 `Tw` 会识别句段尾换行，之后 `eI` 又把每个非空换行边界拆开。即时 sourceMessage 路径则通过 `ZS` 尝试恢复这些边界；`ZS` 用空格重拼校验，和 CJK `zt` 的直接连接并不完全等同，校验失败会返回空边界数组。因此不能保证即时与历史的最终行数或分组相同，也不能仅凭 DOM 行数判断模型发了多少次消息。

`Sm` 是普通 `span` 文本，情绪装饰 `PS` 同样按文字/字符拆 span，没有 Markdown 转换器。`**` 会作为字面字符显示；当完整回复在这些符号两侧保留换行时，`eI` 的非空判定会允许符号成为单独一行。这与报告中的现象相容，但未拿到该次完整原始回复，不能断言每个单独符号行的具体上下文。

精确定位（同一主bundle SHA，0-based UTF-8 byte offset）：`P0`41705、`$p`42692、K0同步事件回调106742、`mu.persistHistory`346373、`mu.appendHistoryBatch`347558、完整 h 创建436681、临时 `sourceMessage` 创建437242、`Sm`592233、`PS`574570、`gt`690286、历史同步监听器的重建调用692647。对应关键调用链为 `保存完整h → 临时pieces即时呈现 → 历史事件延后至空闲 → gt整体替换 → tI重建piece分组 → eI保留原换行拆DOM行`。

## 4. 气泡、TTS 与人物动作的时间轴

`revealBubbles` 先把逻辑piece停放，再在音频片段 onPieceStart/onPieceEnd 对应调用 reveal start/done，ChatLayer在piece内部继续逐字与拆行。声音和文本不是 token 同步。`E2` 会合并不足 3 单位的语音输入，并同步删除语音→caption 映射里的索引；它不删除已建成的逻辑piece，较早未揭示的piece会在播放后续片段时完成。

TTS `vt.run`：准备首片段；播放当前片段前已开始准备下一片段，降低句间空档；每片支持重试、取消、WebAudio 与 media fallback。无法获取音频时有文字揭示回退。`PE.timedReveal` 的默认字符速率 Nari=19.1、Yume=21，按 `max(1,字符长度)/cps*1000` 算每个逻辑piece的显示时长并顺序揭示，结束后再多 50ms。它不是“模型思考延迟”。渲染层另有 `Ra/jw` 的打字速率：中文Nari=6.7/Yume=6.4，日文8.6/8.7，英文19.1/21再乘1.1；会按grapheme边界截取文本以免切断emoji，piece的done事件又会立即揭示剩余文本。这些速率不能混成一个统一TTS或模型速度。

默认人物 voice：Nari `nari_eng/speed 1.1/pitchCents 350`，Yume `yume_eng/1.2/500`；`GET /api/character-meta` 可覆盖 voice、speed、pitch、charsPerSecond、renderScale。本次只观察调用代码，没有请求此 API。

动态语音路径：`POST /api/tts` JSON `{text,grant,voice,speed,pitch_cents,who?,style?,locale?}`；身份取决于语音访问模块，`voiceGrant` 来自主聊天响应。超过 600 字符会先切更小的 synthesis pieces。程序先尝试对精确台词匹配预制录音（可验证 SHA），再走动态 TTS。`bakedOnly` 不调用动态生成。`/api/tts/healthz` 有前台活跃期间的 warm/presence 请求，不能把这些 warm 请求算主动聊天。

已有 native bank 元数据共 9,423 条，audio.voice 均为 `af_heart`，Nari 3,888 条、Yume 5,535 条，speed/pitch 与上述人物默认值对应。它只证明这些**预制 native 录音**的元数据如此。`af_heart` 很像 Kokoro 生态的音色标识，需要与官方模型资料另行对照；不能从这个名字证明当前 web 动态 TTS 基座或厂商。已下载该元数据，无音频下载。

输入语音：AudioWorklet 或浏览器 MediaRecorder→`POST /api/asr`→`{text}`→普通聊天。手工 PCM 路径是 16kHz mono 16-bit WAV，限制 2,560–480,000 个样本；请求带内容类型、时区、trace，可加非英文 `x-ny-asr-language`；返回文本最多 2,000 字符。供应商名称未在这条调用里出现。

情绪→表现独立映射：`_2` 对每人物情绪随机挑 expression，包括重复条目和 null，形成有权重的表情分布；播放 `Mood:<emotion>`，约5秒后撤销表情。语音音量分析及 mouthShape 驱动口型。渲染是自家 Koro/WebGL2 rig、motions、physics，含 WebAssembly deformation 与 mesh batching；密封包路径含 AES-GCM/vault-key 协议。本次没有取得 key 或打开密封包。

## 5. 三类记忆与时间重新解释

前端 v2 (`iE=true`) 记忆：九个 slots(name/age/birthday/location/job/living/partner/pets/family)、facts最多60、plans最多12、每人物story最多14、每人物self最多14。这是应用数据结构，不是模型参数记忆。

`aE.record` 只记录完成的用户/助手配对；≥8对且用户字数合计≥24才提取，单批最多16对，45s超时。同人物提取可用 `navigator.locks` 防多页重复。请求走同一个 `/api/chat`，`kind=memory,characterId,ledger,turns,v:2,memory:{today,slots,facts,plans,story,self},legacyFacts?`；每 turn 可带当地日期。facts超60会另发 consolidate 请求，再提交。失败保留待处理配对；清空记忆有 cutoff/epoch 防旧任务回写。

`Gx/Yx` 检验返回的 JSON envelope；`as/Px/Ux` 做来源、年龄/生日、字符长度、人物年龄锁定、重复/矛盾等检查，避免把助手自己的内容记为用户事实。这里锁定 Nari=22、Yume=21；不是我们原型的人物年龄。facts 会用 by 区分 Nari/Yume/both。日期按配对日期和明确 due 存储；本地英语日期解析支持 tomorrow/in N days/weeks/weekday 等；无法确定时存在默认三日后 fallback，所以不能声称完全正确的日期推理。

`tf` 每轮选取相关内容：facts 相关分数是长度≥4的英语字母词交集数 + 序号/10000，取前9条，累计约120个空白词；slots和plans另组织。另一人物单独听来的事实包装成由姐妹转述，降低无解释全知。plans 按当前日期改成 today/tomorrow/in N days，避免旧对话的“明天”漂移。story 限最多10条，保留第一条、约30日内或最多2条关键词命中的旧项；日期增加相对时间。self 取前7条，附加非日记旧self recall最多8条，总selfRecall最多16条。

**中文边界仍在**：`Wt` 用 `[a-z]{4,}`，纯中文查询没有这一条相关度加分，主要退化到事实的新近序号。不能据此说 LLM 不懂中文；也不知道后端是否又做了其他检索。`kE.context` 特意排除 daily-journal 和 today/yesterday/tea/drink/incident 等临时日常 key，从主 chat selfRecall 去除这些旧碎片；不能把“写信会引用生活片段”自动套成“主聊天持续注入整本日记”。

## 6. 长对话摘要与人设刷新

`ME`/`Uf`：近期目标最多16条，考虑每条最多2,000字符和8,000字符预算，至少4条；已有摘要且未折叠部分可在最多32条/16,000字符范围继续使用。无摘要则用旧用户发言生成明确出处的本地fallback；模型摘要请求为 `kind=summary,characterId,previousSummary,history`，最多64个待摘要片段，45s超时。摘要限制约200空白词和4,000字符。wire 恢复先聚合同 role，起始重建的近期部分最多12条、并去除末尾悬空用户项；因此不同会话恢复状态不能概括成“永远16条”。

`xi.next` 对新 turn token 计数，关系 stage 或 mood 变化、或者每5轮触发 personaReminder，触发之间至少隔2轮。这里只发送原因标签，真正提醒内容在服务端。

## 7. 情绪与三种关系进度

本地 mood 初始 valence=.2、arousal=0、confidence=1、momentum=0。`lE` 用英语情绪词表，单词匹配观察前三个词的否定，短语做包含匹配，并检查 intensifier，输出有限confidence。confidence<.35不更新。`uE` 根据情绪把confidence乘不同系数加到 valence/arousal/confidence；`Qy` 将 valence/arousal clamp到[-1,1]，momentum增加至少.15并限制[0,1]。

一分钟 tick 的恢复系数 **a=.05×(1−.9×momentum)**；valence +=(.2−valence)×a，arousal +=−arousal×a，confidence +=(1−confidence)×a，momentum×=.92。momentum高时恢复慢。`hE` 用±.15阈值映射 joyful/anxious/alert/serene/despondent/calm/content/melancholy/neutral，再送给聊天dynamic。这个 mood 与模型回的 emotion 标签不同，不能统称为一个 LLM 情绪模型。

关系有三层，不能混用：

- **主聊天 affection level**=`clamp(floor(userTypedTokens/500),1,100)`，普通文字积分是 `max(1,floor(text.length/4))` 粗估，加活动奖励；不是实际tokenizer。每日聊天积分最多500，bonus总额250，游戏至多两次/日计bonus、一次voicecall计bonus，每次至多50。
- **UI bond level** 是文字积分等级和 bondEvents 等级取高。bond阈值前四级为0/3/9/19，之后每级+10；完成一条用户消息或活动可以增加bond事件。
- **moments arc tier** 由显式里程碑 unlocked 的加权和推得1–4，需至少两个里程碑；总权重5/12/24对应2/3/4。里程碑包含首消息、首call、首游戏、首photo、7日streak、100/200消息、30/365日、深affection等。主动礼物通常按这个tier gating，同时还检查主聊天level。

主聊天阶段映射为1–20 stranger、21–40 acquaintance、41–60 friend、61–80 bestFriend、81–100 lover；可见用户界面标签更温和。此处计数指标不等于人工审核“真正建立了信任”，也无法证明后台亲密风格只由它决定。

## 8. 主动发言触发与节制

`kE.start/foreground` 只在有访问权、当前账户且页面可见时启动，默认每60s发tick。背景/离开/切人物取消在途delivery、停止timer，切换/返回/游戏/call/photo/mood/message等事件进入统一事件总线。真正 UI ready gate 还要求主chat首页、无overlay、无语音输入/生成/其他忙状态、composer为空。不是新进页面12秒就必定补一条。

`Ff` 的候选 pending有效期60s；默认quiet是22:00–07:00，周末可延至09:00。由于quiet先检查，morning-dream窗口5–10点通常只有07–10点可实际触发，周末09–10点。

可见规则：

- morning约07:30±30min；goodnight约22:15±45min但受quiet先过滤，有效边界须合并两条规则理解；返回欢迎需缺席≥2日，有同周与约3日冷却。
- weekly check-in 周日18点；相遇周年、每30日的monthiversary；节日、生日lead/tail窗口按当地日期。
- 缺席≥7日可arm dream，arm一天后过期；需相应tier、level≥30，dream冷却21日，主题按当前mood加权选择。
- milestone、confidence≥.6的anxiety/fear/sad/loneliness、长期缺席、长间隔call、20min近期活跃且每tick随机<.02，可能生成gift候选。
- gift需主level≥20；按事件、tier、rarity筛选，common/special/rare选择权重4/2/1，基础冷却至少2日，special5日、rare14日。不是每条都撒娇或每分钟必发。

`PE.deliverProactive` 复用正常 `buildTurnRequest`（空userMessage），加 `dynamic.proactive={kind,key,theme,entities?}` 调普通聊天。dream实体来自既有graph的前8entities打乱后取4。禁止inFlight/activeReveal；非订阅额度若达到每日成本上限50%也不主动调用。成功呈现后才记delivered时间戳；没有制造用户消息或将主动话当用户事实。具体主动生成prompt仍在后端。

## 9. 存储、云同步与辅助活动协议

`index` 的 storage facade 按 localOwnerUID 隔离 `ny.*` 和 `nariYume.*` 账户数据，迁移旧key，处理账户已删除/切换和跨tab storage事件。客户端原始历史缓存约200条并按256KiB预算保留；本地journal保留待同步修改。这里仅确认客户端的存储与同步实现，未验证服务端或当前账户实际启用了哪些同步功能。[官方 Support](https://www.nariyume.com/support) 仍有 web 历史本地保存的说明，与此快照中的新版同步代码应分别记录；可能存在版本、客户端、账户或功能启用差异，不能由代码存在就断言所有用户的历史已经云同步。

主程序包含 `/api/chat-sync`、`/api/memory-sync`、`/api/letter-sync` 的客户端协议与调用：chat有history/reconcile/read/day/changes/write与clear fence、按日revision与删除ID；memory有memoryFacts/memoryEntities/memoryRelations，ID、schema、confidence、来源、createdAt/lastReferenced等校验，legacy compatibility `ios-sdk-v1`。客户端利用身份变化、clearBefore、cutoff/revision防跨账户与旧任务回灌。上述是可见客户端行为规格，不能替代服务端协议实现或账户同步实测。`getReader`在这里是受大小约束地接收完整JSON，不是LLM消息流。

辅助生成复用 `/api/chat` discriminator：oneShot发送system/user/maxTokens/temperature/json/purpose/activityId/gameRun；memory/summary有专门字段；gameFinish/activityFinish是结束与额度记账。写信默认客户端temp .9/maxTokens640，并公开两段信的创作提示；它是辅助feature prompt，不能冒充main chat系统全文。游戏既有LLM辅助内容，也有大量预写脚本、seedbank、预制语音；具体prompts由并行prompt-contract报告审查。

## 10. 可确认与不可确认的结论

**确认的客户端实现**：角色状态运行时代码；主chat传状态而不传完整角色prompt；主调用整段接收JSON中的content字符串，再在客户端分句分泡；多层记忆/摘要、情绪惯性、三种关系指标、前台事件触发、人物/语音节奏、预写录音与cloud sync协议都有可定位代码。后端调用次数、模型端流式与各账户实际云同步启用情况均未由这些代码证实；官方Support的本地历史说明与当前代码快照差异仍保留。

**合理推断**：主prompt由后端组装；rung可对应回退配置但具体内容未知；af_heart与Kokoro音色命名相似；同一接口kind分流到不同任务提示词。不能把这些写成已获取后端源码。

**尚未观测**：一次真实登录chat响应的model/provider、主prompt文本/采样值、服务端检索/分类/安全/路由代码、当前动态TTS/ASR基座、模型训练/微调、用户级试验分配、生产所有feature是否启用、长期对话表现。营销素材ID中存在 `grok-*`，没有作为推理请求model值使用，不能据此判定今天的模型是Grok。

这些文件是取证快照。公开bundle含Koro专有实现提示，公开可读不等于开源授权；这里提供行为规格和定位，而没有把其实现变成我们的生产源代码或发布其人物/媒体资产。
