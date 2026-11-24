> 当前默认是表演指令模式：回应方向 + 情绪 + 动作。S2 自行组织语言，不逐字念稿。使用与部署见 [DEPLOYMENT.md](./DEPLOYMENT.md)。下方旧版弹幕自动回复说明仅对应显式的 auto API。

# Vidu 本地直播台

本机控制台 + Vidu 云端生成。S2 Avatar 负责实时视频、弹幕响应和动态参考图；Q2 生成图片；Q3 Turbo 生成 5 秒视频。不是在本机运行 S2 模型。

## 启动

需要 Node.js 22.9+（本机已用 Node 25 验证）。

```sh
cd /Users/pencil/Documents/IntVideoGameEditor/vidu-live
npm install
npm start
```

打开 http://127.0.0.1:8787 。服务只绑定本机地址，不对局域网开放。RTC SDK 在启动前从已安装依赖打包到 `.data/rtc.js`。

## 注册和首次试播

1. 注册 [Vidu 中国开放平台](https://platform.vidu.cn/) 或 [国际站](https://platform.vidu.com/)，创建 API Key，并确认 S2 Avatar 的测试权限、余额和并发额度。国内和国际站的 Key 不能混用。
2. 点击「连接设置」，选择对应站点并保存 Key。Key 仅保存在本地服务内存，不写入浏览器存储。也可以复制 `config.example.env` 为 `.env`，在其中填写 `VIDU_API_KEY` 和 `VIDU_REGION=cn`；`.env` 已忽略，不要提交。
3. 上传单人主播形象，填写主播设定与音色。图片限制为 PNG/JPEG/WebP、每张最多 5MB，至少 128×128，比例在 1:4 至 4:1 之间。
4. 先选择「本地演练」并开始，发送「挥挥手，和大家打个招呼」，测试弹幕与参考图操作。演练不调用 Vidu、不生成视频、不产生模型回复。
5. 结束演练，切换到「S2 真实直播」。创建会话会请求 Vidu 服务，真实开播按平台时长计费。本地不设置整场时长上限，点「结束」手动停止。不传 `idle_timeout_seconds`，使用 Vidu 默认空闲超时 7200 秒；官方范围为 10–7200 秒，未提供禁用值。平台仍可能因自身会话上限、余额或连接问题结束会话。浏览器关闭、控制断开、RTC 失败或控制台 35 秒未发心跳时，会请求结束会话；平台的实际结算以后台为准。
6. 看到实时视频后发送弹幕。弹幕走 S2 的 `text_msg`（type 99）；点击打断发送 type 7。文本发送成功表示已发出，不代表模型必然执行所有动作。
7. 添加最多 3 张动态参考图，选择物品、服装或背景，填写期望变化，点击「应用到直播」。使用 S2 的 type 11 `prompt_operation`，收到 type 12 回执后显示成功或失败。点击「还原」撤销最近一次参考图切换。
8. 「生成素材」调用独立的异步图片／视频 API，提交会产生平台生成费用。任务状态每 6 秒查询，30 分钟后停止自动查询，可手动刷新；失败显示错误。生成图片可以用作主播或动态参考图。任务和素材列表仅保存在当前服务／页面内存，重启会清空；完成后及时打开原文件保存。
9. 点击「结束」，约 2 分钟后点「获取直播录像」。真实会话创建时启用了云端录制；下载链接由 Vidu 返回，通常有效期 24 小时。当前只查询最近一场会话。

推荐使用新版 Chrome。RTC 仅接收主播媒体，默认不采集本机摄像头或麦克风。点击「开启播放声音」允许浏览器播放。全屏「纯净画面」可用作 OBS 窗口/显示器捕获源；当前未配置 RTMP 推流，也没有接入 B 站、抖音等平台弹幕账号。

## 外部弹幕输入

先在网页开始一场演练或直播。其他本机程序可向 HTTP 接口提交弹幕。操作令牌由当前服务生成，重启即失效：

```sh
python3 - <<'PY'
import json, urllib.request
base = 'http://127.0.0.1:8787'
status = json.load(urllib.request.urlopen(base + '/api/status'))
request = urllib.request.Request(
    base + '/api/danmaku',
    data=json.dumps({'name': '测试观众', 'text': '请微笑着挥挥手'}).encode(),
    headers={'Content-Type': 'application/json', 'X-Studio-Token': status['csrf']},
    method='POST')
print(urllib.request.urlopen(request).read().decode())
PY
```

仅接受就绪会话的弹幕，不会在下一轮偷偷重放旧弹幕。每条最多 500 字；每次发送直接交给 S2。高流量弹幕源应在接入方合并、筛选、限速。

## 验证与实际限制

`npm test` 覆盖本地演练、跨站保护、S2 初始化/弹幕/参考图/结束协议、断线清理、任务轮询与账户绑定、输入约束。真实协议使用模拟上游测试；没有 API Key 时不能验证账号权限、真实生成画质、时延、RTC 首帧与计费。前端已用浏览器进行演练操作验证。

服务与现有 Next.js 项目独立，未改动原应用或已有配置。主控页面应只打开一个；刷新主控会结束本轮会话。

## 官方协议来源

- [S2 Avatar 实时参数](https://platform.vidu.com/vidu-stream/doc/s2-avatar/realtime/parameters)
- [参考生图](https://platform.vidu.com/docs/reference-to-image)
- [参考生视频](https://platform.vidu.com/docs/reference-to-video)
- [任务查询](https://platform.vidu.com/docs/get-generation)
- [阿里云 RTC Web SDK](https://help.aliyun.com/zh/live/quick-use)

S2 控制连接经本地服务代理，API Key 不下发到播放器；RTC 入会凭证来自 Vidu 创建会话的响应，不需单独注册 RTC 应用。
