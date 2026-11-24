# Mini 02 / SoulX-FlashHead Lite

独立预览服务：服务器 `/data/zrc/dyt/avatar-mini02`，GPU 7，127.0.0.1:8026。
语音 Mini 01 仍在 GPU 5、8016 端口，两个环境隔离。

选型：SoulX-FlashHead Lite 1.3B。官方仓库宣称支持单 4090 实时吞吐；本部署速度以实测为准。FlashTalk 14B 官方实时配置要求多卡，未部署。
来源：https://github.com/Soul-AILab/SoulX-FlashHead

使用原创生成头像 `public/avatar-mini02/virtual-host.png`；默认样例截取已有 MiniCPM 语音输出前8秒。页面支持上传/录音（0.5–30秒），生成分段预览及完整视频，队列串行以防同一模型状态被并发污染。API 为 Gradio `render_avatar`。

这是视频效果预览，尚未实现实时麦克风→MiniCPM→数字人的持续链路、会话取消和音画同步打断。不要把分段视频生成当作完整双工数字人验收。

## 启动

复制本目录脚本到服务器部署目录后：

```sh
cd /data/zrc/dyt/avatar-mini02
bash setup.sh
# 等待 models.ready 和 dependencies.ready
nohup bash start.sh > service.log 2>&1 < /dev/null &
```

本机：

```sh
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
  -L 127.0.0.1:8026:127.0.0.1:8026 -p 2223 medteam@119.145.35.48
```

打开 http://localhost:8026 。未开放公网，无外部 API 密钥。SSH 密码不写入代码。

## 验证记录

2026-09-27 已完成：

- 上游提交 `9bc03de06bb0de82cd6bc477804512ae06144bf2`。Lite 权重通过 SHA256 校验。下载过慢时用 `resume-models.sh` 多连接续传。
- 修正上游 NCCL pin 与 Torch 2.7.1 的冲突，使用 Torch 配套 NCCL；独立 Gradio 缓存避免共享 /tmp/gradio 权限冲突。
- GPU7 成功生成样例，显存总占用约 6760MiB。未启用 torch.compile，使用内置 SDPA fallback。
- 完整样片 `/data/zrc/dyt/avatar-mini02/output/demo.mp4`：512×512、25fps、H.264 + AAC、8.704 秒（输入8秒，模型块补齐）。
- 浏览器第二次生成报告总耗时10.6秒，包含编码；不能宣称端到端实时。模型 denoise 每步约0.085秒，不等于整条链路延迟。
- Playwright 验证网页 HTTP200、分段视频 currentTime 推进至7.27秒、readyState4、videoWidth512、完整视频及下载链接正常。HLS 曾出现可恢复的 bufferStalledError，连续播放仍有优化空间。
- Python Gradio 客户端默认会把 HLS playlist 当成普通文件下载而报403，smoke.py 设置 download_files=False，浏览器使用原生 HLS stream 路由播放。
- 原创头像 + 已有 MiniCPM 语音样例已接通；持续会话桥接、取消与视频旧帧丢弃尚未实现。后续需验证音画同步打断。

预览：http://localhost:8026/?__theme=dark 。模型保持在服务器后台，访问依赖本机 SSH 隧道；服务器重启后需手动启动脚本。

## 待机循环

`generate-idle.py` 用同一头像和5秒全零音频生成待机动作，再用正放/倒放拼接匹配循环首尾。产物 `output/idle-loop.mp4`：512×512、25fps、11.52秒，无音轨。抽帧嘴部保持闭合、轻微姿态变化；往返处理可能使眨眼等动作显得机械，尚未做真人主观评价。

页面顶部默认静音自动循环待机视频。点击“播放回复样例”播放现有样例，ended 后自动恢复无声待机；浏览器已验证两次状态切换。此入口演示播放状态，不代表已接通实时语音生成回复。

## 持续语音交互 / Mini 03

入口 `http://localhost:8027/`，独立 FastAPI bridge `live/server.py`，启动：

```sh
cd /data/zrc/dyt/avatar-mini02
nohup bash start-live.sh > live.log 2>&1 < /dev/null &
echo $! > live.pid
# 在本机开启另一个隧道
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
  -L 127.0.0.1:8027:127.0.0.1:8027 -p 2223 medteam@119.145.35.48
```

链路：AudioWorklet持续上传16kHz float32单声道PCM → MiniCPM WebSocket → 汇集一条回复音频 → Gradio数字人生成 → 有声MP4播放 → 无声待机循环。回复语音最多积累24秒；页面不是逐帧低延迟视频对话。当前仅允许一个活跃交互会话。

