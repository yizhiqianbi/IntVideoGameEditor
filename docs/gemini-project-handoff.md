# Fun-X-Studio 项目总览（给 Gemini）

这份文档是给外部模型或新接手开发者的上下文包。目标不是描述理想状态，而是准确描述**当前仓库已经实现了什么、没实现什么、关键入口在哪里、后续应该如何接手**。

配套架构文档：
- [/Users/pencil/Documents/IntVideoGameEditor/ARCHITECTURE.md](/Users/pencil/Documents/IntVideoGameEditor/ARCHITECTURE.md)

## 1. 项目一句话

`Fun-X-Studio` 是一个 **“公共游玩平台 + 创作后台”** 双表面的 Next.js 产品。

- 公共游玩平台：给玩家浏览、点开、游玩小游戏 / 互动影游 / 视频
- 创作后台：给创作者管理项目、编辑互动影游、调用 Agent 生成内容、导出项目和交付物

它不是纯工具站，也不是纯内容站，而是一个**本地优先、逐步走向平台化发布**的混合产品。

## 2. 当前产品表面

### 2.1 Public Platform

面向玩家。

核心路由：
- `/`
- `/play`
- `/film`
- `/video`
- `/play/[slug]`
- `/film/[slug]`
- `/video/[slug]`

定位：
- 首页是内容货架，不是营销页
- 视觉强调封面、标题、搜索、热榜、最近游玩
- 当前三条内容线：
  - `Play`
  - `互动影游`
  - `视频`

### 2.2 Creator Studio

面向创作者。

核心路由：
- `/projects`
- `/pencil-studio-vid`
- `/pencil-studio-vid/agent`
- `/pencil-studio-vid/play-agent`

定位：
- `/projects` 是项目库入口
- `/pencil-studio-vid` 是互动影游编辑器
- `/pencil-studio-vid/agent` 是剧情拆解与落图 Agent 工作台
- `/pencil-studio-vid/play-agent` 是 H5/小游戏创作 Agent 工作台

## 3. 当前已实现的主要能力

### 3.1 公共平台

已实现：
- 首页内容货架
- `Play / 互动影游 / 视频` 三条内容线
- `Play` 高密度封面流
- 首页与 `Play` 页面检索
- 热榜模块
- 最近游玩模块
- 详情页统一 runtime 舞台
- 统一全屏游玩 / 观看

当前内容组织是本地静态目录，不是数据库发布系统。

关键文件：
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/public-catalog.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/public-catalog.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/public/catalog-page.tsx](/Users/pencil/Documents/IntVideoGameEditor/src/components/public/catalog-page.tsx)
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/public/detail-page.tsx](/Users/pencil/Documents/IntVideoGameEditor/src/components/public/detail-page.tsx)
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/public/runtime-stage-shell.tsx](/Users/pencil/Documents/IntVideoGameEditor/src/components/public/runtime-stage-shell.tsx)

### 3.2 小游戏平台（Play）

已实现：
- 统一 `MiniGameHost`
- `registry` 注册式小游戏运行时
- 多个浏览器小游戏组件
- 每个小游戏要求对应封面资源
- 详情页点进去直接可玩，不先看长说明

关键文件：
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/public/minigames/registry.ts](/Users/pencil/Documents/IntVideoGameEditor/src/components/public/minigames/registry.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/public/minigames/minigame-host.tsx](/Users/pencil/Documents/IntVideoGameEditor/src/components/public/minigames/minigame-host.tsx)
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/public/minigames/games](/Users/pencil/Documents/IntVideoGameEditor/src/components/public/minigames/games)

当前已有代表性小游戏：
- `首富人生模拟器`
- `点击追踪`
- `记忆翻牌`
- `躲避快线`
- `信号序列`
- `货箱分拣`
- `真假判断`
- `路线规划`
- `节奏闸门`
- `港口连线`
- `密码破译`
- `猪外有猪`
- `三消急救`
- `瞬时开枪`
- `营地合成`
- `机关锁`
- `完美切线`

### 3.3 互动影游编辑器

已实现：
- 基于 `React Flow` 的剧情树编辑器
- 视频节点、连线、分支条件
- 角色卡与场景卡
- 参考卡固定在同一画布参考层
- 视频生成配置
- 视频结果预览与裁剪
- Agent 草案应用到画布
- 模板库
- 导出设置

关键文件：
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/editor/editor-shell.tsx](/Users/pencil/Documents/IntVideoGameEditor/src/components/editor/editor-shell.tsx)
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/editor/project.ts](/Users/pencil/Documents/IntVideoGameEditor/src/components/editor/project.ts)

### 3.4 项目系统

已实现：
- 本地项目库（浏览器本地）
- 自动保存
- 恢复草稿
- 项目包导入导出
- 全局素材与项目素材分层

当前主存储不是云端，而是本地 `IndexedDB`。

