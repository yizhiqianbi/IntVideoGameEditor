# Mini 01 — 自部署双工语音

## 部署配置

- 服务器：119.145.35.48，目录 `/data/zrc/dyt/voice-mini01`。
- GPU：物理 GPU 5（4090 D 48GB）；启动前约 8.4GB 已被其他进程使用。不是独占显卡，不停止原有任务。
- 模型：OpenBMB MiniCPM-o 4.5，Audio Full-Duplex。
- 上游：<https://github.com/OpenBMB/MiniCPM-o-Demo>，初始部署提交 `47709a9210dfd71afa76c058e017fc8c4db5c8d2`。
- 独立 Python 3.12 venv，Torch 2.8，SDPA；默认不启用 compile。
- 模型及缓存留在部署目录，原 H3 / Qwen 服务不改动。
- backend 22510、worker 22410、gateway 8016、内部注册 8017，全部仅监听服务器回环地址。

## 启动

首次：将本目录的 shell 脚本复制到部署目录，执行 `bash setup.sh`。检查 `setup.log`、`download.log`；依赖和权重必须完整。

上游依赖存在冲突：Demo 要求 librosa>=0.10.2，minicpmo-utils 1.0.6 锁定 0.9.0。`finish-dependencies.sh` 保留一份本地源码包，只修改其依赖元数据为 librosa 0.11.0，固定 numpy 2.2.6；安装后执行 pip check。decord 发布包内含旧 cp36 wheel 标签，会报平台警告，但在本环境导入成功；脚本仅接受这条已知警告，其他依赖冲突仍会失败。模型代码未因此修改。

```bash
cd /data/zrc/dyt/voice-mini01
nohup bash start.sh > service.log 2>&1 < /dev/null &
echo $! > service.pid
```

启动脚本检查分片、加载模型，然后启动并注册 worker。只有 backend `/health` 返回 `status: ready` 才启动网关。日志在 `logs/`，关闭脚本进程会关闭它创建的子进程。重启服务器后需要重新执行；尚未安装开机服务。

本机执行 `bash scripts/voice-mini01/tunnel.sh`，再打开 <http://localhost:8016/audio_duplex>。SSH 使用密码提示或已有密钥，不把密码写进仓库。localhost 可申请麦克风权限。初次使用耳机。

## 实际能力与验收边界

该模型提供原生双工模式；不是 ASR+LLM+TTS 级联。输入为 16kHz 单声道 float32 PCM，以约一秒块持续上传；输出为 24kHz float32 PCM。统一 WebSocket 路径 `/v1/realtime?mode=audio`，官方页面负责收音、播放与会话控制。

模型可输出 listen 状态；客户端也可通过 `force_listen` 请求转入监听。当前协议没有等价于精确播放时间截断历史的公开 API。不能把它描述成已实现 OpenAI 风格的即时取消、未播放文本历史回滚。

上游音频会话默认最长 600 秒。逐项验证前，不宣称达到 Mini 01 的 200ms 打断、1.5s 首音频或十分钟稳定性目标。原生模型宣称不等于本机实测。

默认关闭会话录音。连接仅经 SSH 本机隧道，不作为无鉴权的公网推理服务发布。

## 验收记录

- 2026-09-27：依赖、4 个权重分片安装完成，模型初始化约 95 秒。backend health 返回 ready，worker 注册成功。本机 SSH 隧道、网页 HTTP 200 通过。
- GPU5 加载后总显存约 30096MiB（含原有任务），无 OOM。
- 中文合成音频 WebSocket 测试：返回完整中文回复，18 段音频；force_listen 三个输入块在后台执行。保存远端 probe-full.json / probe-output.wav，本地 output/voice-mini01/probe-full.json。
- 第二轮 probe 从 session.created 到收到首音频约 4975ms，包含输入音频时间；不是用户说完后的响应延迟。音频块接收间隔中位数约 1491ms，音频块推理耗时中位数约 1396ms，生成速度落后于播放速度。
- Playwright 用文件输入验证浏览器：中文回复、Speaking 状态、播放队列统计正常出现；官方 TTFS 指标约 2060ms，页面出现音频欠载。文件尾部补空 30 秒，完成后自动关闭会话，worker 回到 idle。仅有 favicon 404，无发现的页面 JavaScript 异常。
- 官方 probe 首轮提前关闭会话时，后端记录一次向已关闭 WebSocket 发送的异常；随后新会话能够正常建立。需在长期稳定性阶段继续检查退出竞态。
- 不将上述合成音频或界面统计当作真人主观听感验证。模型第一轮自我介绍错误，需要设置明确身份提示词。
- 浏览器实际麦克风/播放、中文十轮、20 回复/10 打断：待测试。
- 历史修正、短回应和外放误触发：待验证；精确历史截断为已知协议缺口。
- 后续 React 最小页面与可观测延迟：先验证官方链路后实施。
- 视频阶段：未开始。

## 性能开关与复测

可选配置文件 `/data/zrc/dyt/voice-mini01/performance.env`，参考本目录 `performance.env.example`。当前验证后保留 compile=0、threads=28、pad_audio=1。补静音开关需要先执行 `perf/patch-padding.py`，默认不改变上游行为。配置只在重启时生效。

`perf/optimize.py` 进行隔离基准，`perf/run-ab.sh` 会停止语音服务并在退出时恢复，请先确认没有在线会话。结果用 `perf/summarize.py` 排除监听块后汇总。不要依据不同输出长度的总体 RTF 自动宣称优化收益。

更新正在运行的 shell 脚本时，先传到临时文件，`bash -n` 验证后再原子 `mv`，避免改变运行中解释器的文件偏移。启动锁会等待最多60秒，容许上一进程释放模型；仍需检查 backend 与 worker health 及真实生成，而非只看 bridge health。
