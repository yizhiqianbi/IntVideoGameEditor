# candy.ai 聊天、记忆与计费链路：公开面静态深挖

快照：2026-10-14。范围仍是未登录公开页面、已捕获前端脚本和页面声明；没有提交消息、生成、支付、登录或注册请求。

## 证据边界

主要 REA 证据是：

- `ev_e558a0b0a77639a3d74feab7ba3b61ff518e5e3a488cdddc122ccbde6d8b96bf`：导出脚本的 JavaScript Application Graph，覆盖 partial。
- `ev_53bceeb3abfd9c17d92634e4be698627f35844cc87e32e431009657a1e813f92`：首页 bundle 静态分析。
- `ev_d9219842e2f984365cc5a9e445b6699d0331c789aa0c299750ad2e4893d04b6e`：角色页与创建角色页的 GET-only controlled replay。
- `ev_068cb7f91582f8bf4879a550cc523db7f9601a2693f685e19a5f83117c4b2647`：角色页 GET-only replay，等待 lazy profile panel 完成；该公开页面最终仍只有空的 `#memory-modals`。
- `ev_c590740fb77c4eb22bad8e55785390c177b35915c84e01ef9e53503448a96897`：对 live application bundle 的 REA summary view；单文件约 1.94 MB、221 个静态 findings，semantic coverage partial。
- `ev_2199f939a03751efec097f607b18425e48c3a6bc4c0e47f789d9b535d489e00f`：对 `/conversations/helena-miller/character_progression` 的 GET-only 路由检查，返回通用 404。
- `ev_30b8de3c1fa2d888e809cfc8b5bc303f6b3d89942e4484de01de67cc9254aa8b`：REA 对公开订阅页的 GET-only capture。
- `ev_02ccabebbfed53b526bb3c5e25d8cdc93bf816008aa0a4930047260e13932844`、`ev_3bddee6d1729ee7ba8518bcfad65923aaee3690382cad32904c638cd6c5da9f3`：REA 对注册/登录页的 GET-only capture。
- `ev_eee36a47e0705c2a685e8da10858455fb2bbc30886ad65aa612b78dec10d20ff`、`ev_196109554e95f75955068f29b5e0f0c44000b7c58adcc95f22b345864c462252`、`ev_f1b4af91b0fd85f5160cf272b12968f35ec88019fb2160459440a950927f20e1`、`ev_b20a9fac04aae85f57c95c923a7e23b7440c4d57c4e0c55241443566cec6617c`、`ev_83f7f69ecd8991ceb8a98c345674317f6bb53bdf7a2d8d3fbb220326a3e053af`、`ev_06cab5ab72786a915f15eeb16effeaf29f46d2983494b316699f2a4135c0c67b`：REA 对若干静态 route seed 的追踪结果。它们都报告 source graph partial/no-match；这表示当前图没有足够的语义节点，不能证明对应功能不存在。

辅助 GET HTML 文件：

- [profile-helena.html](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/profile-helena.html)
- [public-chat-helena-20261014.html](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/public-chat-helena-20261014.html)
- [public-chat-helena-live-sanitized.html](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/public-chat-helena-live-sanitized-20261014.html)
- [public-profile-panel.html](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/public-profile-panel-20261014.html)
- [public-subscriptions-20261014.html](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/public-subscriptions-20261014.html)
- [subscriptions.html](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/subscriptions.html)

本轮新增的完整 REA bundle 在 [evidence-bundle-deep-dive-20261014.json](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/evidence-bundle-deep-dive-20261014.json)；公开订阅/登录页的 5 条 capture 另存于 [public-routes-bundle-20261014.json](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/public-routes-bundle-20261014.json)。

本轮 memory 语义追踪的完整保留包（含 25 条记录，约 396 MB）在 [evidence-memory-trace-20261014.json](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/evidence-memory-trace-20261014.json)。

第二次公开角色页/profile-panel replay 的证据包（19 条记录，约 182 MB）在 [memory-public-capture-bundle-20261014.json](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/memory-public-capture-bundle-20261014.json)。

character progression live bundle 的 REA 追踪包在 [evidence-progression-trace-20261014.json](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/evidence-progression-trace-20261014.json)；原始包仅作本地审计留存。

