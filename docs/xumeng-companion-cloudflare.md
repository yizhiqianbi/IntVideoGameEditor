# 女友 Chat 的 Cloudflare 部署

2026-10-18：用户已授权发布到 Cloudflare，并明确选择面向全部正式登录用户。OAuth Containers 权限已完成；正式宿主已启用女友聊天计费。最新回执见 `output/xumeng/iteration/companion-recovery-20261018/round.json`。

## 女友聊天 Credit 结算（2026-10-18）

每条有效助手回复固定结算 2 Credit（价格版本 1）。发送前先预留，只有宿主读到新的助手消息才结算；失败、超时、重复请求和余额不足不会重复扣费，失败或过期预留会释放。计费账本独立于普通聊天、媒体和其他支付通道，Super 账号也沿用同一规则。生产 `GET /api/xumeng/companion/api/billing` 只返回当前登录账号的启用状态、版本、余额、预留和脱敏回执，未登录保持 401。

创建女友会话时可设置性格、说话风格和相处方式。设置保存在新会话并按会话隔离，旧会话不回写；宿主会在发送给原生实例前注入私有风格段，返回给用户时移除该段。网页显示“每条 2 Credit”。

## 运行和隔离

现有 dzmm-web 验证正式登录身份，经内部 COMPANION service binding 路由到 xumeng-companion。每个账号独享 Durable Object 和 MaiBot 1.3.9 原生实例，容器服务没有公网 workers.dev 或预览入口。浏览器不能指定归属账号，Cookie 和浏览器认证头不进入容器。未登录、游客和无效角色不可用；正式 user/super 均可用。

初期最多5个同时运行实例，每账号每分钟6条新消息，容量满时返回稍后再试，不共用其他账号的实例。实例使用 standard-1；关闭页面、停止访问10分钟后执行备份并休眠。页面持续轮询会保持活跃，这10分钟不是从最后一条聊天起算。

## 持久化与边界

容器磁盘为临时存储。空闲时按顺序停止接收、排空请求、正常停止原生进程、生成完整实例归档、验证文件及归属、写入私有 R2，再提交 DO 指针并销毁实例。下次先恢复归档后启动。私有桶为 xumeng-companion-memory，未开放公共访问；原生配置、会话、SQLite、记忆与插件数据进入备份，日志不进入归档。

用户消息的原文、请求编号和响应另行持久化，重复请求不重发；送达不明时要求查看记录。成功读取的消息快照也保存在私有 R2。异常丢失运行中容器时，原生尚未备份的自主状态不能承诺零丢失，系统保留现有快照与送达记录并停止发送，等待恢复核查，不静默清空或回退。

后续更新容器镜像前必须完成所有活跃账号的一致备份；默认调度的新镜像会替换实例。不能把正常闲置恢复测试等同于异常终止下零丢失证明。

## 本次已完成的验证

- 私有宿主19项隔离测试、消息网关19项、账户桥接4项、Web相关回归及类型检查通过。
- 容器生命周期Node10项、Python10项通过；包括真实官方初始化的只读目录校验与真实CLI备份恢复。
- 实际非root Linux/amd64 Docker、断网和合成模型Key下：启动、建空会话、正常停止、归档、新容器恢复、同编号空会话读取及再次停止通过。
- 本地恢复发现并修复两个真实问题：官方初始化日志写入只读代码目录；恢复CLI把实例目录和归档参数传反。后续必须保留真实CLI及HTTP往返，不能只测内部函数。
- 前端直接复用最新三分区生产资源 index-vRvXYY4P.js / index-CNb0-Zsc.css，原有931个资源全部保留；桌面/390px隔离UI与错误恢复已验收。
- 本机离线验收没有外部模型请求；生产health可能启动原生embedding探测，不能记为零模型用量。ready只证明原生WebUI传输连通，不代表真实回复或全部记忆能力验收。

## 配置与费用

模型复用已配置的OpenRouter，密钥只写Cloudflare Secret，不进入前端、镜像、日志或仓库。原生启动含embedding自检和周期探测，尚无用户消息时也可能产生API费用。运营者此前已接受固定版本上游协议；许可文件保留在镜像中。

Cloudflare基础计划与容器计算、内存、磁盘用量分别计费，模型另计；不能将每月5美元称为总费用。本次没有购买或升级套餐。

官方依据：[容器API](https://developers.cloudflare.com/containers/api/durable-object-container/)、[默认调度](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)、[费用](https://developers.cloudflare.com/containers/platform/pricing/)、[R2接口](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)。

## 正式发布结果

最新计费与恢复发布：Backend `96ebe0b4-0093-49bb-a595-991c96374087`，Web `39ae1dd9-358a-4fe4-8f5e-e18fa7d28fea`，Companion host `ded813c7-1ead-41c2-a786-50afaae3c00f`；0051 计费迁移已应用。宿主发布使用不替换容器镜像的方式，保留现有实例，并在现有容器健康时自动解除旧的异常恢复阻断。登录后只读计费概览返回启用、版本1、2 Credit/条和0预留；未发送文本聊天，未创建订单或付款。生产真实回复、风格效果、容器闲置恢复和满载容量仍需普通测试消息与后续运行观察。

旧的三分类发布版本仍保留在 `output/xumeng/companion-release-20261018`，其中的健康与原生实例说明是历史快照；当前计费边界以 `output/xumeng/iteration/companion-billing-20261018/round.json` 为准。

入口：[女友聊天](https://xumengchat.top/#chat/girlfriend)。所有正式登录账号可用，当前同时运行上限5；容量满时稍后重试。


## 2026-10-18 恢复保护补丁（最终发布）

宿主最终版本 `43d57dcc-e53f-4bce-9954-3063d92af7af`。除健康同一容器自动解除旧阻断外，确实丢失但没有任何其他 Durable Object 状态键、没有快照的空实例可以安全重置并重新启动；存在任意持久化键（包括收据、风格、会话观察或未来未知状态）时继续人工核查，避免覆盖会话。容器镜像未重新部署。定向宿主测试 23/23，类型检查通过。


## 2026-10-18 原生进程停止恢复补丁

用户再次复现恢复核查后，补上 `unexpected-native-stop` 分支。宿主会先确认同一 controller 的原生进程是否已恢复；若确实失败且没有任何 Durable Object 状态键、没有快照，只销毁空容器后重启；存在任何持久化键时继续人工核查。最终宿主版本 `b0fbe758-8e25-4c7f-9e62-f5a63bfa8cc7`，容器镜像未变，定向宿主测试 24/24，类型检查通过。


最终发布版本更新为 `0856aaef-6d03-44fe-b02e-19a267a4b372`；空实例判定改为完整 Durable Object key listing，避免有限列表截断。定向宿主测试仍为 24/24，类型检查通过，容器镜像未变。
