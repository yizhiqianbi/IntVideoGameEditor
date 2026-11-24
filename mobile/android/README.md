# 叙梦 Android

叙梦 Android 客户端。正式站和默认测试包启动后是原生底栏：广场、短剧、聊天、我的。广场和短剧是原生界面；聊天、我的，以及创作、生成、小说、角色详情，仍打开 `https://xumengchat.top/` 的现有页面。网页发布后，这些页面下次打开即是新版；原生界面和 WebView 能力变更需要更新 APK。

支持 Android 8.0（API 26）及以上，编译/目标 API 36。Java 17、Kotlin 2.2、Android Gradle Plugin 8.13.2、Gradle 8.13。新界面使用 Jetpack Compose、Media3 和 OkHttp，因此工程启用 AndroidX。原有 WebView 壳仍由 Java 承载。构建版本组合来自 [Android 官方兼容表](https://developer.android.com/build/releases/agp-8-13-0-release-notes)。

用 `-PwebOrigin=http://10.0.2.2:18765` 构建的夹具包不显示原生底栏，仍然整页加载夹具，供 `SmokeInstrumentation` 使用。不带该参数的 debug 包和所有 release 包都是原生壳，release 的网页源固定为正式站。

## 构建与安装

安装 JDK 17 和 Android SDK，设置 `JAVA_HOME`、`ANDROID_HOME`，或在不提交的 `local.properties` 中设置 `sdk.dir`。SDK 组件：

```sh
sdkmanager 'platforms;android-36' 'build-tools;35.0.0' 'platform-tools'
./gradlew :app:assembleDebug :app:lintDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

测试包：`top.xumeng.app.debug`，名称「叙梦 · 测试版」，版本 `0.1.0-preview`。这是可安装的开发签名 APK。正式包名 `top.xumeng.app`，签名密钥由发布环境单独配置，仓库不存密钥；`./gradlew :app:bundleRelease` 可生成尚未配置正式签名的 AAB。测试版与正式版使用不同应用存储，需要各自登录。

## 四个入口

路由以 `src/components/dzmm/tavern-app.tsx` 的 hash 为准。

- 广场：`GET /api/backend/v1/publishing/catalog?limit=24&offset=0&view=card&sort=hot`。滑到列表底部加载下一页，下拉刷新第一页。点角色打开 `/c/{id}`（站点由 `#character/{id}` 改写到的详情地址）。顶部「创作」「生成」「小说」分别打开 `#studio`、`#generation`、`#novels`。
- 短剧：读取 `/assets/xumeng/video-catalog.json`（失败再读 `/api/xumeng-video/catalog`），只播放校验通过的第 1 集。地址形如 `https://video.xumengchat.top/media/video/huangguo/{id}/ep-001.mp4?v=3`。竖滑切换剧目，画面 contain。没有可播放地址时显示空状态。不调用解锁接口。
- 聊天：`#chat`。页内跳转仍由网站处理。
- 我的：`#profile`。充值是 `#recharge`，角色编辑是 `#studio/roles`，审核页是 `#admin`，都从站内页面继续进入。

登录态只存在 WebView 的 `dzmm_session` Cookie 里。原生请求不复制这枚 Cookie，也不发起付费生成。

## 已实现的原生能力

- 保留 WebView Cookie、DOM storage 和现有网页草稿机制，原生不复制账号/模型密钥。
- 系统返回先退出全屏或收起键盘，再检查未保存/处理中内容，最后走原有网页历史。
- 图片、JSON、HTML 等文件通过系统文件选择器导入，支持多选、取消回调。
- 同源 HTTP 下载逐跳检查来源后携带登录 Cookie；Blob 导出使用顶层私有 WebMessagePort，分块写缓存，再由系统选择保存位置。上限 50 MiB，大文件提示使用浏览器。
- 原生 JS 确认框、全屏视频/游戏、外链浏览器、断网/HTTP/TLS 失败提示和重试。
- 系统栏、刘海和键盘安全区适配；旋转/主题切换保留当前 WebView。

电话目前只接收角色媒体，不申请摄像头、麦克风、定位或广泛存储权限。仅声明网络权限。外部站点不在主 WebView 中加载，不使用面向所有 iframe 的 `addJavascriptInterface`。无付费调用或新的支付开关。

## 独立验收

```sh
./scripts/test-policy.sh
node test-fixture/server.mjs
# 另一个终端，Android 模拟器使用主机的 10.0.2.2 地址：
./gradlew -PwebOrigin=http://10.0.2.2:18765 :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w top.xumeng.app.debug.test/top.xumeng.app.SmokeInstrumentation
```

夹具不接入真实账号、模型或支付，详见 [test-fixture/README.md](test-fixture/README.md)。`webOrigin` 只接受正式域名或明确的本地 HTTP 地址；仅影响 debug，release 始终固定正式 HTTPS 源。夹具 APK 不得当正式站测试包交付，验收后必须不带该参数重新构建。

## 范围与待办

账号和云端作品继续遵循网页的数据同步/冲突机制，本地未保存草稿不会自动跨设备同步。网络不可用时显示重试页面；不提供离线聊天、后台推送或原生 OAuth。进程被系统结束时，恢复能力取决于现有网页草稿机制。

HTTPS 深链仅声明可处理域名，没有发布 `assetlinks.json` 或绑定正式签名证书；Android 12+ 的自动唤起仍需正式签名和域名关联配置。当前社交登录/支付开通状态沿用网站，不因 APK 存在而变成可用。

2026-10-14 的构建、签名、lint 和 122 项纯 Java 检查已通过。Android 15 模拟器真实完成了安装、启动及夹具源/视口检查，后续交互受 System UI ANR 阻塞；Android 11 环境未完成系统启动。最新原生交互测试套件已编译，完整导入/导出、Cookie、返回和全屏验收尚未通过，详见 [交付记录](../../output/xumeng/android-20261014/report.md)。