关键文件：
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/projects.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/projects.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/project-package.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/project-package.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/editor/editor-session.ts](/Users/pencil/Documents/IntVideoGameEditor/src/components/editor/editor-session.ts)

### 3.5 Agent 系统

当前仓库里有两套 Agent：

1. `剧情 Agent`
- 面向互动影游
- 负责故事拆解、角色预设、场景预设、镜头草案、分支和剧本
- 入口：`/pencil-studio-vid/agent`

关键文件：
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/agent-mode.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/agent-mode.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/agent-prompts.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/agent-prompts.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/app/api/agent](/Users/pencil/Documents/IntVideoGameEditor/src/app/api/agent)

2. `Play Agent Harness`
- 面向小游戏/H5 游戏创作
- 负责 `template + skill + prompt -> plan -> artifacts -> apply`
- 当前是 v1，可跑骨架
- 入口：`/pencil-studio-vid/play-agent`

关键文件：
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent](/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent)
- [/Users/pencil/Documents/IntVideoGameEditor/src/app/api/play-agent](/Users/pencil/Documents/IntVideoGameEditor/src/app/api/play-agent)
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/studio/play-agent/play-agent-studio.tsx](/Users/pencil/Documents/IntVideoGameEditor/src/components/studio/play-agent/play-agent-studio.tsx)

## 4. 技术栈

核心栈：
- Next.js 16.1.6
- React 19
- TypeScript
- React Flow (`@xyflow/react`)
- Prisma + PostgreSQL（账号/积分主链）
- NextAuth
- JSZip（项目包）

当前 `package.json` 说明：
- 构建命令：`npm run build`
- 开发命令：`npm run dev`

文件：
- [/Users/pencil/Documents/IntVideoGameEditor/package.json](/Users/pencil/Documents/IntVideoGameEditor/package.json)

## 5. 存储与数据层

### 5.1 浏览器本地

当前大量核心能力依赖浏览器本地存储：
- 项目库：`IndexedDB`
- 项目媒体：`IndexedDB`
- 恢复草稿：`IndexedDB`
- 全局素材：`IndexedDB`
- 模板库：`IndexedDB`
- Play Agent drafts：`localStorage`
- recent play：浏览器本地缓存

这意味着：
- 不登录也能工作
- 但跨设备同步目前不成立

### 5.2 账号与数据库

账号系统是**可选增强**：
- 优先 Prisma/PostgreSQL
- 数据库不可用时，回落到本地账号缓存

Prisma 当前只有一个核心模型：
- `User`

文件：
- [/Users/pencil/Documents/IntVideoGameEditor/prisma/schema.prisma](/Users/pencil/Documents/IntVideoGameEditor/prisma/schema.prisma)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/auth.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/auth.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/local-auth-cache.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/local-auth-cache.ts)

## 6. AI / 生成能力

### 6.1 视频生成

当前视频生成层是 provider-decoupled。

支持的 provider：
- `doubao`
- `minimax`
- `vidu`
- `kling`

关键文件：
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/video-generation.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/video-generation.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/video-generation-server.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/video-generation-server.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/app/api/video/generate/route.ts](/Users/pencil/Documents/IntVideoGameEditor/src/app/api/video/generate/route.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/app/api/video/status/route.ts](/Users/pencil/Documents/IntVideoGameEditor/src/app/api/video/status/route.ts)

### 6.2 生图

角色/场景生图当前主要走火山：
- `/api/image/generate`

关键文件：
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/image-generation.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/image-generation.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/app/api/image/generate/route.ts](/Users/pencil/Documents/IntVideoGameEditor/src/app/api/image/generate/route.ts)

### 6.3 Play Agent Provider

`Play Agent Harness` 当前支持三种 provider 路径：
- `mock`
- `glm-coding-plan`
- `openrouter`

关键文件：
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/provider.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/provider.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/mock-adapter.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/mock-adapter.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/glm-adapter.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/glm-adapter.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/openrouter-adapter.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/openrouter-adapter.ts)

当前真实状态：
- OpenRouter 已接入
- `deepseek/deepseek-v3.2` 已验证能走通 `plan` 路径
- `Play Agent` 仍然是 v1，未接入真正的 Web CLI / WebContainers

## 7. Play Agent Harness 当前状态

这个模块很重要，因为它是后续 “Agent + 游戏” 飞轮的核心。

### 当前已经实现

- session 创建
- template 列表
- skill 列表
- prompt 组合
- `plan`
- `run`
- `events`
- `artifacts`
- `apply`
- 项目本地 Play draft 保存

### 当前没有实现

- 真正的浏览器内代码终端（Web CLI）
- WebContainers
- 代码预览 bundle 执行沙箱
- 一键发布到公共 `Play`
- 真实模板市场
- 用户偏好反馈闭环

### 当前生成物形态

`run` 产物是一个 `PlayAgentArtifactBundle`，包含：
- plan
- files
- coverPrompt
- coverAssetUrl
- previewEntry

但当前 `apply` 只是写入项目本地的 Play draft，不会自动发布到 `/play`。

