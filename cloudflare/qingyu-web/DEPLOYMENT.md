# 晴屿部署

主站：https://qingyu.xumengchat.top

旧的 workers.dev 地址在当前网络出现 TLS 连接中断，不再作为主入口。正式子域名由独立 qingyu-stories Worker 提供服务，原版 xumengchat.top 的 dzmm-web 绑定保持不变。

本地：http://127.0.0.1:5186

主站使用独立的 `qingyu-stories` Worker、`qingyu-db` D1 数据库、`qingyu-media` R2 存储。原生陪伴使用私有的 `qingyu-companion` 服务、独立 Durable Objects 与 `qingyu-companion-memory` 存储。不会连接原版 xumeng 的用户数据或记忆。

本地依次运行 `npm run dev:native`、`npm run dev:worker`、`npm run dev`。本地配置保存在忽略提交的 `.dev.vars`，部署配置与本地配置分开：`wrangler.production.jsonc` 配置生产陪伴绑定，本地继续使用私有 localhost 服务。

更新主站运行 `npm run deploy`。服务端密钥已保存在 Cloudflare，后续代码部署会保留它们。需要更换密钥时使用 Wrangler secrets，禁止将供应商密钥写进前端或公开文档。

更新原生陪伴镜像前，先暂停新的陪伴请求并通过私有 `checkpointForDeployment()` 检查每个活跃实例。只有确认返回成功、记忆已经保存、容器停止后才能滚动更新；更新后等待 Cloudflare 的镜像部署完成，再开放访问。检查失败时保留容器和记录，不自动回退到较旧备份。

更新原生陪伴需要 Docker 兼容引擎，运行 `node scripts/update-native-manifest.mjs`、`npm run deploy:native`。准备脚本仅复制已登记且哈希一致的构建文件，不包含本地实例、账号记忆、虚拟环境或供应商配置。容器构建文件已包含共用女性向提示词资源。

邮箱验证码、电话、视频暂未接入；账号可用邮箱与密码注册登录。支付、USDT、会员购买、兑换、提现和邀请返利保持关闭。

部署记录与实际线上验证保存在 `evidence/deploy-*.log` 及 `evidence/deploy-*.json`。本地测试账号、密钥输入文件与构建上下文位于忽略提交的 `.runtime/`，不作为生产数据迁移。

本次上线已验证账号注册与密码登录、主站真实模型回复、数据库保存及刷新、独立私有图片的上传/访问/删除、手机宽度显示，以及支付和通话入口关闭。原生陪伴测试曾在 Cloudflare 镜像滚动更新时触发恢复保护，较新记录与审计备份已保留，未强制回滚。当前镜像启用官方优化 Planner 提示与有界的未发送回复重试。

当前镜像使用全新独立测试账号已验证原生陆时予实际回复，刷新后回复仍在，健康状态 ready/transportReady 均为 true，A_Memorix 开启；390px 手机宽度没有横向溢出。对应记录为 evidence/deploy-native-cloud-browser.log。

2026-10-24 入口修复：新增 custom domain qingyu.xumengchat.top，保留独立数据库、存储与原生服务绑定。在当前电脑和 Codex 内置浏览器均确认首页可访问；新域名登录200，已有收藏与3条会话消息可读取，Secure/HttpOnly Cookie 正常。检查见 evidence/custom-domain-http.json 和 evidence/custom-domain-login.json。

2026-10-24 人物卡更新：主站版本 `40f9193b-7917-4f6f-868d-fc51324972b3`，四张完整原创卡及三位陪伴默认风格已发布。每人三个独立开场、十条世界书；SillyTavern V2 下载位于 `/character-cards/{qy-shiyu,qy-shen,qy-linchuan,qy-xingcheng}.json`。主站默认和 Qwen 选项使用 `qwen/qwen3.6-plus`，可选思考关闭；型号与长上下文/缓存费用上限已核对官方元数据。支付与用户计费保持关闭，原生容器没有滚动更新。44项检查、类型检查与构建通过；实际下载和登录后对话结果见 `evidence/character-cards-production.json`，人物写作复核及局限见 `authoring/README.md`。