公开 progression 路由检查的脱敏说明见 [candy-progression-get-routes-addendum.md](/Users/pencil/Documents/IntVideoGameEditor/docs/candy-progression-get-routes-addendum.md)，对应 GET-only bundle 在 [progression-get-route-bundle-20261014.json](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/progression-get-route-bundle-20261014.json)。

live 页面实际下载的脱敏 application bundle 在 [application-live.js](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/application-live-e8531912639ef3b51a5bd58abf553e498dd982b40d5e7a7833ecbad1106d8277.js)。

逐条列出静态偏移、Observed/Inferred/Unknown 分类的 [candy-static-chat-billing-notes.md](/Users/pencil/Documents/IntVideoGameEditor/docs/candy-static-chat-billing-notes.md) 也已保存。

本轮 memory 公开面和静态请求语义的短版笔记见 [candy-memory-public-static-addendum.md](/Users/pencil/Documents/IntVideoGameEditor/docs/candy-memory-public-static-addendum.md)。

HTML 中的 CSRF、Mixpanel、UTA 和签名值已从本报告省略。

原始 REA JSON bundles 仅保留在本地审计目录；它们可能包含捕获层的原始浏览器字段，不应直接对外分享。对外复核请使用本报告、静态 notes、脱敏 HTML 和本地 fixture。

## 1. 消息生成链路

### 普通文本消息

角色页表单声明：

- `action="/messages"`，`method="post"`，Turbo 表单。
- `data-message-create-path="/messages"`、`data-message-edit-path="/edit_message"`。
- 隐藏字段：`message[profile_id]`、`message[conversation_id]`、`message[body]`。
- 生成建议字段：`gen_ai_suggestion[number_of_images]`、`gen_ai_suggestion[gen_ai_suggestion_id]`、`gen_ai_suggestion[gen_ai_prompt_id]`。
- 当前 guest 页面中的 `profile_id` 有值，`conversation_id` 为空；这提示服务端可能在首次提交时创建会话，但尚未通过 POST 验证。

主 bundle 的 `gen-ai--message-form` 控制器显示了完整客户端顺序：

1. Guest 状态通过按钮类型和 `openRegistrationModal` 阻止提交，打开注册入口。
2. 已登录状态把 textarea 内容写入 `message[body]`，生成 `FormData`。
3. 先在 `#messages-list` 追加 optimistic user bubble，清空输入，禁用发送按钮并插入 loader。
4. 调用表单 action，期望 Turbo Stream；成功由服务端渲染消息/回复，失败则删除 optimistic bubble 并恢复文本。
5. 发送前派发 `chat:message-sent`，完成后派发 `message-sent`。

静态代码的位置在导出主 bundle 的约 1,316,638–1,344,000 字节区间；它是 shipped JavaScript 观察，不是运行时执行记录。

请求 helper 会为同源调用自动加入 `X-Requested-With` 和页面 meta 中的 CSRF token；指定 `responseKind: "turbo-stream"` 时，2xx/422 响应交给 `Turbo.renderStreamMessage`。这解释了为什么多个控制器只保存动态 URL，而把编码、CSRF 和 Turbo 渲染交给公共 helper。

### 视频意图检测与视频生成

同一 bundle 定义 `BM="/messages/check"`，在输入文本上发出带 JSON body 的检测请求：

```json
{"message_body":"<用户输入>"}
```

若 JSON 响应的 `video_request` 为真，UI 显示视频提示或切换视频模式。页面表单还声明：

- `data-video-generation-path="/messages/gen_ai_video_create"`
- `data-video-token-price="12"`

视频提交由 `buildVideoPayload()` 构造：

```json
{
  "message": {
    "body": "🎥 <视频提示>",
    "profile_id": 232859778,
    "conversation_id": null
  },
  "gen_ai_suggestion": {
    "gen_ai_prompt_id": null,
    "duration": "<选择的时长>"
  }
}
```

实际请求方法在调用点没有显式写出，由站点 fetch/Turbo helper 根据 body 处理；因此“POST”在这里是高可信推断，不是已观察请求。响应期望 Turbo Stream，失败会回滚 optimistic bubble。

