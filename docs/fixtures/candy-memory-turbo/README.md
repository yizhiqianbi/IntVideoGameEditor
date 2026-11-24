# Candy memory/Turbo 本地 fixture

这个 fixture 只重放公开页面静态代码可以支持的边界，不连接 Candy.ai，也不模拟真实
LLM、登录、记忆抽取或计费逻辑。它把服务端注入的 URL 和 modal 当作 fixture 数据，
再用本地 HTTP server 模拟 Turbo 请求和响应：

1. `GET /fixture` 返回 `#memory-modals`、memory form、动态 `action` 和
   `data-mark-visited-url`，并放置 lazy `character-progression` frame，
   `src="/fixture/progression-frame?variant=full"`。
2. `GET /fixture/progression-frame?variant=full` 返回合成的 `turbo-frame`，含
   `data-dialog-id="memory-dialog-1"`、`memories` tab 和 `memory-form` action。
   `?variant=empty` 返回 guest/空 frame，用来验证 frame load 后控件可以被替换掉。
3. `PATCH /fixture/memories/mark-visited` 返回一个 `remove` Turbo Stream，模拟
   `auto-memory-badge` 的“已查看”状态。
4. `POST /fixture/memories` 接收 `memory[body]`，返回 `replace` Turbo Stream，模拟
   memory form 保存后更新 modal 内容。
5. 空文本返回 `422` 和错误 Turbo Stream，用来验证失败状态不会改变已保存记忆。

`fixture.mjs` 还包含一个无依赖的字符串 DOM 应用器，支持本 fixture 用到的 `remove`
和 `replace` 两种 Turbo action，并支持用 `applyTurboFrame` 将 lazy frame response
替换回主页面。replay 会把 GET 返回的 HTML 当作页面状态，先注入 full progression
frame，再应用 PATCH 的 remove、空文本的 422 replace、有效文本的 replace，最后加载
guest/empty frame；它断言 dialog ID、memories tab、form action、badge、错误提示和
memory list 的 DOM 状态都发生了预期转换。这不是 Candy 的浏览器实现，只是为了在本地
可重复检查状态机。

运行：

```sh
node docs/fixtures/candy-memory-turbo/fixture.mjs
```

脚本会启动随机本地端口、执行一遍完整重放、打印每个状态转移，然后自动关闭 server。
它只允许 `Host: 127.0.0.1`/`localhost` 的本地请求，并在测试结束时检查请求日志中没有
外部 URL。

文件中的 `memory[body]`、`/fixture/memories` 和 token 都是本地合成值，不能当作
Candy 的真实 endpoint 或 CSRF 值。真实公开页面只证明 memory UI 和 action 由服务端
注入；本 fixture 的保存响应是为了在本地验证 Turbo 状态机。