## 8. 创作者 Skill 层

小游戏创作不是纯 prompt，而是 `template + skill + prompt`。

当前本地已定义的游戏创作者 skill：
- `funx-instant-arcade`
- `funx-viral-puzzle`
- `funx-meta-retention`
- `funx-social-challenge`
- `funx-browser-inventor`
- `funx-cover-director`

文档：
- [/Users/pencil/Documents/IntVideoGameEditor/docs/game-creator-skills.md](/Users/pencil/Documents/IntVideoGameEditor/docs/game-creator-skills.md)

这些 skill 的职责是：
- gameplay 设计
- retention 设计
- social spread 设计
- cover 设计

## 9. API 一览

### 剧情 Agent
- `POST /api/agent/draft`
- `POST /api/agent/script`
- `POST /api/agent/test`

### 图片生成
- `POST /api/image/generate`

### 视频生成
- `POST /api/video/generate`
- `POST /api/video/status`

### Play Agent
- `POST /api/play-agent/sessions`
- `GET /api/play-agent/sessions/[id]`
- `POST /api/play-agent/sessions/[id]/plan`
- `POST /api/play-agent/sessions/[id]/run`
- `GET /api/play-agent/sessions/[id]/events`
- `GET /api/play-agent/sessions/[id]/artifacts`
- `POST /api/play-agent/sessions/[id]/apply`

### 账号 / 认证 / 辅助
- `POST /api/auth/register`
- `/api/auth/[...nextauth]`
- `GET /api/credits`
- `POST /api/export/media`

## 10. 当前最重要的未完成点

这些是 Gemini 最需要认清的，不然很容易误判项目成熟度。

### 10.1 公共平台还不是“真发布平台”

当前公共内容主要来自：
- 本地静态目录 `public-catalog`

不是来自：
- 数据库发布系统
- Studio 一键发布
- 用户上传内容后台

也就是说：
- 现在有公共平台壳和内容流
- 但还没有真正的“发布链路闭环”

### 10.2 Play Agent 还不是完整游戏生成器

当前是 v1 harness，不是完整的 codegen runtime。

缺少：
- 真实代码工作区
- 浏览器内终端
- 运行时 sandbox
- 自动把生成的游戏挂到 `/play`

### 10.3 README 基本没维护

仓库根目录 `README.md` 还是 Next.js 默认模板，不可信。

当前更可信的文档是：
- [/Users/pencil/Documents/IntVideoGameEditor/ARCHITECTURE.md](/Users/pencil/Documents/IntVideoGameEditor/ARCHITECTURE.md)
- [/Users/pencil/Documents/IntVideoGameEditor/docs/game-creator-skills.md](/Users/pencil/Documents/IntVideoGameEditor/docs/game-creator-skills.md)
- [/Users/pencil/Documents/IntVideoGameEditor/docs/superpowers/specs](/Users/pencil/Documents/IntVideoGameEditor/docs/superpowers/specs)
- [/Users/pencil/Documents/IntVideoGameEditor/docs/superpowers/plans](/Users/pencil/Documents/IntVideoGameEditor/docs/superpowers/plans)

## 11. 如果让 Gemini 接手，最适合的切入方向

### 方向 A：前端 UI 深度优化

目标：
- 参考 Google AI Studio build 模式
- 重做 Play Agent Studio 的前端信息架构和工作区体验

切入点：
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/studio/play-agent/play-agent-studio.tsx](/Users/pencil/Documents/IntVideoGameEditor/src/components/studio/play-agent/play-agent-studio.tsx)
- [/Users/pencil/Documents/IntVideoGameEditor/src/components/studio/play-agent/play-agent-studio.module.css](/Users/pencil/Documents/IntVideoGameEditor/src/components/studio/play-agent/play-agent-studio.module.css)

### 方向 B：补 Play Agent 的代码执行壳

目标：
- 接 `xterm.js + WebContainers`
- 真正形成浏览器内 H5 游戏创作工作台

切入点：
- `src/lib/play-agent/`
- `src/app/api/play-agent/`

### 方向 C：补 Studio -> Public 的发布链路

目标：
- 从项目或 Play draft 一键发布到公共 `Play`
- 把 `public-catalog` 从手写静态列表改成可发布实体

切入点：
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/public-catalog.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/public-catalog.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/projects.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/projects.ts)
- [/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/project-drafts.ts](/Users/pencil/Documents/IntVideoGameEditor/src/lib/play-agent/project-drafts.ts)

## 12. 给 Gemini 的一句建议

不要把这个仓库当成“单一的互动影视编辑器”来看。  
它现在实际上是一个**已经开始分化成平台形态的双系统产品**：

- 一边是公共游玩平台
- 一边是创作后台

而后续最关键的增长点，不是继续给互动影游编辑器加零碎功能，而是把：

`Play Agent Harness -> Play draft -> Public Play publishing`

这条链路真正闭环。
