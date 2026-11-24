# Android 隔离验收夹具

此目录是 Android WebView 的本地验收页面。服务器仅绑定 `127.0.0.1`，默认端口 `18765`；没有账号、真实 API、模型、支付或生产代理。仅使用无身份 JSON 和独立测试 cookie。不会读取或显示叙梦登录凭据。

在仓库根目录启动：

```sh
node mobile/android/test-fixture/server.mjs
```

浏览器访问 `http://127.0.0.1:18765/`。可用 `--port=18766` 或 `XUMENG_ANDROID_FIXTURE_PORT` 改端口。按 Ctrl+C 停止。

Android 设备或模拟器通过 ADB 反向端口连接本机服务：

```sh
adb reverse tcp:18765 tcp:18765
```

让 **debug 测试入口**加载 `http://127.0.0.1:18765/`。保持 release 版本只加载生产 HTTPS 域名；不要为夹具放宽 release 网络或来源策略。多设备时给 `adb` 添加 `-s DEVICE_SERIAL`。完成测试后运行 `adb reverse --remove tcp:18765`。

Android 模拟器还可以直接用宿主机别名 `http://10.0.2.2:18765/`，无需 ADB 反向端口。当前 `SmokeInstrumentation` 断言此模拟器来源；编译对应 debug APK 时指定 `-PwebOrigin=http://10.0.2.2:18765`。实体设备的 `127.0.0.1` 模式与此断言不同，不能直接复用来源断言。页面也兼容 instrumentation 使用的 `#details` hash。

服务器端点：

| 路径 | 用途 |
| --- | --- |
| `/`、`/fixture.html` | 中文页面，英文控件 ID |
| `/health` | 固定的无身份就绪 JSON |
| `/cookie` | 设置独立 HttpOnly cookie，有效期 24 小时 |
| `/check` | 仅返回 `hasFixtureCookie` 布尔值 |
| `/download` | `Content-Disposition: attachment` 的无身份 JSON |

仅支持 GET 和 HEAD，其余方法返回 405；未知路径返回 404。cookie 只作用于当前本地来源，不含真实用户信息。因为是回环 HTTP，此测试 cookie 不带 Secure；生产 cookie 设置由生产服务管理。服务器不记录请求、cookie 或文件内容。

稳定的验收选择器可以直接用于 `document.querySelector`：

| 功能 | 控件与观察结果 |
| --- | --- |
| 手机宽度 | `#viewport-state`，页面宽度不应产生横向滚动 |
| hash 返回 | `#internal-link` → `#nested-link`；原生返回应依次得到 `#route-state` 的 `detail`、`home` |
| 网页返回 | `#route-back`、`#nested-back` 调用 `history.back()` |
| confirm 取消 | `#confirm-button`，取消后 `#confirm-result` 为 `canceled` |
| 文件选择 | `#file-input` 支持多选；`#file-count` 与 `#file-result` 显示数量、文件名 |
| Blob 导出 | `#blob-download`；`#blob-result` 为 `requested-and-revoked`。**还需确认原生实际写出的 `fixture-blob.json` 内容** |
| HTTP 下载 | `#http-download`；需确认实际保存 `fixture-http.json` |
| 全屏 | `#fullscreen-button`、`#fullscreen-exit`、`#fullscreen-target`；`#fullscreen-state` 为 `fullscreen` 或 `windowed` |
| 外链 | `#external-link` 与 `#external-blank-link` 指向 example.com |
| 受限链接 | `#unsafe-file-link` 与 `#unsafe-javascript-link`；地址不应打开，`#unsafe-result` 应保持 `not-executed` |
| cookie 持久 | `#set-cookie-button` → `#cookie-state` 为 `true`；重启应用再 `#check-cookie-button`，应仍为 `true` |
| 重新加载 | `#reload-button` |

`blob-result` 只表示页面发出了下载请求，不等于原生保存成功。Blob URL 在 `a.click()` 后同一任务中立即撤销，用于覆盖生产页面常见的导出兼容边界。文件选择取消时不应卡住后续 chooser。首次未设置测试 cookie 时，`#cookie-state` 为 `false`；`#cookie-status` 为 `checked` 表示检查完成。页面不读取 `document.cookie`。

受限链接是无害的回归探针：file URL 指向一个不存在的静态资源，javascript URL 最多修改本页状态标记。如果标记变成 `javascript-executed`，说明当前壳未拦截 JavaScript URL；夹具本身不替壳拦截，以便测试发现真实问题。外链测试会打开 example.com，页面其余功能不依赖互联网。