消息流还有几条可复现的前端状态分支。`messages--stream-buffer` 会在视频播放期间暂存指向 `messages-list`、typing indicator、loader 或具体 `message_*` 元素的 Turbo Stream，播放状态结束后再刷入；`messages--immediate-render` 会移除 loader、显示消息并派发完成事件，延迟渲染分支约 1 秒后派发 delayed-render。Premium paywall loader 在 `chat-locked-offer` 或 `premium-paywall-modal` 原因下会移除 loader/最近的用户气泡并重置提交状态。编辑流程会删除后续消息再重新提交，删除动作使用动态 `/destroy_message/:id`；从某条消息重新生成使用 `/conversations/regenerate_from_message?message_id=:id`，重新生成图片使用 `/conversations/regenerate_image?message_id=:id`，其 UI 读取服务端注入的 `tokenCost`/`pricing`。这些路径来自静态代码，未实际调用。

### 图片/视频建议和本地状态

公开 HTML 声明图片和视频建议 GET：

- `/gen_ai_suggestions/cached_prompts?category=realistic&medium=image&v=...`
- `/gen_ai_suggestions/cached_prompts?category=realistic&medium=video&v=...`

前端把建议缓存到 localStorage，使用 `GenAiImagePrompt`、`GenAiVideoPrompt` 及 `gen_ai_suggestions_*` 键；选中的建议会把 prompt ID 写入隐藏字段。`imageGenerationAmount` 也保存在 localStorage，默认值为 `1`。

### 语音消息和通话

公开角色 HTML 的 `eleven-labs-call` 控制器声明：

- `/calls/eleven_labs/call_context`
- `/calls/eleven_labs/call_context/check`
- `/calls/eleven_labs/conversation`
- `/audio_messages`
- `/audio_messages/completion`
- `/subscriptions`

语音 bundle 的 `getCallContext()` 静态代码明确构造 JSON：

```json
{"conversation_id":"<conversation id>"}
```

并添加 `Content-Type: application/json`、CSRF header。通话启动前检查 `isFreeUser`，免费用户走 Premium subscription modal；服务端结束通话的 `insufficient_tokens`、`max_duration_exceeded` 和 `moderation_flagged` 原因会映射到 UI 状态。没有实际启动麦克风或通话。

更细的静态链路是：`call_context/check` 返回 `premium_required` 时跳转 `/subscriptions`；`call_context` 返回 `call_id`、签名 URL 和 assistant token；随后客户端 PATCH `/calls/eleven_labs/conversation`，提交 Candy conversation、call id 和 ElevenLabs conversation id。每条转录 POST 到 `/audio_messages`，字段包括 `conversation_id`、`call_id`、`body`、`role`，assistant 消息还带 assistant token；结束时 POST `/audio_messages/completion`，失败最多重试 3 次。断线 beacon 会带 teardown、客户端结束原因和断开来源。ElevenLabs 的 token/websocket 是第三方实时层，不能直接当作 Candy 的计费接口；Candy 侧的通话 token gate 和结束原因才是计费边界的静态证据。

## 2. 记忆链路

当前公开 guest profile 没有 memory 数据、memory endpoint 或用户历史。HTML 只有一个空的 `#memory-modals` 容器，提示 memory UI 可能由后续 Turbo/权限状态注入。

这点在第二次 GET-only replay 中得到交叉确认：`/conversations/helena-miller/profile_panel` 返回 200 的 `<turbo-frame id="profile-partial-turbo">`，但 guest fragment 仍只有角色资料；没有 `memory-form`、memory modal、form action 或 `markVisitedUrl`。因此当前能定位的是“注入槽位和加载边界”，不是实际 endpoint。

live guest DOM 的 form 只包括 `/messages`、动态删除消息、`/user_preferences/toggle`、`method="dialog"` 和搜索 GET；profile-panel fragment 的 form 数为 0。这个结果把 memory form action 排除在当前公开 guest surface 之外。

对 live bundle 的进一步静态定位显示，`persona-dialogs`/`progression-dialog` 共用一个 generic lazy loader：`static values={url:String,errorMessage:String}`，事件 `character-progression:open` 携带 `dialogId` 和 `tab`；loader 在 `ensureLoaded()` 后清除 frame 的旧 `src`，再设置 `frame.src = urlValue`，等待 `turbo:frame-load`，15 秒超时后走错误分支。加载完成后按 `dialogId` 找到 `<dialog>`，再点击 `[data-tab-id="memories"]`。这个链路证明 progression modal 是通过服务端注入的 `urlValue`/frame 继续加载，但 live bundle 没有包含具体 URL 字面量，公开 guest HTML 也没有 `persona-dialogs` 或 `progression-dialog` 元素。

