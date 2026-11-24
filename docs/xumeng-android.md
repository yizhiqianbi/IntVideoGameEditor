# 叙梦 Android

工程位于 [`mobile/android`](../mobile/android/README.md)。正式站和默认测试包使用原生底栏：广场和短剧在客户端内滑动，聊天、我的、创作、生成、小说和角色详情继续打开同源网站。WebView 仍负责 Cookie、DOM storage、系统返回、文件导入导出、全屏、外链、断网重试和安全区。

夹具源（`-PwebOrigin` 指向本地 HTTP）保持整页 WebView，不插入底栏，以便原有 `SmokeInstrumentation` 继续从启动页找到页面。没有修改网站业务代码，没有恢复支付或调用真实模型/媒体服务。短剧只播放目录中的第 1 集，不调用解锁接口。

原生界面需要更新 APK；网页里的账号、聊天和创作随网站发布生效。正式签名、应用商店发布、域名 App Links 关联及实体设备验收另行完成，不把编译检查当成这些能力已验收。2026-10-14 的首版记录仍在 `output/xumeng/android-20261014/`。
