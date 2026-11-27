# hgtv.apk REA 逆向报告

## 目标

- 路径：`/Users/pencil/Downloads/hgtv.apk`
- SHA-256：`6273a31ae847f8d21f1a25b5782fa24af42e6d0fee55213b1e0e3910a426c734`
- 分析范围：REA 静态 APK/ZIP 清单、Android 应用图投影；补充本地 Manifest 与 DEX 静态解析。

## REA 直接证据

### APK 内容清单

REA `inspect_artifact` 记录：`ev_0369c502ad483cb323f4cf41fbedc5304d0d212fec39b4a2abeda45a526d51f9`。

其 inventory 子证据 `ev_3fb6dcafffc115da24415dbe374a2f1e5b31a61efa51cc8e9bf642444c4f821a` 显示：

- APK 根图：157 个节点、198 个 occurrence、197 条边。
- `AndroidManifest.xml`、`resources.arsc`、`classes.dex` 均存在且 ZIP 哈希校验通过。
- 归档中没有看到 `lib/*/*.so`、JVM class 或 JavaScript bundle。
- 清单中同时出现 `res/lR.xml` 和 `res/Lr.xml`；在当前大小写不敏感文件系统上无法安全整体展开，因此 REA 的 `extract_artifact` 被路径冲突阻止。
- ZIP 中心目录不包含 APK Signing Block；清单里的空 signing 数组不能推出“APK 未签名”。

### Android 应用图

REA `project_android_application_graph` 记录：`ev_4d0d6035ca33aff138e3eac35980bc0ee85cf9e652ad8e3e6f3042e36412b4fc`。

- 运行时家族由路径和格式推断为 `dalvik-art`。
- 精确组件哈希：
  - `AndroidManifest.xml`：`3c1f984ebaf2412055738f860c68d71cfca8b8dbc45011c7539d3a11f70392c7`
  - `resources.arsc`：`9ba2b45f243db57d919433f6ead73eda77964bd5977685ef81c257001d7cfdc8`
  - `classes.dex`：`1855f6abea1f88d6bcfc0703bb6168fcab922588045829dc1631365399756638`
- 未发现 JNI/React Native/Flutter/Unity 等桥接候选；这是路径投影结果，不是运行时观测。

## 本地静态交叉验证（非 REA Evidence）

由于当前环境没有配置 `REA_JADX_MCP_JAR` 和 `REA_APKTOOL_COMMAND`，REA 的 JADX/APKTool 操作不可用。下面两节是对同一 APK 的本地只读解析，用于补足 manifest 与 DEX 结构信息。

### Manifest

- 包名：`com.hg.app`
- `versionName=2.0.5`，`versionCode=103`
- `minSdk=24`，`targetSdk=37`，`compileSdk=37`
- 自定义 Application：`com.hg.app.HgApp`
- 主 Activity：`com.hg.app.MainActivity`，导出并带 `MAIN`/`LAUNCHER`。
- `MainActivity` 配置为竖屏；应用关闭明文流量，声明 `networkSecurityConfig` 和 `dataExtractionRules`。
- 主要权限：`INTERNET`、`ACCESS_NETWORK_STATE`、`WAKE_LOCK`、`REQUEST_INSTALL_PACKAGES`、`READ_EXTERNAL_STORAGE`（`maxSdkVersion=32`）、Google/Firebase 广告标识与安装归因相关权限，以及应用自定义的 `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`。
- `<queries>` 允许查询 `http`/`https`/`alipay`/`alipays`/`weixin` 方案，并声明支付宝包 `com.eg.android.AlipayGphone` 与微信包 `com.tencent.mm`。
- 组件包括：AndroidX `FileProvider`、Firebase 初始化 Provider、AndroidX Startup Provider、Google Analytics Measurement Receiver/Service/JobService、Firebase `ComponentDiscoveryService`、Google `GoogleApiActivity`、ProfileInstaller Receiver。

### DEX 结构与应用自有代码

`classes.dex`：8,819,528 字节，DEX 037；53,111 strings、10,096 types、62,558 methods、8,645 class definitions。应用命名空间下有 49 个类，主要包括：

- `MainActivity` 及其 `HgBridge`、WebViewClient/WebChromeClient、Splash/导航/返回处理类。
- `AppSeeds`、`ConfigBootstrap`：应用入口 URL 与 API 入口选择/探测。
- `ApkUpdater`：更新配置拉取、版本比较、APK 下载、`FileProvider` 安装 Intent。
- `HgAnalytics`、`HgApp`：Firebase 初始化与事件/页面埋点。
- `PromoBindCapture`、`PromoBindStore`：推广绑定 token 的捕获和本地持久化。

DEX 字符串和方法名静态显示：

- 应用入口候选：
  - `https://google.huge1-7wnjsk.com/`
  - `https://google.huge2-2hxu9.com/`
  - `https://google.ihgtv-qa7pt2.com/`
  - 调试入口：`http://127.0.0.1:5173/`、`http://10.0.2.2:5173/`
- 默认 API：`https://hgxml.00api-agy5u.com/api`
- 备用 API：`https://rules.googlexml.com/api`
- 更新接口字符串：`/app/config`、`apk_urls`、`android_min`、`android_force`、`application/json`、`update.apk`。
- WebView 注入的桥接对象：`HuangGuoNative`；页面侧 `HGApp` 暴露 `checkUpdate`、`syncPullRefresh`、`notifySplashReady`、`logEvent`、`logScreen`、`getPromoBindToken`、`openUrl`。
- `MainActivity` 有 `isTrustedHost`、`isPlayPath`、`openUrlOrScheme`、`rememberHost`、`setupWebView`、`requestUpdateFromJs` 等方法名，说明它承担可信域名、路由、外链和更新触发的壳层逻辑。
- `PromoBindCapture` 的方法名显示它会处理 Intent、Install Referrer、下载目录/MediaStore、APK 文件名和 APK 签名块；字符串中出现 `hg_promo_bind` 及 `hgtv[_-]([A-Za-z0-9]{16,64})(...)?.apk` 形式的 token 规则。

## 行为解释（静态推断）

1. 这是一个以 WebView 为核心的 Android 壳应用：原生层负责入口探测、生命周期、导航、返回键、下拉刷新、外链和更新，业务页面主要来自远端 H5。
2. 应用会从多个域名选择可达入口，并向远端 API 请求更新配置；配置包含最新版本、APK 地址、最低 Android 版本和强制更新标志。
3. Web 页面通过 `HuangGuoNative` 与原生层交互，能够触发检查更新、埋点、页面路由同步、Splash 完成通知、推广 token 读取和打开外部 URL。
4. 推广归因链路覆盖安装来源、Intent、下载文件名与 APK 签名块，并把 token 保存到应用私有偏好设置。
5. Firebase/Google Play Services 组件用于初始化、Analytics/Measurement、安装归因与 ProfileInstaller；这些组件是静态声明，不能单独证明运行时一定成功执行。

## 当前未覆盖

- 没有真实 Android 设备或 ADB 目标，因此没有启动 APK、Logcat、界面截图或网络运行时证据。
- 没有 JADX headless MCP 0.7.1，因此无法用 REA 输出 Java/Smali 方法体；上面的类/方法名来自本地 DEX 结构解析，属于静态交叉验证。
- 没有 APKTool，因此没有 REA 解码后的资源 XML；资源文件只能从 APK 清单和二进制资源路径确认。
- 没有把任何字符串推断成“已访问域名”或把静态桥接方法推断成“运行时调用”。