`progression-dialog` 还声明了服务端注入的 `progressionDialogId`、`sceneUrl`、`sceneVideoUrl` 和 `settingsUrl`；其中 `settingsUrl` 是另一个动态设置保存入口，不能当作 memory form action。REA 对 live graph 的 `character-progression:open`、`progressionDialogId` 和 `memories` seed 分别返回 no-match（`ev_7ee1baab9814dee5a252953c77d592d5c68bb2dbceee4714c1e501b78251ff7d`、`ev_dfbf2ffbb403d52c40fbde0eb30fbf7596e179a95f114383a1c4ef33315728f8`、`ev_e71fbd132c50045f8b44642f775d93efcad7ee2e4760209c2c94c6809d253c7d`），因为该 live graph semantic coverage 仍是 partial；手工 source-range 是主要依据。

对公开 GET 路由的边界检查进一步表明：`/conversations/helena-miller/character_progression` 返回 404；若干 progression/memory 猜测路径返回 302 到首页，`/conversations/helena-miller/memories` 返回 302 到登录页，而已知的 `/profile_panel` 返回 200。它们只说明访客路由守卫/不存在性边界，不能反推出 authenticated progression endpoint。公开页面另有 `/conversations/helena-miller/modal_fragments/become_premium_video` lazy frame，但这是 premium video modal，不是 memory 来源。

该 replay 的非 GET 网络事件只有页面自动产生的 `uta.candy.ai/api/v1/tracking/events` 和 Cloudflare RUM 请求；没有 `/messages`、memory、`markVisitedUrl` 或其他 Candy 业务写接口。

主 bundle 注册了 `memory-form` 与 `memories-scroll`：

- `memory-form` 只观察 textarea、计数器、提交/返回按钮，默认最大长度是 250，并提供加载状态。
- `Pp` 本身不调用 `fetch`、`q` 或 `Te`；它只响应 Stimulus/Turbo 的 submit 生命周期。因而服务端 HTML 很可能通过 `data-action` 把提交事件接到这些 loading 方法，但 guest 页面没有该 form，不能把这个 wiring 当成已观察事实。
- `memories-scroll` 只处理滚动渐变。
- bundle 没有把 memory form 的 action 写成固定字符串；form URL 由服务端 HTML 注入，因此静态 route seed 没有匹配到。
- `auto-memory-badge` 只对服务端注入的 `markVisitedUrl` 发 PATCH Turbo 请求并移除提示徽章；这属于“已查看”状态，不能推断为记忆内容写入。
- 角色进度控制器只负责打开 `memories` 对话框 tab，并携带服务端注入的 `dialogId`/`tokenSpend`；这仍是模态路由，不是记忆 CRUD。

可以把这一段静态链路定位到主 bundle 的字符偏移：`Pp` memory-form 从约 1,615,638 开始，`Om` character-progression-indicator 从约 1,766,111 开始，`Dm` auto-memory-badge 从约 1,778,681 开始。`Om.openDialog()` 只派发 `character-progression:open`，detail 是 `{dialogId, tab: "memories", handled: false}`；对话框加载器接收该事件后找到 `dialogId`，再点击 `[data-tab-id="memories"]`。`Dm.markVisited()` 调用公共 `Te()` helper；旧导出 helper 在约 372,451 定义，live bundle 对应位置约 372,738，实际都是 PATCH，并在 `responseKind: "turbo-stream"` 时接受 Turbo Stream。

公共 helper 的行为也能静态闭合：同源请求自动带 `X-Requested-With`、页面 meta/cookie 中的 CSRF token 和 `Accept: text/vnd.turbo-stream.html, text/html, application/xhtml+xml`；2xx 或 422 的 Turbo Stream 响应交给 `Turbo.renderStreamMessage`。因此已知的是请求方法、headers 和渲染边界，未知的是服务端注入的 URL、form action、memory body 字段及后端响应内容。

