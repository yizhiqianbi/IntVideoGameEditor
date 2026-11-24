# 短剧 GPU 容器（AutoDL）

换实例、关机再开机后，几乎每次都做同一套：SSH 进去 → 拉起 6006/6008 → 改 `DRAMA_COMFY_URL` → 必要时重新部署。密码、端口、公网域名每次都会变，不要写进 git。

## 当前实例（2026-09-14 晚）

| 项 | 值 |
| --- | --- |
| SSH | `ssh -p 35949 root@connect.westd.seetacloud.com` |
| 密码 | AutoDL 控制台，或本机 `.env.local` 的 `DRAMA_GPU_SSH_PASS`（已 gitignore） |
| GPU | RTX 5090 32GB |
| 数据盘 | `/root/autodl-tmp`（权重、10Eros、存档；不随镜像备份，但同账号数据盘可挂到新容器） |
| ComfyUI | 本机 `127.0.0.1:6006` → 公网 `https://u473272-aa55-816f0435.westd.seetacloud.com:8443` |
| 10Eros / LTX | 本机 `127.0.0.1:6008` → 公网 `https://uu473272-aa55-816f0435.westd.seetacloud.com:8443` |

网站只配 **ComfyUI 的 6006 公网地址** 到 `DRAMA_COMFY_URL`。LTX 由 Comfy 节点 `pencil_ltx_bridge.py` 在容器内转发到 `127.0.0.1:6008`，浏览器不直连 6008。

## 一键启动

在仓库根目录：

```sh
./scripts/boot-drama-gpu.sh
```

脚本会：

1. 读取 `.env.local` 里的 SSH 与公网 URL
2. 把 `scripts/gpu/pencil_*.py` 同步到容器
3. 若 6006 / 6008 没起来，用 nohup 拉起
4. 打本地 `/pencil/health`、`/pencil/ltx/health`、`/health`，再打公网映射

`.env.local` 需要这些键（示例值随容器变化）：

```
DRAMA_COMFY_URL=https://u473272-aa55-816f0435.westd.seetacloud.com:8443
DRAMA_LTX_URL=https://uu473272-aa55-816f0435.westd.seetacloud.com:8443
DRAMA_GPU_SSH_HOST=connect.westd.seetacloud.com
DRAMA_GPU_SSH_PORT=35949
DRAMA_GPU_SSH_USER=root
DRAMA_GPU_SSH_PASS=（控制台密码，勿提交）
```

依赖本机 `sshpass`：`brew install hudochenkov/sshpass/sshpass`。

## 手动启动（脚本失败时）

```sh
ssh -p 35949 root@connect.westd.seetacloud.com
```

容器内：

```sh
# 10Eros / Sulphur / PinkCherry 后端
nohup /root/autodl-tmp/10Eros-backend/start.sh >> /root/pencil-10eros.log 2>&1 &

# ComfyUI（H3 + pencil 自定义节点）
cd /root/ComfyUI
nohup /root/miniconda3/bin/python main.py \
  --listen 0.0.0.0 --port 6006 \
  --enable-cors-header --preview-method latent2rgb --preview-size 256 \
  >> /root/pencil-comfyui.log 2>&1 &
```

健康检查：

```sh
curl -sS http://127.0.0.1:6006/pencil/health
curl -sS http://127.0.0.1:6006/pencil/ltx/health
curl -sS http://127.0.0.1:6008/health
```

公网：

```sh
curl -sS https://u473272-aa55-816f0435.westd.seetacloud.com:8443/pencil/health
curl -sS https://uu473272-aa55-816f0435.westd.seetacloud.com:8443/health
```

日志：`/root/pencil-comfyui.log`、`/root/pencil-10eros.log`。

## 站点怎么接到这台机器

1. 改本机 `.env.local` 的 `DRAMA_COMFY_URL` 为 **6006 公网 HTTPS**。
2. 同步 Vercel（三个环境都要改，然后生产部署才会带上新值）：

```sh
printf '%s' 'https://u473272-aa55-816f0435.westd.seetacloud.com:8443' | vercel env rm DRAMA_COMFY_URL production --yes
# 再 vercel env add；preview / development 同样
vercel --prod
```

3. 本地 `next dev` 读 `.env.local`，一般不用再开 SSH 隧道。`scripts/connect-drama-gpu.sh` 只在没有公网映射、必须把 6006 转到本机 6106 时用。

## 换新容器清单

AutoDL 每次开机都会给新的 SSH 端口、密码、以及 `u…` / `uu…` 两个公网域名。数据盘上的权重通常还在，**进程不会自动起来**。

1. 控制台复制 SSH：`ssh -p <端口> root@connect.<区域>.seetacloud.com` 和密码。
2. 自定义服务弹窗里复制 6006、6008 的 HTTPS 映射。注意 6006 一个 `u`，6008 两个 `uu`。
3. 更新 `.env.local` 的 `DRAMA_COMFY_URL`、`DRAMA_LTX_URL`、`DRAMA_GPU_SSH_*`。
4. `./scripts/boot-drama-gpu.sh`。
5. 更新 Vercel `DRAMA_COMFY_URL` 并 `vercel --prod`。
6. 打开 `/drama` 或 `/video-studio`，看连接设置里 GPU 是否为绿点；生成一条短镜头确认。

存档扩展 `pencil_archives.py` 和 `/root/.pencil-archive-token` 在数据盘/家目录里。新容器若家目录是空的，boot 脚本仍会同步节点；令牌文件没有时，把旧实例的 token 拷回来，或重新生成并写入 Vercel `DRAMA_ARCHIVE_TOKEN`。

## 容器里有什么

| 路径 | 作用 |
| --- | --- |
| `/root/ComfyUI` | H3 视频，端口 6006 |
| `/root/ComfyUI/custom_nodes/pencil_*.py` | 健康检查、LTX 桥、存档、参考音视频、30 秒分段、Flux 生图 |
| `/root/ComfyUI/custom_nodes/ComfyUI-MiniMaxH3-TimelineDirector` | H3 时间线导演台（素材规划 + 有限分段采样） |
| `/root/autodl-tmp/pencil-models/flux` | Flux.1-dev fp8 + Heartsync NSFW LoRA |
| `/root/autodl-tmp/10Eros-backend` | LTX / 10Eros / Sulphur，端口 6008 |
| `/root/autodl-tmp/pencil-archives` | AutoDL 云存档 ZIP |
| `/root/.pencil-archive-token` | 存档接口 Bearer，与 Vercel `DRAMA_ARCHIVE_TOKEN` 相同 |

AuK 已停用，工作台不再生成对白。数据盘上的 `/root/autodl-tmp/AuK`、`auk-ckpts` 可留着不占显存。

**显存互斥（同一时间只占一家）**：5090 32GB 装不下 H3（约 26GB）再加 Flux / LTX。`pencil_gpu_guard.py` 在提交前切换持有者：

| 即将运行 | 会卸掉 |
| --- | --- |
| H3 视频 | LTX，以及 Comfy 里的 Flux |
| Flux 生图 | LTX，以及 Comfy 里的 H3 |
| LTX | Comfy（H3/Flux） |

连续 H3 或连续 Flux 不会每条都重载。不要并行点「生成视频」和「生成首帧」。

`/root/start_comfyui.sh` 是开机脚本，但无卡模式或实例刚起来时经常没跑到。不要假设开机即有服务，以 `boot-drama-gpu.sh` 为准。
