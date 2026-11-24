# Candy.ai memory surface：公开页面与前端静态证据

本笔记只覆盖公开页面、已导出的 JavaScript 和 GET-only REA 观察。没有提交 Candy.ai 的聊天、记忆、注册、登录或支付写请求。

## 公开服务端注入边界

REA controlled replay 从 `https://candy.ai/ai-girlfriend/helena-miller` 等待 3.5 秒，证据为 `ev_068cb7f91582f8bf4879a550cc523db7f9601a2693f685e19a5f83117c4b2647`。网络中观察到：

- `GET /conversations/helena-miller/profile_panel` 返回 200。
- 最终 DOM 中 lazy frame `#profile-partial-turbo` 已完成。
- 页面保留 `<div id="memory-modals"></div>`，但没有 memory modal、memory form 或 `auto-memory-badge` controller。
- profile frame 的公开 guest fragment 也没有 `<form>`；它只返回角色资料。

脱敏快照：

- [live chat DOM](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/public-chat-helena-live-sanitized-20261014.html)
- [profile-panel fragment](/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/public-profile-panel-20261014.html)

## `memory-form` 静态行为

在导出的 application bundle：

`/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/scripts-20261014/files/origins/d67d227ea890148477cb7a23845fd9d9895c6240b60c63f028dbdcf79d237c1c/assets/application-effec2376d3dfc7cac86e2917d7c22241faba055b5b2f1d441467b5ebc42ae75.js`

- `Pp` (`memory-form`) 位于文件偏移约 `1,615,638`，第 401 行；注册点约 `1,926,359`，第 427 行。
- targets 是 `textarea`, `counter`, `submitButton`, `submitLoader`, `backButton`, `backArrow`, `backLoader`。
- `connect()` 调 `updateCounter()`；计数器使用 `<textarea maxlength>`，缺省上限为 250。
- `handleSubmit()`、`handleBackClick()` 只切换 loading/disabled/loader；`handleSubmitEnd()` 清除提交 loading。
- 类中没有 URL、`fetch`、`q`、`Te` 或 body 构造。action、method、字段和 Turbo frame 都由服务端 HTML 注入。

因此，表单动作只能安全记录为 **server-injected / unknown**。任何具体 `/memories/...` 路径或字段名都不能从公开 guest 页面推出。

## `auto-memory-badge` 的已确认请求语义

同一 bundle 的 `Dm` 类（live bundle 中约偏移 `1,779,031`，旧 bundle 中约 `1,778,744`）声明：

```js
static targets = ["badge"];
static values = { markVisitedUrl: String };
async markVisited() {
  if (this.hasBadgeTarget) {
    try {
      (await Te(this.markVisitedUrlValue, { responseKind: "turbo-stream" })).ok
        && this.badgeTarget.remove();
    } catch {}
  }
}
```

`Te` 的实现位于 live bundle 约偏移 `372,738`：

```js
async function Te(url, options) {
  return new Mi("patch", url, options).perform();
}
```

`Mi` 会使用 `PATCH`、同源 `X-CSRF-Token`、`X-Requested-With: XMLHttpRequest`、Turbo Stream `Accept`，凭据为 `same-origin`；此调用没有 body。成功状态只会移除 badge。`markVisitedUrl` 本身仍由服务端 `data-auto-memory-badge-mark-visited-url-value` 注入，公开 Helena 页面没有该属性。

REA 对 `markVisitedUrl` 做的静态语义追踪证据为 `ev_8b2a6032ea1c32c3a2f5a39689fe3d859447fb00df53a53ff14faab6bb10f564`：`status=partial`、`total_seed_matches=0`、`relevant_unknowns=25542`。这是应用图覆盖不足，不能当成 endpoint 不存在的证明。

## 当前结论

公开 guest 页面证明了三个边界：

1. memory modal 是服务端按状态注入到 `#memory-modals` 的，guest 状态为空。
2. memory form 的 action 和字段不在 bundle 中，由服务端 HTML 决定。
3. auto-memory 的“已查看”状态在静态代码中明确是对动态 URL 的无 body PATCH，并期望 Turbo Stream 响应；动态 URL 和后端状态模型仍未知。

## Character progression lazy frame

live bundle 还注册了 `persona-dialogs` 和 `progression-dialog`。两者复用一个 generic loader，静态 values 是 `url`/`errorMessage`，收到 `character-progression:open` 后按 `dialogId` 和 `tab` 加载服务端注入的 frame：清除旧 `src`、设置 `frame.src = urlValue`、等待 `turbo:frame-load`，超时或 frame missing 时清理并报告错误；成功后打开 dialog 并点击 `data-tab-id="memories"`。

公开 guest HTML 和 `/conversations/helena-miller/profile_panel` fragment 都没有 `persona-dialogs`、`progression-dialog` 或对应 `urlValue`，所以目前只能确认 lazy loading contract，不能命名真实 progression route。`progressionDialogId`、`settingsUrl`、`sceneUrl` 等值同样由服务端注入；`settingsUrl` 属于通用设置保存路径，不等于 memory form action。

本地 fixture 应重放上述请求语义和 Turbo 状态转换，但不应把任何 fixture 路径命名为 Candy 的真实 endpoint。