打断：浏览器能量检测或按钮立即停视频；bridge递增epoch、取消Gradio任务、清空语音缓冲并拒绝旧response_id；持续上传音频同时请求force_listen，直到新input_id对应的listen确认后再接收新回复。取消为合作式，正在计算的GPU一步可能仍完成，结果会被丢弃。提供方没有精确回滚未播放语音历史的接口。

默认耳机。能量门限可能把“嗯”或环境噪音判为插话；外放未验收。结束/断开后关闭模型会话、释放麦克风并删除bridge会话文件；Gradio有自己的生成缓存。

2026-09-27 验证：
- `live/test_live.py` 合成中文音频持续输入，第一条回复进入视频生成后打断。epoch0无视频返回，收到cancel_ack，再次输入后收到epoch1视频且HTTP200；整轮测试52.25秒，第二条9.56秒语音的视频生成13.096秒。
- Playwright用模拟静音麦克风测试页面开始、静音、打断、结束：已连接；本地停播调用0.4ms（不是从真人开口起算）；模型监听确认；结束后track状态ended，视频回到muted+loop待机。
- 真人中文多轮、外放回声、十分钟稳定性和20次回复/10次打断统计尚未验收。模型存在错误自我介绍的问题；当前提示词不能完全避免。

### 消除切换黑屏

交互页采用常驻待机底层 + 回复视频覆盖层。待机src不再随回复/打断重新赋值；回复在隐藏层预载，requestVideoFrameCallback确认首帧已提交后120ms淡入，无此API时用playing+双rAF回退。结束/打断仅隐藏暂停回复，取消待处理首帧回调并递增播放代次，旧视频不能重新出现。下一条回复换src前立即隐藏覆盖层，防止淡出期间出现空帧。加载失败/超时保留待机；声音自动播放受限时显示播放按钮。

Playwright验证：延迟视频请求2秒期间底层继续播放；正常结束恢复待机；加载中取消后迟到首帧不显示，回复静音暂停，底层readyState4持续播放。测试复用待机素材作为播放夹具，未再次消耗模型推理。此改动修复播放器换源黑屏，不保证两个独立生成片段的姿态完全一致。

### 五种行为状态（第一版）

前端 `director.dispatch` 统一编排倾听、思考、说话、微笑、点头。连接/用户开口进入倾听；检测到说完先点头700ms再进入思考；回复视频首帧就绪进入说话；播放完微笑1400ms再倾听。打断、退出会清理待触发的状态切换；麦克风静音时播放完成保持待机。

这是会话事件驱动的表现层，不是MiniCPM原生输出动作。微笑复用现有带微笑的待机视频；点头为整个画面的轻量CSS示意动画，不是真实头部动作。倾听/思考目前由状态指示区分，没有独立生成的视频。后续可替换为模型动作指令和专门的动作素材。

2026-09-27 Playwright验证五状态转换、说话输入优先级、点头延时、播放优先级、打断/退出取消计时、静音完成；复用待机视频作为测试夹具，验证解码首帧触发说话、视频结束恢复微笑且底层持续播放。没有新增GPU推理或真人麦克风验收。

### 2026-09-27 按实际声音切换 + 常驻循环

8026 的样例区域嵌入 8027/preview，与交互页共享 av-player.js。底层待机永不换 src、永不因回复暂停；上层独立加载回复，Web Audio 分析正在播放的 PCM，检测到 RMS > 0.002 且视频已解码、未暂停后才显示说话画面。生成事件和静音首帧均不会触发说话；自然句中停顿不切换，媒体缓冲/暂停时恢复待机。浏览器拒绝有声播放则保留待机并显示手动播放按钮。不能观测操作系统音量或用户物理扬声器是否静音。

浏览器验证：前2秒静音的5秒音视频夹具，1.015s仍隐藏回复且待机播放，2.016s声音出现后显示回复；结束后回复隐藏、待机继续。待机跨循环末尾正常重播；静音前导期间取消后旧视频未重新显示。测试使用合成音频，不代表真人麦克风验收。

### 五状态素材接入与微笑纠正

四段H3动作生成完成，已检查1fps抽帧。倾听/思考分别为头部倾斜、视线变化；微笑存在明显露齿笑，不适合作为通用待机。默认与播放结束均改为倾听；用户说完进入思考，声音播放才进入说话；微笑与点头是一次性反馈，当前只有手动预览入口，尚无模型语义触发。素材原始参考照带浅笑，倾听并非完全无表情。

非说话状态已接入不同真实视频，倾听/思考循环，微笑/点头播放完成返回倾听，插话可抢占动作。回复底层动作保持播放。仅更新静态页面与脚本，不重启用户正在使用的后端会话。

### 好友公网测试入口

