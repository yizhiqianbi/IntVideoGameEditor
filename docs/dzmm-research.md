# DZMM 界面研究与 Cloudflare 部署

线上页面：[xumengchat.top 角色与对话](https://xumengchat.top/dzmm)，[原 workers.dev 入口](https://dzmm-web.850587960.workers.dev/dzmm) 继续可访问。前端与模型聊天已发布到独立 Cloudflare Worker `dzmm-web`，通过 Service Binding 连接已有的[业务 Worker](https://dzmm-backend.850587960.workers.dev)。业务服务继续使用 APAC D1 数据库 `dzmm-db` 和 R2 封面存储桶 `dzmm-media`；角色、会话、消息、收藏和偏好设置由服务器持久化，私人封面保存在 R2。发布和域名接入没有重建或清空这些资源。

本地 Next.js 页面仍可用：`http://127.0.0.1:3010/dzmm`。启动命令：

```sh
npm run dev -- --port 3010 --hostname 127.0.0.1
```

当前 `.env.local` 中的业务后端地址为：

```dotenv
DZMM_BACKEND_URL=https://dzmm-backend.850587960.workers.dev
```

线上业务访问路径是 `/dzmm` → 前端 Worker `/api/dzmm/backend/v1/*` → `BACKEND` Service Binding → 业务 Worker `/v1/*` → D1/R2。线上模型聊天由前端 Worker 的 `/api/dzmm/chat` 调用 OpenRouter；本地保留 Next.js 同源代理与聊天路由。两个运行环境复用相同的聊天校验、提示词和流式处理代码。

## 已实现

- 浅色、深色、跟随系统主题，粉色强调色，响应式角色封面网格和导航。
- 21 个原站分类入口、分类目录与真实空态；按已收录角色筛选、已观察热度/点赞记录排序和收录时间筛选。
- 全站入口搜索角色、作者及本站真实论坛主题；作者作品页、当前账户的关注列表、收藏和随机匹配。
- 独立角色详情、作者跳转/关注、本站链接分享、角色导出与定制，以及已迁入的真实多图轮播。
- 快速/专业角色创作，编辑身份、展示介绍、人物设定、系统/历史后指令、对话示例、多条与备选开场、标签和世界书；保存草稿与试聊。
- 普通 JSON 与 SillyTavern v2 JSON 角色卡导入、导出，保留自供角色上下文、图库与建议回复。
- 创作者中心投稿快照、Super 批准/退回、版本更新/撤回/下架，批准后进入独立公共目录；审批后 R2 图片公开副本与私人素材隔离。
- 单人流式模型聊天、停止生成、重新生成、新会话、会话导入和导出。
- 游客会话、邮箱注册、登录、退出、保留现有数据的游客账号升级，以及校验当前密码的正式账户改密。
- 按账户持久化私人角色、会话、完整消息、收藏、资料、关注、主题/布局/悬浮聊天偏好、屏蔽标签、用户人设和预设库。
- 独立个人页和设置页；复制账户 ID、编辑昵称/简介/性别、查看角色/收藏/会话/关注，以及确认后删除私人角色与关联记录。
- 预设新增、编辑、删除、激活及 JSON 导入/导出；聊天设置支持会话改名、分支、导出、删除和实际模型回复长度配置。
- 云端同步状态、失败提示、冲突后加载云端记录，以及当前账户的本地备份恢复。
- R2 私人封面上传、读取和删除接口；上传后返回同源封面地址，可写入角色记录。
- D1 论坛主题/作品列表、分类/标签/搜索/分页、主题详情、正式账户发帖/编辑/删除/回复/投票/举报，以及 Super 举报处理与主题/回复管理。
- 六项真实任务与统一 Credit 钱包：服务端进度、原子领取、UTC 每日签到；游客可读本人进度，正式账户可领取并用于聊天消费。
- 浏览器 PWA 安装页、真实 manifest 和应用图标，支持实际可用的安装提示及手机/电脑手工指引；没有 APK。

论坛已接入本站真实 D1 数据，空列表不填充演示帖子或原站互动数字。原站正式账户发帖表单内部尚未观察到，因此当前可用编辑器不声明逐项一比一还原。支付、邮箱验证/找回、声优、图像生成、小说和原站全部专业世界书扩展规则尚未实现；比赛及日/周/月历史榜单数据也未迁入。群聊按用户明确要求排除。当前版本仍是部分复刻，逐页证据与缺口见 [功能覆盖记录](dzmm-feature-coverage.md)。

## Cloudflare 后端与部署状态

Worker 工程位于 `cloudflare/dzmm`，生产部署使用 `wrangler.production.jsonc`。D1 保存用户、会话凭证、私人角色、会话、消息、收藏、偏好，以及公开论坛主题、标签、回复、投票和举报；私人业务记录按用户归属隔离。2026-10-02 首次导入后公共目录为 18 条：8 条公开介绍原文和既有 10 条原创改写样本。2026-10-03 已新增并发布 33 条公开介绍，当前目录共 51 条，即 41 条公开原文加 10 条原创改写；新批次线上验证已完成。公共角色不以同一 ID 写入私人角色表。

主要接口：

- `GET /health`：业务服务健康状态。
- `GET /v1/session` 与 `/v1/auth/{guest,register,login,logout}`：会话与账户流程。
- `POST /v1/auth/password`：正式账户提交当前账户 ID、当前密码和新密码；改密保留当前会话并撤销其他会话。已验证邮箱且尚未设置密码的账户可设置首次密码；验证码登录的当前接口与配置见 [叙梦邮箱验证码登录](./xumeng-email-login.md)。
- `GET /v1/state`：返回当前账户的状态、版本、初始化标记与用户资料。
- `PUT /v1/state`：接收 `{ state, version, accountId }`，按变化增量写入。
- `/v1/characters`、`/v1/conversations`、`/v1/conversations/:id/messages`、`/v1/favorites/:id`、`/v1/preferences`：私人业务数据操作。
- `POST /v1/media` 与 `GET` / `DELETE /v1/media/:userId/:filename`：上传、读取和删除当前账户的封面；上传支持 PNG、JPEG、WebP，最多 5 MB。
- `/v1/forum/posts`、`/posts/:id`、`/posts/:id/replies`、`/posts/:id/vote`、`/posts/:id/report`、`/replies/:id`：主题列表/搜索、主题读写、回复、投票、举报和回复删除；完整路径均以 `/v1/forum` 开头。
- `GET /v1/forum/reports` 与 `PATCH /v1/forum/reports/:id/status`：仅 Super 可查看和处理举报。
- `GET /v1/tasks` 与 `POST /v1/tasks/:id/claim`：本人真实任务进度/统一 Credit 余额及正式账户领取，领取只接收匹配当前会话的 `{ accountId }`。

状态写入采用版本校验和事务内 nonce 条件保护，较旧版本返回 `409`，不会覆盖其他页面已保存的内容。`accountId` 必须匹配当前会话，防止另一标签页切换账户后，旧标签页把旧记录写入新账户。账号凭证由 HttpOnly 会话 Cookie 承载；返回的状态和备份不包含会话令牌或密码哈希。

迁移 `0002_preferences_extras.sql` 为偏好新增 `extra_json`，共享校验器和后端同时约束资料、主题、首页布局、悬浮聊天、屏蔽标签、作者关注、预设库与回复 tokens 上限。迁移 `0003_forum.sql` 新增真实论坛表，`0004_super_accounts.sql` 为用户增加 `user` / `super` 权限。游客可浏览论坛，正式账户可写入；普通用户只管理自己主题和回复，Super 可管理全站主题/回复并处理举报。

公开游客/注册接口拒绝请求中声明的 `role`，注册无法创建 Super。管理权限由受信任的 Cloudflare CLI 对已核验的指定账户赋予，脚本为 `cloudflare/dzmm/scripts/provision-super.mjs`。生产管理账户已创建并验证，临时管理会话已退出；凭据保存在仓库之外，文档与静态构建不包含密码。权限和操作依据见 `output/dzmm/super-account-verification-2026-10-03.json`。

### 更换前端域名时的账户与记录

会话 Cookie 和浏览器本地备份属于打开页面的来源。新的 `workers.dev` 前端不会自动得到 `http://127.0.0.1:3010` 的 Cookie 或 localStorage；第一次打开新站通常会建立新的游客账户。这不代表原 D1 数据被删除，也不会自动把两个游客合并。

要在新站继续使用原本地游客记录，应先在本地个人页将该游客注册升级为邮箱账户，确认同步完成，再在新站登录同一邮箱。升级保留原 `userId`，因此角色、会话、收藏、偏好和原账户的 R2 封面可以继续读取。已注册账户直接在新站登录即可。

个人页可以导出完整记录备份、恢复当前来源下当前账户的本地恢复副本；目前没有跨域全量备份导入界面。角色卡和会话可以分别导入，但不会自动迁移旧游客凭证或授予另一个账户访问私人 R2 封面的权限。

已将原浏览器中的 **2 个自定义角色、1 条会话、1 项收藏** 从本地 D1 迁移至线上 D1，并保留原游客会话。当前 UI 已读回这些服务器记录并完成同步。

单次 JSON 请求限制为 2 MiB，单次变更最多 500 条记录。正常追加消息只写新增或变化的记录，不重建全部聊天历史；较大的首次迁移需要分批处理。

### 独立 Cloudflare 前端

独立前端工程位于 `cloudflare/dzmm-web`，生产配置为该目录的 `wrangler.jsonc`。Vite 构建复用 DZMM React 界面和共享工具；首次 8 条公开介绍导入的构建为 26 个文件，包含页面与 JS/CSS，以及 23 个白名单资源：3 个品牌文件、18 张封面和 2 个公开目录 JSON。2026-10-03 的 33 条介绍扩容批次构建为 59 个普通文件，其中 56 个白名单资源为 3 个品牌文件、51 张封面和 2 个公开目录 JSON。初次发布时为 17 个文件和 14 个白名单资源（3 个品牌文件、10 张封面、1 个 JSON）；各批次数量分别记录。生产不发布源码映射、根工程的其他编辑器页面、`.env.local` 或本地输出目录，也不重建或清空现有 D1 数据库和 R2 存储桶。根路径与 `/dzmm` 均可访问，支持原有 hash 链接，以及 `?character=ID`、`?view=characters|chat|forum|profile` 的入口兼容。

页面继续访问同源 `/api/dzmm/backend/*`。前端 Worker 先检查浏览器请求来源，再通过 `BACKEND` Service Binding 转发至已有业务 Worker；内部请求的 Origin 改为后端自身来源，因此无需把新站加入后端现有的 `APP_ORIGINS`。代理只转发允许的请求头和 `dzmm_session` Cookie，保留会话设置、图片类型和安全响应头，并传递边缘提供的真实客户端 IP，以保持账户限流有效。

公开站的模型密钥已通过标准输入写入 `DZMM_API_KEY` Worker Secret，不写入 Vite 环境变量、静态 JavaScript 或 Wrangler 明文配置。聊天入口要求有效的服务器会话，`CHAT_RATE_LIMITER` 默认分别对用户和 IP 限制每 60 秒 6 次聊天请求；游客也是有效账户。超过限制返回 `429` 和 `Retry-After: 60`。Cloudflare 的限流计数按边缘位置运行且最终一致，不能充当精确的计费额度或全站总支出上限。平台边界见 [Workers Rate Limiting 官方文档](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#accuracy)。

独立前端的构建、验证与发布命令：

```sh
npm --prefix cloudflare/dzmm-web ci
npm --prefix cloudflare/dzmm-web run check
npm --prefix cloudflare/dzmm-web run test:web
npm --prefix cloudflare/dzmm-web run deploy:dry-run
cd cloudflare/dzmm-web
npx wrangler secret put DZMM_API_KEY --config wrangler.jsonc
npm run deploy
```

密钥通过 Wrangler 提示输入，后续发布已有 Secret 的版本不需要再次上传密钥。也可在已配置本地模型的环境中执行 `npm run secrets:sync`：该脚本只把选定的模型密钥通过标准输入交给 Wrangler，不创建密钥文件或上传整份 `.env.local`。发布命令只更新前端 Worker 和静态资源，不运行后端数据库迁移。`dev` 和 `preview` 是纯 Vite 页面服务；要检查完整的账户、代理与模型接口，应使用部署后的 Worker，或连接业务 Worker 的 `dev:worker`。

### R2 状态

R2 订阅已实际启用；已创建 Standard 存储桶 `dzmm-media`，创建时使用 APAC 地区提示。业务 Worker 生产配置已绑定 `MEDIA` 并完成部署。对象保持私有，通过当前账户的 HttpOnly 会话和前端同源代理读取，其他账户读取或删除返回 `404`。

已通过同源代理实测上传一张 45,358 字节的 WebP 封面：上传返回 `201`，下载字节完全一致，Content-Type、`nosniff` 和 CSP 响应头均保留。另一游客读取、删除均返回 `404`，原账户仍可读取；游客注册后，将上传地址保存至自己的角色 `cover` 字段也已通过。

登录后的真实浏览器已显示该 R2 封面，图片加载完成且原始尺寸为 640 × 640，截图保存在 `output/dzmm/cloudflare-r2-cover.png`。随后用独立所有者会话删除图片返回 `200`，再次读取返回 `404`，并完成退出登录。上传通过原始接口完成，页面上传按钮操作尚未列为已验证。没有绑定 `MEDIA` 的其他部署仍会对封面接口返回 `503`。

独立线上前端的部署验证另上传了一张 84,782 字节的 WebP，下载字节一致，图片类型、安全头和跨账户 `404` 均通过；登录后的浏览器已显示该测试封面，原始尺寸为 640 × 853。

## 公开角色样本

2026 年 10 月 2 日通过原站游客页面记录了 10 张角色卡的名称、封面、已观察到的作者和统计。封面通过网页中实际存在的图片元素下载，保存在 `public/dzmm/covers`，未枚举隐藏接口。数据集位于 `public/dzmm/public-character-samples.json`，每条记录含公开来源链接。

角色简介、性格、场景、开场白是按题材重新写的样本。**没有获取原站隐藏提示词，不代表完整原站人设。** 用户已完成原站首次设置中的年龄与协议确认，之后继续观察了公开角色详情、开场页面、聊天主界面和模型菜单。

### 2026-10-02 资源与目录补充

已保存原站公开链接的真实 `icon.svg` 和 `favicon.ico`，位于 `public/dzmm/brand`。导航 Logo 与 `/dzmm` 页签图标已改用这些资源；`sources.json` 记录来源、大小与 SHA-256。原站导航和 Apple 图标使用同一 SVG，因此这两个文件不代表两个不同品牌 Logo。

`output/dzmm/observed-public-catalog.json` 保存了实际点击“新手”页签后观察到的 24 条角色 ID、名称、作者和来源链接；其中 10 条已有本地封面。它是目录索引，不是完整人设，也不表示已遍历全站。全站总数未知，`complete` 为 `false`。

用户已确认有人设迁移授权；当前仍未收到原始角色卡导出文件。在已检查的角色 `2999180` 上，“更多”仅提供举报，“分享”提供分享图片、分享到聊天和社区，未观察到完整角色卡下载。这个结果不推断作者编辑页或其他角色一定没有导出入口，也不影响已公开人设文本的迁移。公开长篇介绍中实际展示的背景、性格、用户设定和开场场景，可以保留原文与来源并迁入相应人设字段；完整原始卡、未公开扩展字段和服务端隐藏设定仍未知。

### Lumivale 公开内容复查与采集方针

[DZMM 官方线路页](https://dzmm-home.github.io/dzmm-addr/)同时列出 [Lumivale](https://www.lumivale.xyz) 与 `dzmm.ai`，确认 Lumivale 是其公开入口。复查游客首页实际可见 24 条角色，分类页可见 21 个分类入口；这些页面数量不代表全站角色总数。部分公开详情的长介绍已展示可迁移的人物背景、性格、用户身份与开场内容，先前把人设迁移限定为必须取得原始 JSON / PNG 的判断过窄。

采集阶段沿页面可见链接，在[一般向分类](https://www.lumivale.xyz/category/sfw)保存了当时实际可见的 20 条目录元数据，并检查、保存 8 条非露骨公开介绍原文，共 6,055 字符。文件为 `output/dzmm/lumivale-public-collection.json`，每条原文含实际 URL、作者、角色 ID、`contentOrigin: "public-verbatim"`、`sourceFieldLabel: "角色介绍"` 和 SHA-256。角色 `3021605` 的详情介绍共 743 字符，与列表原文完全一致；详情另记录 10 个标签和 6 个图片 URL。采集阶段仅记录图片 URL，随后按用户“导入”指令下载了本批 8 张 WebP 封面，见下文。首页 24 条角色、21 个分类入口和本次 20 条一般向目录分别记录，不合并为全站或已迁移总数。

该角色列表的介绍 div 使用 `line-clamp-7 md:line-clamp-3`，仅在视觉上截断；DOM 中保留完整 743 字符，与详情“角色介绍”段落的 `textContent` 逐字一致。这说明列表看起来是短摘要，不代表可访问资料只有短摘要。采集 JSON 的 20 个唯一 ID、8 条原文 SHA-256 和来源、作者、封面 URL 已通过校验。

采集文件中未取得的独立原始 `systemPrompt`、`personality`、`scenario`、`firstMessage`、`exampleDialogue`、`worldbook` 字段保持 `null`，原始完整导出卡为 0；这些空值不表示公开介绍正文缺少相应人设信息。收到用户“导入”指令后，8 条介绍已转换为运行角色：`description` 逐字保留全部原文，`personality`、`scenario`、`firstMessage` 为空字符串，模型直接使用公开介绍作为设定，不补造未知的原站字段。运行数据为 `src/lib/dzmm-public-introductions.json`，公开资源副本为 `public/dzmm/public-character-introductions.json`，逐条保留作者、原始页面、原文 SHA-256 和 `promptOrigin: "public-verbatim"`。这批覆盖 8 条已观察公开介绍，未采全站，也未取得隐藏提示词或世界书条目正文。

既有 `public/dzmm/public-character-samples.json` 的 10 条仍是原创改写，不改称原站原文，不被新记录覆盖。首次导入时，`DZMM_CHARACTERS` 以新增 8 条为先、原有 10 条为后，共 18 条；`sourceKind: "public-summary"` 继续描述公共元数据的来源，提示词来源由 `promptOrigin` 独立区分。详情及聊天来源文案按实际来源显示，JSON 导出的 `creator_notes` 包含原文来源说明与页面链接。普通私人 JSON 导入仍会创建独立私人角色，不信任输入文件自行声称的公共来源身份。

8 张新封面位于 `public/dzmm/covers`，下载记录 `output/dzmm/lumivale-cover-import.json` 保存角色来源页、类型、字节数、尺寸及 SHA-256，8 张均检测为 WebP 并完成验图。公共目录在前端及业务 Worker 中共享，本次已发布业务 Worker 版本 `d8f66cce-4746-4b2c-9cf4-38d7c60cb22d` 和前端 Worker 版本 `2ab121f1-c7e0-40b3-8d89-218d70217187`。真实线上浏览器已加载新 bundle `index-6nYe0qXl.js` 并显示新目录；角色 `3021605` 的详情为完整 743 字符原文，封面加载完成、宽 512 像素，来源文案为公开原文，没有水平溢出，截图为 `output/dzmm/lumivale-import-production-detail.png`。线上批量检查已通过：发布的 8 条角色 JSON 与本地逐字一致，8 条介绍 SHA-256 保留，8 张线上封面的字节、格式与哈希均一致，后端/D1 健康检查通过；真实浏览器的 18 张角色封面全部加载且无水平溢出。最终报告 `output/dzmm/lumivale-import-verification.json` 的 7 项检查全部通过，本次未对生产 D1 执行测试写入。导入没有运行数据库迁移，没有写入私人 D1 记录，也没有改动私人 R2 封面或模型配置。具体清单与来源设计见 `docs/dzmm-public-catalog-plan.md`。

本次两个 Worker 项目的类型检查、ESLint、前端构建及部署 dry-run 通过；23 项角色/存储测试、11 项共享聊天/上下文测试、23 项真实隔离后端测试均通过。

### 2026-10-03 公开介绍扩容与发布

本批通过一般向分类的热门、最新、好评优先、本月热门四个真实页面视图继续采集，选择 33 条此前未导入的公开角色介绍，原文合计 24,292 个 JS UTF-16 代码单元。沿用已经确认的人设迁移授权，按实际角色 ID 去重，保留公开介绍原文、作者、来源页面和 SHA-256。采集证据为 `output/dzmm/lumivale-expansion-2026-10-03.json`，新增封面记录为 `output/dzmm/lumivale-expansion-covers-2026-10-03.json`；运行原文的独立校验证据路径为 `src/lib/dzmm-public-introductions-evidence.json`。

新增 33 条合并首次 8 条后，公开原文目录为 41 条、30,347 个 JS UTF-16 代码单元，加既有 10 条原创改写后公共目录为 51 条。原文继续完整写入 `description`，保留 `promptOrigin: "public-verbatim"`，未获得的独立 `personality`、`scenario`、`firstMessage` 保持空字符串；没有取得完整原始角色卡、隐藏系统提示词或世界书正文。四个视图有角色重叠，不能把视图记录数相加为全站数量。

本批已发布业务 Worker 版本 `ba895ae4-301b-4902-b790-adace79ec808` 和前端 Worker 版本 `f4fbc187-5345-4d0a-ba75-a3108739c4a8`。新增 33 张封面、累计 51 张，构建实测 56 个白名单资源及 HTML/JS/CSS 共 59 个普通文件。线上公开 JSON 与本地逐字节一致，既有 10 条原创样本的两份数据保持不变，全部 51 张线上封面字节与 SHA-256 一致；网关下的业务 Worker 与 D1 健康检查通过。

真实线上浏览器显示 51 个角色条目，51 张封面全部加载且无水平溢出；角色 `3691277` 的 3,739 个 JS UTF-16 代码单元介绍与采集原文逐字一致，作者与公开原文来源说明展示正常，“最新”页新增角色靠前。截图为 `output/dzmm/lumivale-expansion-production-detail-2026-10-03.png` 和 `output/dzmm/lumivale-expansion-production-latest-2026-10-03.png`。最终报告 `output/dzmm/lumivale-expansion-verification-2026-10-03.json` 的 8 项线上检查全部通过。

共享模块 34 项测试（角色 11、存储 12、聊天/上下文 11）、真实隔离 D1 后端 23 项测试、前端 Worker 18 项测试均通过；两个 Worker 工程的类型检查，以及 ESLint、前端构建与 dry-run 均通过。生产验证没有测试数据库写入，本批没有数据库迁移、私人数据修改或 LLM 配置变更。上述 2026-10-02 版本、测试与 7 项验证结果继续保留为首次 8 条导入的历史记录。

### 2026-10-03 页面探索与本轮复刻

本轮沿原站可见页面检查分类目录、个人主页、账户设置、作者作品页、论坛列表/详情/游客发帖权限、单聊会话/开场/设置、预设中心与新建预设、快速创建及专业角色编辑器。搜索的角色卡/综合/游戏/小说/动态/画图/对话分享入口和榜单的日榜/周榜/月榜/总榜四个周期也已观察。主要快照证据为 `output/dzmm/source-feature-exploration-2026-10-03.json`，分类图片来源观察为 `output/dzmm/source-category-assets-observed-2026-10-03.json`。记录原站入口不等于其全部业务已实现；逐页范围见 [功能覆盖记录](dzmm-feature-coverage.md)。

`src/lib/dzmm-authors.json` 保存 37 个已核验的真实原站作者 UUID，完整映射当前 51 个目录角色。作者按源站用户链接与角色 ID 关联，不以相同昵称合并身份。作品页只列本地已收录作品，不能推断为作者在原站的全部作品；原站头像、简介、粉丝、私信与打赏服务未整体迁入。21 个分类已保留原始 slug，其中 13 个安全原站分类封面已迁入；其余分类使用匹配的已收录角色封面或真实空态，尚未迁入全部 21 张原站分类封面。

角色 `3691277` 新增 4 张原站实际图库图片和 1,563 个 JS UTF-16 代码单元的页面渲染公开开场白。数据独立存入 `src/lib/dzmm-character-media.json`，公开副本为 `public/dzmm/public-character-media.json`，图片与开场均保留 SHA-256。运行时通过 `dzmm-character-media.ts` 叠加开场与图库，角色详情可切换四图并明确标注“原站页面渲染的公开开场白”。原先 41 条 `description` 原文及其独立校验数据保持不变；这段渲染文本不声明为原始角色卡 `first_mes` 或隐藏提示词，未取得原始完整卡或世界书正文。

论坛已使用真实 D1 主题/回复/投票/举报记录，注册用户与 Super 的权限由后端检查。论坛没有预置演示主题、虚假投票或评论，当前社区内容规模取决于本站用户实际发帖。原站游客点击发主题会进入登录流程，游客详情显示无法评论；本轮没有登录正式原站账户核对编辑器内部，因此本站可用发帖表单仍有独立设计范围。专业角色编辑器已观察核心身份、开场对话、世界书、声优设置与预览发布入口，该探索批次仅实现基础编辑；后续本轮已补入专业步骤、世界书编辑/触发和角色投稿审核，声优仍未接入，详见角色创作与发布增量。

### 已观察的角色详情

公开详情页采用居中的约 1000 像素内容区：左侧为约 286 × 382 像素的竖版封面和热度，右侧显示标题、角色 ID、时间、作者、互动项、标签与粉色“开始对话”按钮。其下为全宽角色介绍和相关推荐。桌面参考截图为 `output/dzmm/source-detail-desktop.png`。

原站页面可见公开角色介绍和开场信息；本次未发现完整角色卡或隐藏人设的导出入口，角色页的“更多”菜单仅显示举报。研究版本保留公开名称、作者和已观察统计；首次发布的 8 条展示公开介绍原文，既有 10 条展示原创改写，2026-10-03 已扩容为 41 条公开原文，界面按来源明确区分。当前已实现按真实作者 UUID 跳转作品页和本站账户关注，并提供本站链接分享；这些操作不写回原站。粉丝数、打赏和分享次数没有复制为本站实时数字；私人角色、收藏和关注使用当前账户的业务数据。

### 已观察的单人聊天

桌面版左侧为约 320 像素会话列表，右侧顶部是模型选择和工具栏，正文为左对齐角色气泡，底部是单行可扩展输入框。原站模型菜单显示模型系列、积分价格和上下文权益；这些为原站展示名称，未验证其实际底层模型。研究版本显示服务端实际配置的模型，不复制未经验证的资费和权益。界面支持消息复制、快捷草稿和会话导出。参考截图为 `output/dzmm/source-chat-desktop.png`。

## 2026-10-03 角色创作与发布增量

新增独立创作者中心与快速/专业编辑器：身份、开场、世界书、声优说明和预览发布。自供角色支持系统指令、历史后指令、对话示例、最多 20 条初始 user/assistant 消息、备选开场、世界书条目、独立展示介绍、图库和建议回复。快速/专业切换保留已填写内容；保存写入当前账户 D1，试聊使用该版本的实际设定。声优页面明确展示尚未接入，AI 自动生成头像/角色没有模拟成功。

迁移 `characters.context_json` 保存扩展角色字段，共享 parser 同时处理 JSON 导入/导出、恢复、D1 读写和模型请求。展示介绍与建议回复是界面数据；系统指令、历史后指令、对话示例和当前触发的世界书条目进入聊天上下文，保留既有字符/UTF-8 预算。原有 51 条目录文本与来源不变，原站未公开字段依旧没有补造。

发布后端 `cloudflare/dzmm/src/publishing.ts` 与共享 `src/lib/dzmm-publishing.ts` 提供 `/v1/publishing` 契约。正式作者主动提交规范快照后进入 pending；Super 可批准或附理由退回；作者可撤回，作者/Super 可下架。批准版本使用独立 `published-UUID` ID；新版待审不改动旧 approved 版本，审核通过才替换，私人草稿随后编辑也不会自动改变公共卡。所有修改使用独立发布 version 防并发，浏览器绑定 accountId 防账号切换串写。空设定/无 AI 主开场的角色可存私人草稿，但不能提交公开发布。

批准时，角色本人上传的 R2 封面/图库复制为独立发布资源。匿名公开目录与图片读取仅允许当前在线的 approved 版本；原 private/media 路径保持私有，审核预览仅作者/Super 可见。原私人图片删除后，已批准副本及其受保护审核预览仍可用；下架和新版本替换后旧公开入口失效。下架同时撤回待审更新，防止过期批准重新上架。私人聊天与凭据不会随角色公开，投稿不能伪造原站来源或发布身份。

本轮已应用生产迁移 `0005_character_context.sql` 与 `0006_character_publishing.sql`，前端版本 `d4b26ccd-4531-4912-b86d-d2e26becf575`、后端版本 `d0789721-60f4-4278-a380-cdee02518a89`。**118 项自动测试通过：48 项共享模块/聊天路由、52 项真实本地 Worker/D1/R2 后端、18 项前端 Worker**；其中 12 项发布测试包含并发、归属、来源/身份防冒充、跨账户写入拒绝、发布完成度、已批准角色收藏/会话及独立图片副本。生产 [API smoke](../output/dzmm/studio-production-api-smoke-2026-10-03.json) 的匿名目录、未登录审核拒绝、Super 登录、本人投稿列表与审核队列 5 项检查通过。

[studio-replica-verification-2026-10-03.json](../output/dzmm/studio-replica-verification-2026-10-03.json) 记录 13 项生产浏览器检查通过：首次保存保持步骤、身份/高级指令/示例/世界书/多条初始消息/备选开场/建议回复完整刷新回读、未保存退出确认、预览与正式账户投稿门槛、试聊开场角色顺序及建议回复填入输入框。721px 视口没有横向溢出或破图。临时私人角色和会话已删除并确认同步，没有创建生产公开投稿；完整发布状态与图片隔离检查使用临时本地 D1/R2。本轮浏览器没有发送模型计费请求，实际上下文组成由自动测试验证。

本轮尚未把原站公开预设市场、Apex 专用编辑、声优、支付或账号恢复接通，也不声明覆盖原站全部世界书规则。完整功能边界见 [覆盖表](dzmm-feature-coverage.md)。下方 99 项结果和旧版本属于上一轮界面探索批次。

## 2026-10-03 额外功能页、任务中心与安装页

[source-extra-pages-2026-10-03.json](../output/dzmm/source-extra-pages-2026-10-03.json) 保存本轮新增的 10 个原站 UI 状态：全站导航、21 项任务中心、App 下载页、悬赏公开布局及“我的任务”“我发布的”空态、绘图创建控件、小说目录，以及社区公约/广告合作提纲。探索没有在原站领取奖励、执行生成或导入悬赏/小说故事正文。悬赏的领取/挑战流程、小说阅读创作与图像生成仍未完整实现。

任务中心目前实现六项本站可验证任务：每日签到 5 Credit、首次持久化用户消息 5 Credit、至少一个角色审核通过并上架 20 Credit、关注五位不同作者 5 Credit、填写非空个人介绍 5 Credit、拥有至少一条未删除论坛回复 5 Credit。进度读取与领取条件均查询当前账户 D1，插入账本时再次校验；`(user_id, task_id, period)` 唯一键防止并发或重复奖励。注册账户领取必须绑定 `accountId`，游客只能读取本人进度，转正后保留原有真实记录和进度。本站六项不等同于原站完整 21 项任务。

每日签到以 UTC 日期分周期，UTC 00:00（北京时间 08:00）重置；统一 Credit 奖励到账后长期有效。删除记录或下架角色不会重置领取资格，邀请、任务与充值共享同一聊天余额。

安装页 [InstallApp](../src/components/dzmm/install-app.tsx) 提供 iPhone/iPad、Android、电脑指引，仅在收到浏览器真实安装事件时显示安装提示。已发布 `/dzmm/manifest.webmanifest` 及 192/512 PNG 应用图标，支持浏览器应用独立窗口入口；没有原生 APK 或应用商店安装包。角色和云端会话仍需联网，安装后的浏览器登录隔离由同一邮箱账户重新登录恢复云端记录。

生产增量迁移 `0007_task_claims.sql` 已应用。最新业务后端版本为 `d768cfe1-62e7-4c40-b81c-874a97620dc7`，前端为 `c10865b6-70e0-4cad-8d7b-2db7132476f4`。本轮 **61/61 项真实本地 Worker/D1/R2 集成测试通过**，含九项新增任务测试，覆盖任务条件、账户绑定、伪造输入拒绝、20 次并发仅一笔奖励、UTC 旧日后可领取新日、到期余额、隔离及游客转正；原有 52 项后端用例继续通过。

生产 [任务/PWA API 报告](../output/dzmm/extra-pages-production-api-2026-10-03.json) **6/6 项检查通过**：临时 Super 登录、读取六项真实任务、匿名读取 `401`、manifest、192/512 图标。核对没有写入或领取生产任务奖励，临时登录会话已撤销。该报告只说明线上接口和 PWA 资源，不代替所有设备的安装验收。

[extra-pages-replica-verification-2026-10-03.json](../output/dzmm/extra-pages-replica-verification-2026-10-03.json) 的生产浏览器 **8/8 项通过**：六项真实游客任务、刷新保持服务端账本、游客领取进入注册且记录保留、安装指引/manifest、iOS/Android/电脑平台切换和键盘操作，以及 742px 布局无横向溢出或破图。内置浏览器未提供原生安装提示，因此本次验证手工安装指引和资源，不代表手机或电脑系统已完成安装；没有领取生产任务奖励。

新域名 `xumengchat.top` 已付款注册，到期 **2027-10-03**，裸域已绑定现有 `dzmm-web` Production。同一账户的 Cloudflare Free zone 已激活，Universal 证书 **Active**；HTTP `301` 保留原路径和查询参数跳到 HTTPS。首次 NS 更新后的 Pending/HTTPS 失败属于历史等待过程，当前已完成新入口验收。此前 Porkbun 一年购物车显示的 **1.63 USD** 总价、**4.63 USD** 续费仍作为购买前报价保留，不改写价格研究或订单输出。

[custom-domain-api-verification-2026-10-03.json](../output/dzmm/custom-domain-api-verification-2026-10-03.json) 的 **19/19 项 API 检查通过**，含 HTTPS 健康、页面/JS/CSS/图标/封面、同源 manifest、外源 `403`、匿名任务 `401`、Secure host-only Cookie，以及旧/新来源登录同一 Super 账户后 state 哈希与 version 一致。两个临时登录会话已撤销，本轮没有私人业务写入、任务领取、私人媒体读取或付费模型请求。

[custom-domain-binding-2026-10-03.json](../output/dzmm/custom-domain-binding-2026-10-03.json) 记录新域名浏览器 **6/6 项通过**：任务六项、安装页、创作入口、51 张角色卡与 52 张页面图片全部加载、同源 manifest，以及 1280px 视口无溢出。当前仅裸域，`www` 尚未配置，旧 `workers.dev` 继续提供访问；现有 D1/R2 与代码版本沿用，没有为绑定重新部署代码。完整接入说明见 [自定义域名记录](dzmm-custom-domain.md)。此前批次的版本、测试和浏览器记录继续保留为各自历史证据；本站仍是部分复刻，PWA 指引验收不代表设备系统已经完成安装。

## 模型配置

`GET /api/dzmm/chat` 返回配置状态和模型名称；`POST /api/dzmm/chat` 返回 UTF-8 文本流。线上密钥来自前端 Worker 的 `DZMM_API_KEY` Secret，聊天通过 OpenRouter 的 OpenAI 兼容接口执行。当前三个模式均为 `x-ai/grok-4.6`；可通过 Worker 的 `DZMM_FAST_MODEL`、`DZMM_BALANCED_MODEL`、`DZMM_STORY_MODEL` 分别覆盖。线上 POST 需有效账户会话，未登录返回 `401`。

本地 Next.js 默认复用已有的 `OPENROUTER_API_KEY`、`OPENROUTER_BASE_URL` 和 `OPENROUTER_MODEL`，也可用以下环境变量独立配置；这些本地值不会自动成为线上 Worker 的配置：

```dotenv
DZMM_API_KEY=your-provider-key
DZMM_BASE_URL=https://openrouter.ai/api/v1
DZMM_MODEL=your-model-id
# 可选：三个模式未单独设置时使用同一个默认模型
DZMM_FAST_MODEL=your-fast-model-id
DZMM_BALANCED_MODEL=your-balanced-model-id
DZMM_STORY_MODEL=your-story-model-id
```

更新本地环境变量后需重启开发服务；更新 Worker 明文模型配置后需重新发布，密钥使用 Wrangler Secret 更新。API 使用 OpenAI 兼容的 `/chat/completions` 与 SSE 协议；模型服务失败会返回真实错误，不生成假回复。当前公开站已有请求频率限制，聊天按统一 Credit 余额和服务端计费策略扣费。

## 同步、备份与上下文

当前账户（包括游客）的业务数据以服务器为准。浏览器按 `accountId` 分离备份和恢复记录；旧 `dzmm-research-v1` 数据保留迁移备份，仅用于旧版本迁移和恢复，不再作为所有账户共用的唯一数据源。只有首次未初始化的游客账户会自动尝试旧数据迁移。

UI 在更改后等待 800 ms，再串行提交状态；模型回复流式生成期间暂停云端提交，完成或停止后再同步。遇到 `409` 时暂停覆盖并提示显式加载云端版本；失败时保留当前账户的本地恢复副本。浏览器存储不可用会显示导出提醒，避免把未保存的内容误认为已经持久化。账户切换时同时校验服务器返回的用户 ID 和写入的 `accountId`。

恢复备份逐条校验角色与会话，坏记录不会丢弃其他有效数据。会话导出包含角色和完整消息；个人页可导出当前账户的备份，也可恢复该账户的本地恢复副本。

模型每次最多携带最近 40 条消息，过长时按 80,000 字符和 180,000 UTF-8 字节预算移除最早的上下文，同时保留最新用户输入。较早消息仍保留在服务器会话和备份中。当前没有长期记忆摘要或向量检索，可以在预设中补充故事进度。单次回复超过 12,000 字符时会保留有效部分并终止，以免超长消息阻止后续对话。

## 页面设计依据

视觉：按原站观察结果使用深浅两种画布、粉色强调色、紧凑的图像网格和小字号。

内容：角色广场 → 角色详情 → 单人聊天；个人页承载账户、自定义角色和记录设置。

交互：角色列表依次出现；封面悬停轻微放大；详情页短距离进入，模型菜单展开。减少动态效果的系统偏好会关闭这些动画。

## 上一轮界面探索验证与早期记录

本轮最终发布的前端版本为 `a4238908-0335-4eda-b4f4-06874675ab78`，业务后端版本为 `50afd219-e3f2-477b-8f3e-88846d82ff26`。[feature-replica-verification-2026-10-03.json](../output/dzmm/feature-replica-verification-2026-10-03.json) 的 9 项检查全部通过：公开 JSON/客户端构建一致，41 条原文哈希保持，10 条原创样本不变，37 个真实作者完整映射 51 角色，全部 68 张线上角色/图库/分类图片逐字节匹配，公开渲染开场来源一致，后端/D1/模型配置健康，Super 权限与会话验证 9 项通过，及本轮 99 项自动测试通过。线上资源核对使用只读检查，没有创建测试论坛帖子；本轮已授权的生产变更为增量数据库迁移与 Super 账户创建/赋权。浏览器检查单独记录在 [feature-replica-browser-verification-2026-10-03.json](../output/dzmm/feature-replica-browser-verification-2026-10-03.json)，覆盖分类/作者/搜索/四图详情/论坛空态/设置/预设/单聊设置及 1280px 布局。报告的 `fullSiteCoverage` 为 `false`，不声明全站完成。

2026-10-03 上一轮界面探索通过 **99 项自动测试：38 项真实本地 D1/R2 业务后端测试、43 项共享模块/聊天路由测试、18 项前端 Worker 测试**。新增覆盖论坛写入与归属/Super 权限、举报处理、改密/会话撤销、扩展偏好、作者 UUID 不误合并、上海日历筛选边界，公开图库/开场来源与原文不变，以及可配置回复 tokens 与 UTF-8 上下文预算。此总数是自动测试结果，不等同于每个原站入口均已完成生产端到端验证；下列早期批次结果保留为各自历史证据。

初次部署时，原 DZMM 模块的 38 项自动测试、Cloudflare 后端的 22 项集成测试，以及独立前端网关的 18 项测试通过。后端测试运行真实 Wrangler 本地 Worker 与独立 D1/R2 测试存储，覆盖账户升级、持久化、归属校验、增量 CRUD、并发版本冲突和跨标签页账号切换保护；不重置生产数据库或日常开发数据。这些历史测试记录不替代本次 8 条公开介绍导入的发布验证。

前端网关测试覆盖同源检查、Cookie 和边缘 IP 转发、私人封面和安全头、请求大小、版本冲突转发、会话校验、双限流、密钥脱敏、SSE/中文分块、截断和超长回复，以及取消生成。真实本地双 Worker 联调使用临时 D1/R2，已通过页面、账户、业务记录和跨账户封面隔离流程；模型协议测试使用模拟上游。客户端与 Worker 类型检查、ESLint 和部署 dry-run 通过。

初次部署时，独立线上前端的验证脚本已通过 13 项检查：HTML 与 Logo、模型配置状态、未登录聊天 `401`、外源变更 `403`、未知接口 JSON `404`、安全游客 Cookie、R2 字节与安全头及归属隔离、D1 保存与刷新及 `409`、游客升级保留 ID、另一客户端登录恢复资料、非法聊天输入 `400`，以及退出登录。报告位于 `output/dzmm/frontend-cloudflare-verification.json`。真实浏览器登录独立测试账户后已恢复 1 个角色和 1 项收藏，并显示私人 R2 封面。该结果验证独立站的新账户流程，原本地游客仍需本人先注册升级。

初次部署的线上真实浏览器已收到 Worker 调用 `x-ai/grok-4.6` 生成的 70 字符回复；从 D1 重新读取和刷新浏览器会话时，开场、用户输入和模型回复共 3 条消息均完整保留。浏览器资料页与聊天截图分别为 `output/dzmm/frontend-cloudflare-profile.png`、`output/dzmm/frontend-cloudflare-chat.png`。当时角色广场的 11 个图片元素全部加载，未发现破图或水平溢出，截图为 `output/dzmm/frontend-cloudflare-characters.png`。线上停止生成尚未单独验证，本地和接口模拟中的取消检查已通过。

最终线上报告含 16 项通过记录，`cleanupCompleted` 为 `true`：本次 2 个测试用户及其 D1 记录已清除，并确认相关用户剩余数量为 0；测试 R2 对象由所有者删除返回 `200`，之后读取返回 `404`；临时测试凭据文件已移除，浏览器已退出测试账户并回到普通游客。原有账户数据和 R2 对象继续保留。

线上检查脚本可在 `cloudflare/dzmm-web` 中运行 `npm run verify:production -- https://dzmm-web.850587960.workers.dev`。它会创建独立测试账户、角色记录和图片，并暂存测试凭据供浏览器验证。完成检查后执行 `npm run verify:cleanup`，清理仅限该报告列出的测试账户和图片；清理命令可重复运行。

已实测收藏、刷新恢复、角色创建、角色 JSON 导出后重新导入、真实模型回复和移动端停止生成。后续核对了独立详情的直接链接、模型菜单、消息复制、手机聊天工具栏与历史恢复；桌面和手机尺寸下均检查了布局与封面加载。线上部署后已确认原游客记录迁移和 UI 同步。

新增模块与 Worker 的验证命令：

```sh
npx tsc --project output/dzmm/tsconfig.json
npx eslint src/app/dzmm src/app/api/dzmm src/components/dzmm src/lib/dzmm-characters.ts src/lib/dzmm-chat.ts src/lib/dzmm-context.ts src/lib/dzmm-storage.ts
npx tsx --test src/lib/dzmm-*.test.mts src/app/api/dzmm/chat/route.test.mts
npm --prefix cloudflare/dzmm run check
npm --prefix cloudflare/dzmm test
npm --prefix cloudflare/dzmm-web run check
npm --prefix cloudflare/dzmm-web run test:web
npm --prefix cloudflare/dzmm-web run deploy:dry-run
```

流式接口的模拟测试覆盖 SSE/UTF-8 分块、错误脱敏、空回复、请求大小限制、提前中断与取消。上述结果分别验证界面研究模块和独立 Worker 工程。线上 R2 上传、下载、跨账户隔离、上传地址写入 D1、登录后的浏览器封面显示，以及所有者删除后的 `404` 均已通过真实验证；页面上传按钮操作仍需单独验证。