REA 对 `memory-form`、`markVisitedUrl`、`auto-memory-badge` 和 `character-progression:open` 的语义 seed 追踪分别返回 `no-match`/`partial`，因为当前应用图的 semantic coverage 是 partial/truncated；这些结果不能证明功能不存在。对应追踪证据包括 `ev_96cf69700942f7a158f9d54960e2f0851c6a1c3962ed2780500c4be48076c336`（`memory-form` partial，0 literal matches）、`ev_8b2a6032ea1c32c3a2f5a39689fe3d859447fb00df53a53ff14faab6bb10f564`（`markVisitedUrl` partial，0 matches）和 `ev_9ecffda526cc282fcb196c4943d78b582de91551424618b25a6836e77c9c06f3`（partial graph no-match）。原始静态字节和 source-range 检查仍是本节的主要依据。

`memory` 字符串还出现在浏览器性能、第三方脚本或其他 UI 语境中，不能把这些匹配当成记忆存储实现。

因此目前能够确认的是“存在一个服务端注入的 memory UI 组件”，不能确认：记忆数据模型、写入时机、检索方式、prompt 注入格式、删除/编辑权限、会话级与用户级边界。

## 3. Token 与计费链路

### 消耗和余额 UI

主 bundle 的 token vault 组件显示：

- `data-target="user-token-balance"` 是余额渲染目标。
- Turbo 自定义 action `vault_saved` 读取 `spent`、`saved`、`balance`、`state`、`became_full`，随后派发 `token-vault:saved`。
- 余额组件维护 `userId`、`balance`、`cap`，绘制进度条，保存本地缓存键 `token_vault_last_seen_balance:<userId>`。
- `token-vault-card` 的服务端注入值包括 `url`、`quantity`、`price`、`purchaseSource`、`upgradeUrl`、`freeOpenUrl`。
- 支付弹窗隐藏字段使用 `token_amount`、`purchase_source`、`expected_price`；组件会把 quantity/price 写入这些字段，但没有在本次工作中提交表单。
- `freeOpenUrl` 是一个只在点击免费开通入口时调用的 Turbo Stream URL；具体值由 HTML 注入，公开 guest 页面没有暴露可用值。

消息表单在图片/视频模式才显示 token UI；普通文本模式隐藏 token display。HTML 的 image-mode 文案明确写出：关闭图片/视频模式后，AI 不发送图片或视频，也不会消耗 tokens。

### Paywall 和 subscription gate

页面存在 `isInsufficientTokenModalOpen`、`insufficient-tokens-modal`、`become-premium-messages-modal`、`become-premium-photo-modal` 等容器。主 bundle 监听 `insufficient-tokens-modal-rendered` 和 `paywall-modal-rendered`，在这些事件后重置提交状态或恢复按钮。

`/paywall_events/track_viewed_paywall` 的静态代码会在“Viewed Paywall”场景创建 `FormData`，字段为 `character_id`、`paywall_name`，并带 CSRF 与 `X-Requested-With`。它是埋点，不是解锁接口；本次没有触发。

### 订阅页公开声明