独立 `live/public_gateway.py` 监听服务器127.0.0.1:8028，Cloudflare Quick Tunnel提供HTTPS/WSS。GPU原始端口不直接公开。网关使用服务端 `public-access.json`（0600，不入库）中的随机口令登录，签发独立随机HttpOnly/Secure/SameSite cookie；HTTP素材和WebSocket均检查认证，WebSocket还校验 `public-origin.txt` 中的公网来源。转发到8027时使用本地来源，保留原有会话独占锁。

进程/日志：`public-gateway.pid`、`public-gateway.log`、`public-tunnel.pid`、`public-tunnel.log`。Quick Tunnel是临时体验链接，进程重启可能换域名，需同步public-origin.txt；目前无开机自启。前端预览入口已改为同域/preview。一次仅一人对话；链接验证包括登录、持续动作播放、HTTPS麦克风API可用和实时WebSocket握手，不代表跨地区语音延迟验收。

### 公网连接在视频交付前断开修复

2026-09-27录屏显示“语音3s”后连接断开；合成公网测试复现1011 keepalive ping timeout。8027/8028 Uvicorn与适配层出站WS心跳容忍等待由默认20秒提高至120秒；补充5秒阶段进度、渲染120秒超时、服务端phase日志以及浏览器关闭码/原因，网关不再吞掉断连异常。公网网关启动使用 `start-public-gateway.sh` 保留这些配置。

外部Playwright浏览器通过原公网域名、Cookie认证上传合成语音；收到真实生成MP4（10.2秒驱动音频，render_ms=13423），连接开始后60.4秒收到视频，63.3秒检测到有声播放。继续检查播放自然结束、回复图层隐藏且无播放错误。此轮使用合成输入并非真人麦克风，尚无多地区稳定性数据。服务器经公网回连自身的Python探针仍出现自身60秒ping timeout，不能视作所有网络路径均已稳定。当前整段语音后再渲染方案仍有明显等待。

## Streaming reply pipeline (2026-09-27)

`app.py` now mounts the existing Gradio preview and internal `/stream-avatar`
WebSocket in one process on loopback 8026. `streaming.py` owns model access through
one shared lock; preview requests cannot reset an in-progress conversational
motion state. `start.sh` uses GPU 4 by default (`AVATAR_GPU` override), because GPU
7 is occupied by a separate training job. Voice stays on GPU 5. GPU 4 is shared
with the existing image service; concurrent image inference will affect latency.

The bridge sends audio immediately as it arrives. The renderer retains its
8-second audio context and motion state within each reply, and returns two model
chunks per segment (currently 1.92 seconds at 25fps). Only the final incomplete
model chunk is zero-padded. Encoding happens once per segment; no final whole-reply
re-encode. CPU libx264 ultrafast is the measured default: on this host, launching
NVENC for each short segment is slower. The encoder keeps an optional NVENC path.

`stream-player.js` fetches fragments as they arrive and appends them to one
MediaSource with explicit timestamps. AAC priming is handled by MP4 edit lists
and append windows. A reply stays on one media URL; state only switches to speaking
once the existing player observes decoded frames and audible PCM. Input remains
active during output; browser uploads use PCM16 (half the float32 payload).

Interrupts stop the local player, abort pending fetches, cancel the renderer
connection, and invalidate prior epochs. GPU operations already executing finish
before another request can own the model. The internal bridge acknowledges each
copied segment before renderer temporary-file cleanup. Session media is removed
on disconnect. The upstream voice API still has no exact played-history
truncation mechanism; this remains a known limitation.

Browser requirement: MSE with H.264/AAC (tested Chrome). Unsupported clients get an
explicit message rather than silently falling back to broken chunk playback.
This is chunked video, not a claim of zero-latency native video streaming.

Validation scripts:
- `perf/stream_trial.py`: bounded synthetic local end-to-end test; run remotely
  after checking `/health` is inactive. Records every segment's inference/encode
  timings and stores MP4 fixtures.
- `perf/encode_bench.py`: isolated encoding comparison (synthetic constant frames,
  so use real generated segment timings for product conclusions).
- `perf/browser-stream-test.js`: Playwright CLI code using synthetic microphone
  input; exercises the public page's actual capture and playback path. Adjust the
  public origin and local fixture path when reproducing.

The temporary public tunnel is unchanged. Pipeline speed and public transport
latency must be reported separately; the latter can still cause buffering.

Playback defaults to two-fragment prebuffering (3.84s), with a one-fragment
low-latency option. This is an explicit latency/continuity tradeoff. Measurements
found voice output itself slower than wall-clock playback in some trials, so
prebuffering is not a universal solution for long replies. Full results and limits
are in `output/avatar-mini02/perf/streaming-results.md` in the local workspace.
