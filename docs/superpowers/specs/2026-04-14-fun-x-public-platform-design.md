# Fun-X Public Platform Design

## Summary

Fun-X-Studio 的公共站点要从“工具首页”彻底转成“内容平台首页”。
首页不再承担解释产品的职责，而是直接承载内容分发。核心目标是让用户看到封面就想点，点进去就能玩，不需要先读说明。

这一轮聚焦三件事：

1. 公共站点重构为内容平台
2. `Play` 线升级为高密度小游戏封面流
3. 建立“小游戏创作 Skill 层 + 封面必填 + 后续 template/skill/prompt 创作入口”的基础规则

## Goals

- 首页按内容分区展示：`Play / 互动影游 / 纯视频`
- 公共内容页以封面和标题为主，弱化冗余说明
- `Play` 成为一个由很多小游戏组成的统一大厅，而不是一堆散详情页
- 每个小游戏必须有封面，没封面不上公共流
- 首页和 `Play` 页加入 `排行榜` 与 `最近游玩`
- 创作侧明确后续方向：`template + skill + prompt`

## Non-Goals

- 这轮不做真实后端排行榜
- 这轮不做账号驱动的社交系统
- 这轮不做完整的小游戏模板编辑器
- 这轮不做真实的云发布链路

## Product Surface Split

产品继续保持两套表面：

- 公共平台
  - 面向玩家
  - 首页、内容流、详情页、游玩页
- 创作后台
  - 面向创作者
  - 项目库、编辑器、Agent、模板、导出

公共平台职责：
- 找内容
- 看封面
- 直接玩

创作后台职责：
- 做内容
- 管项目
- 用 skill / 模板 / prompt 创作

## Public Platform Information Architecture

### Homepage `/`

首页改为内容首页，不再是产品介绍页。

模块顺序：

1. 顶部导航
2. `最近游玩`
3. `排行榜`
4. `Play`
5. `互动影游`
6. `纯视频`

规则：
- 首页每一块都以封面流为主
- 默认只展示封面和标题
- 说明文字只保留分区标题，不做段落说明
- 首页不再展示大量品牌文案

### Play `/play`

`Play` 是小游戏大厅。

模块：
- 分区标题
- 排行榜
- 最近游玩
- 高密度封面流

规则：
- 卡片优先展示封面
- 标题短、清楚
- 不堆叠大量 tag / 摘要
- 点击后直接进入小游戏运行页

### Detail `/play/[slug]`

小游戏详情页首屏直接进入运行区。

结构：
- 顶部最小导航
- 运行区
- 次级信息区
- 继续浏览

规则：
- 不先展示介绍
- 不让说明抢掉首屏
- 首屏应当立即可玩

## Content Model Changes

### PublicContentEntry

公共内容模型需要提高对封面的要求。

```ts
type PublicContentEntry = {
  id: string;
  slug: string;
  type: "play" | "film" | "video";
  title: string;
  subtitle: string;
  summary: string;
  coverImageUrl: string;
  thumbnailImageUrl?: string;
  featured: boolean;
  status: "published" | "coming-soon";
  updatedAt: string;
  durationLabel?: string;
  primaryActionLabel: string;
  rankScore?: number;
  recentPlayAt?: string;
};
```

规则：
- `coverImageUrl` 为公共小游戏必填
- `play` 类型没有封面时，不允许出现在首页和 `/play`

## Play Runtime Architecture

`Play` 线继续采用统一小游戏宿主：

- `MiniGameRegistry`
- `MiniGameHost`
- `games/*`

要求：
- 每个小游戏必须有独立 slug
- `PublicContentEntry.slug` 和 `MiniGameRegistry.slug` 一一对应
- 每个小游戏都必须同时交付：
  - 游戏组件
  - 封面

## Cover System

封面不是附加资源，而是发布前置条件。

规则：
- 每个小游戏都必须有封面
- 封面主打“玩法一眼懂”
- 小图可读性优先
- 不使用廉价紫色渐变做主视觉
- 封面只保留一个主主体和一个短标题

封面创作统一由 `funx-cover-director` Skill 约束。

## Ranking and Recent Play

### Leaderboard

这轮先做静态或本地榜单层。

榜单类型：
- 今日热门
- 本周热门
- 新上线

数据来源先允许是静态 mock 数据，后续再替换成真实事件数据。

### Recent Play

最近游玩采用浏览器本地缓存。

规则：
- 用户打开过的小游戏进入最近游玩
- 最近游玩只在公共平台使用，不污染创作后台
- 最多保留固定数量，例如 8 到 12 条

## Creator Skill Layer

小游戏创作先不直接依赖自由 prompt，而是通过 Skill 层组织。

当前本地 Skill：
- `funx-instant-arcade`
- `funx-viral-puzzle`
- `funx-meta-retention`
- `funx-social-challenge`
- `funx-browser-inventor`
- `funx-cover-director`

后续创作入口模型：

```ts
template + skill + prompt
```

含义：
- `template`
  - 提供起始玩法结构或 UI 骨架
- `skill`
  - 提供创作人格和方法论
- `prompt`
  - 提供题材、主题、视觉与细节要求

## UI Principles

- 参考 4399 的封面流结构
- 参考小红书的干净封面审美
- 文字说明弱化
- 视觉密度强化
- 公共平台首页不再是 SaaS landing page
- 背景克制，内容优先

## Files Likely Affected

- `src/app/page.tsx`
- `src/app/page.module.css`
- `src/app/play/page.tsx`
- `src/components/public/catalog-page.tsx`
- `src/components/public/catalog-page.module.css`
- `src/components/public/content-card.tsx`
- `src/components/public/content-card.module.css`
- `src/lib/public-catalog.ts`
- `src/lib/public-recent-play.ts` new
- `src/lib/public-leaderboard.ts` new
- `ARCHITECTURE.md`
- `docs/game-creator-skills.md`

## Risks

1. 封面资产缺失
- 如果没有封面，`Play` 内容密度上来后会显得很空

2. 文字削减过头
- 如果完全不保留任何辅助信息，分区间可能会失去辨识度

3. 排行榜数据源不稳定
- 第一版必须允许本地 mock，不依赖服务端

4. 创作 Skill 层只停留在文档
- 下一轮需要真正把 skill 接进创作流，而不是只写规范

## Acceptance Criteria

- 首页以内容流而不是解释型文案为主
- `Play` 页展示高密度小游戏封面流
- `Play` 内容具备排行榜和最近游玩模块
- 每个小游戏有封面字段和可展示封面
- `ARCHITECTURE.md` 和 `docs/game-creator-skills.md` 同步反映这一结构