[`/subscriptions`](https://candy.ai/subscriptions) 的 GET HTML 声明：

- 计划 ID：`premium-yearly`、`premium-quarterly`、`premium-monthly`。
- 页面价格字段：年付 47.88、季付 26.97、月付 9.99；页面另有折扣/续费说明。
- 计划卡保存 `data-subscription-intent-guest-checkout-url-param="/subscriptions/guest_checkout"`。
- 订阅意图重定向模板为 `/post_confirmation?country_code=US&plan_id=PLAN_ID`。
- 支付方式弹窗包含 Apple Pay、Visa、Mastercard 图标。
- 权益列出自定义 AI、图片、视频、Live Action、消息和每月 100 tokens。

这些字段是公开营销和 checkout wiring；没有点击计划卡或调用 guest checkout。主 bundle 另有 `marketing--payment-status-modal`，会定时轮询一个由 HTML 注入的 `statusUrl`，最多约 100 次，每次间隔约 3 秒，等待 JSON `redirect_url`；它还会清理 URL 中的 `PaymentRequestId` 和 `status` 参数。这说明 checkout 是异步状态机，但支付 provider、签名、订单状态和服务端校验仍未知。

### 订阅/Token 埋点

静态 JS 构造两类 GTM 事件：

- `initiate_subscription_purchase`：计划价格、币种、订阅周期、用户/访客标识。
- `initiate_token_purchase`：token 数量、价格、币种和用户/访客标识。

这些是测量层 payload，不是支付授权凭证；报告不回显具体 token 值或用户标识。

订阅意图控制器的静态分支还显示：guest checkout 会向服务端注入的 `guestCheckoutUrl` 发 POST，字段为 `{plan, authenticity_token}`，并关闭 Turbo；已登录路径则把选定计划 ID填入服务端注入的 redirect URL。Token 一次性购买会根据 `customQuotes` 计算 `expected_price`；one-click top-up 会读取响应头中的购买 JSON。所有 checkout URL、报价和订单校验仍由 HTML/响应注入，当前公开 GET 没有给出可安全重放的订单接口。

## 4. 当前链路图

```mermaid
flowchart TD
  Guest[Guest profile page] --> Gate{guest?}
  Gate -- yes --> Register[registration modal]
  Gate -- signed-in --> MessageForm[FormData /messages]
  MessageForm --> Turbo[Turbo Stream response]
  MessageForm --> VideoCheck[JSON /messages/check]
  VideoCheck --> VideoCreate[Turbo /messages/gen_ai_video_create]
  MessageForm --> MediaMode[image/video mode + token display]
  MediaMode --> Balance[token-vault balance events]
  Balance --> Paywall[insufficient-token / premium modal]
  Paywall --> Sub[subscription intent]
  Sub --> GuestCheckout[/subscriptions/guest_checkout]
  Sub --> PaymentStatus[poll statusUrl -> redirect_url]
  MessageForm --> MemoryUI[server-injected memory-form]
  MemoryUI --> UnknownMemory[endpoint/model/prompt unknown]
```

## 5. 本地状态流 fixture

为验证已观察到的前端边界，同时避免触碰 Candy 的真实写接口，新增了一个仅绑定
`127.0.0.1` 的本地 fixture：

- [fixture README](/Users/pencil/Documents/IntVideoGameEditor/docs/fixtures/candy-memory-turbo/README.md)
- [fixture server/replay script](/Users/pencil/Documents/IntVideoGameEditor/docs/fixtures/candy-memory-turbo/fixture.mjs)

它用合成的服务端 HTML 注入 `#memory-modals`、`memory-form` 的 action、
`data-mark-visited-url` 和 lazy `character-progression` frame，然后重放以下状态流：

```text
GET  /fixture                                  -> 注入 modal + lazy frame src
GET  /fixture/progression-frame?variant=full   -> dialogId + memories tab + form action
PATCH /fixture/memories/mark-visited            -> remove #memory-badge Turbo Stream
POST /fixture/memories (空文本)                 -> 422 replace modal + validation error
POST /fixture/memories (有效文本)               -> 200 replace modal + saved memory
GET  /fixture/progression-frame?variant=empty  -> guest/空 frame 替换 full frame
GET  /fixture                                  -> badge 状态和 memory 状态持久化
```

replay 会用本地字符串 DOM 应用器实际执行 frame 替换和 Turbo `remove`/`replace`，再断言
dialog ID、tab、form action、badge、错误提示和 memory list 的 DOM 状态。运行结果为 7 个
本地请求、0 个外部请求。fixture 的 endpoint、CSRF token 和 memory 文本
都是合成值，仅用于验证 Turbo 状态机；不能据此推断 Candy 的真实 memory 保存接口。

## 结论与下一步

目前已经能把前端链路拆成：guest gate → `/messages` Turbo form → 视频意图检查 → 视频生成分支 → token UI/paywall → subscription intent/异步 checkout；语音通话也有独立 token gate。记忆组件只暴露了 UI 注册和服务端注入边界，实际数据链路仍未公开。

下一步如果继续保持公开、低影响范围，可以做两类工作：

1. 对 `/subscriptions`、`/ai-girlfriend/helena-miller`、`/characters/new4` 做 REA 的 GET-only response/body capture，核对 `data-*` 值和表单 action 的版本一致性。
2. 在本地 fixture 中重放等价的 Turbo form、paywall event 和 token-vault stream，验证前端状态机，不连接 Candy 的真实写接口。

要验证真实消息生成、真实记忆写入、余额扣除或 checkout 状态，必须先取得明确的测试账号和授权范围；这些动作会改变服务端状态，当前阶段不应通过公开访客页面猜测或尝试。
