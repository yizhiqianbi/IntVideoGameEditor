# Fun-X-Studio Dual Surface UI Redesign

## Summary

当前仓库最严重的问题不是“功能不够”，而是**公共平台和创作后台共用了同一套暗色工具风 UI**。  
结果是：

- 公共站点不像游戏平台，缺少内容魅力和封面主导感
- 创作后台不像高质量工作台，缺少秩序、专注和专业感
- 整体还有明显的“廉价 AI 渐变 + 面板堆叠”残留

这轮重构不做局部美化，而是把产品彻底拆成两套视觉表面：

1. `Public Platform`
   - 内容平台
   - 目标参考：4399 的内容货架结构 + 小红书式干净封面感
   - 关键词：封面优先、弱文案、强密度、直接进入内容

2. `Creator Studio`
   - 创作工作台
   - 目标参考：Google AI Studio 的 build 工作台逻辑
   - 关键词：工作区优先、步骤清晰、低噪声、强预览、少装饰

这两套表面只共享品牌和最基础 token，不再共享整套视觉语气。

## Problems To Fix

### 1. 公共平台仍然带着工具后台味

- 首页、`/play`、`/film`、`/video`、详情页都仍然偏面板化
- 热榜、搜索、内容卡、导航都长得太像工具组件
- 封面有了，但页面还不是“封面主导”

### 2. 创作后台不够像工作台

- `Play Agent Studio` 还是三栏表单感
- 缺少一个明确的主工作区
- 缺少“左侧输入、右侧生成、底部或中央预览”的创作秩序
- 更像配置页，不像 build 工作流

### 3. 视觉语言不高级

- 紫青渐变、发光、玻璃残留会直接拉低质感
- 表面层级不清楚，导致所有模块都像同一层卡片
- 没有建立“背景让位于内容、组件让位于任务”的秩序

## Design Principles

### Public Platform

#### 1. Cover First

- 页面主要靠封面说话，不靠解释说话
- 卡片主信息只保留：
  - 封面
  - 标题
- 副标题、摘要、标签全部降级

#### 2. Shelf Before Story

- 首页不是介绍产品，而是先给内容
- 用户打开后应立即看到：
  - 热门内容
  - `Play / 互动影游 / 视频` 三条货架
- 所有说明性文字都必须压缩

#### 3. Clean Dark, Not Fancy Dark

- 深色可以保留，但必须“稳”
- 不再使用紫青大渐变作为主背景
- 背景只承担衬托内容，不承担视觉主角

#### 4. Density Matters

- 参考 4399 的高密度货架
- 卡片更紧凑
- 首屏显示更多内容
- 热榜和热门区都要压缩

### Creator Studio

#### 1. Workspace First

- 页面中心应该是“正在做的工作”
- 表单、配置、辅助说明必须让位于工作区

#### 2. One Dominant Area

- 每个创作页必须有一个主区域
- 对 `Play Agent Studio` 来说，主区域应是：
  - 当前任务输入与产物预览
  - 而不是三个并列面板

#### 3. Low Noise, High Trust

- 少颜色
- 少无意义边框
- 少重复按钮
- 少大块说明文案
- 强调生成结果、计划、文件结构和预览

#### 4. Step Visibility

- 用户需要明显知道自己现在处于哪一步：
  - 选模板
  - 选 skill
  - 写 prompt
  - 生成 plan
  - 运行 agent
  - 应用到项目

## Surface-Level Redesign

## A. Public Platform Redesign

### A1. Top Navigation

目标：
- 更轻
- 更内容平台
- 更少“后台感”

调整：
- logo 左侧保留，但更克制
- 中间导航保留：
  - `Play`
  - `互动影游`
  - `视频`
  - `创作后台`
- 右侧按钮不再过于白亮抢眼
- 整个导航高度压薄，背景更接近纯净深色条

### A2. Homepage `/`

目标：
- 首页直接变成内容首页
- 不再像产品介绍页

结构：
1. 紧凑顶部导航
2. 单行热区
   - `热榜`
   - `热门内容`
   - 全部压成一条更扁的模块
3. 三条主货架
   - `Play`
   - `互动影游`
   - `视频`
4. 轻量全站搜索

设计规则：
- 热区高度继续下降
- 三条货架尽量更早进入首屏
- 所有卡片视觉统一
- 只保留“全部”这种轻动作，不要二级说明

### A3. Lane Pages

适用于：
- `/play`
- `/film`
- `/video`

目标：
- 三者统一成同一套内容货架页面
- 不再做出三种不同风格

结构：
1. lane 标题
2. lane 搜索
3. 统一封面网格
4. 侧栏只保留轻量榜单与必要模块

规则：
- `/play` 可以额外保留最近游玩
- 但整体布局必须和 `/film`、`/video` 属于同一视觉家族

### A4. Detail Pages

目标：
- 点进去直接开始玩 / 看
- 不是信息页

规则：
- 首屏主区域必须是运行区
- 返回按钮弱化
- “继续浏览”区域更克制，放在下方
- metadata 全部降级，不在首屏抢注意力

## B. Creator Studio Redesign

### B1. Projects `/projects`

目标：
- 更像作品管理入口
- 少说明，多项目

调整：
- 减少 hero 面板感
- 提高项目卡封面感
- 强化“最近项目 / 打开项目 / 新建项目”
- 弱化多余的说明、统计和空洞 badge

### B2. Play Agent Studio `/pencil-studio-vid/play-agent`

目标：
- 从“三栏表单页”重构成真正的 build 工作台
- 参考 Google AI Studio build 模式，但不硬搬

建议结构：

1. 顶部极简栏
   - 项目名
   - 返回入口
   - 当前 provider / model 状态

2. 左侧 `Composer`
   - 模板
   - skills
   - prompt
   - 操作按钮

3. 中央 `Work Surface`
   - plan
   - run status
   - 产物文件
   - cover prompt
   - preview 预留

4. 右侧 `Project Context`
   - 当前项目里的 Play drafts
   - 最近一次应用状态

关键变化：
- 中央永远是主区域
- 左右两侧是辅助
- 视觉上不能三列等重
- 必须建立明显的“工作正在发生在这里”的感觉

### B3. Interactive Film Editor `/pencil-studio-vid`

这轮只做视觉收口，不推翻交互。

原则：
- 压掉旧的紫青强调色残留
- 减少“每一块都是独立卡片”的感觉
- 让画布更像主角
- 让侧栏更像工具，不像彩色面板

## Visual System Changes

### Remove

- 大面积紫青渐变
- 发光型按钮
- 玻璃感面板
- 过多边框强调
- 高亮抢戏的 CTA 白按钮

### Introduce

- 更克制的深色底
- 更暖或更中性的浅色文字层级
- 统一的卡片圆角系统
- 更轻的阴影
- 更薄的导航
- 更强的留白纪律
- 内容封面作为主视觉，而不是背景特效

### Accent Strategy

- 公共平台：
  - 几乎不依赖强调色
  - 主要靠封面色彩承担活力
- 创作后台：
  - 保留一个冷静、克制的功能强调色
  - 不再混用两到三种 AI 风 accent

## Implementation Sequence

这轮不应该全站一起乱改。顺序必须固定：

### Phase 1

Public Platform 全面重构：
- `/`
- `/play`
- `/film`
- `/video`
- detail pages
- top nav
- 公共卡片、搜索、热榜模块

### Phase 2

Play Agent Studio 重构：
- `/pencil-studio-vid/play-agent`
- build 模式工作台化

### Phase 3

Projects 页面重构：
- `/projects`

### Phase 4

互动影游编辑器视觉收口：
- `/pencil-studio-vid`

## Success Criteria

### Public Platform

- 首页第一眼像游戏平台，不像 SaaS
- 封面和标题成为绝对主角
- 首屏出现更多内容
- 用户不需要读很多字就能开始点

### Creator Studio

- Play Agent Studio 看起来像工作台，不像配置后台
- 页面有明确的主工作区
- 输入、产物、项目上下文的层级清楚

### Overall

- 不再有廉价 AI 渐变感
- 不再有“所有页面一个味道”的问题
- Public Platform 和 Creator Studio 明显属于同一产品、不同表面

## Non-Goals

这轮不做：
- 路由重构
- 数据模型重构
- Play Agent provider 逻辑重构
- 发布链路重构

这轮只做：
- 前端表面重构
- 视觉系统重建
- 组件层级重排

## Files Most Likely To Change

Public Platform:
- `src/app/page.tsx`
- `src/app/page.module.css`
- `src/app/play/page.tsx`
- `src/app/film/page.tsx`
- `src/app/video/page.tsx`
- `src/components/top-nav.tsx`
- `src/components/top-nav.module.css`
- `src/components/public/content-card.tsx`
- `src/components/public/content-card.module.css`
- `src/components/public/catalog-page.tsx`
- `src/components/public/catalog-page.module.css`
- `src/components/public/detail-page.tsx`
- `src/components/public/detail-page.module.css`
- `src/components/public/public-search-panel.tsx`
- `src/components/public/public-search-panel.module.css`
- `src/components/public/leaderboard-panel.tsx`
- `src/components/public/leaderboard-panel.module.css`

Creator Studio:
- `src/app/projects/page.tsx`
- `src/app/projects/page.module.css`
- `src/components/studio/play-agent/play-agent-studio.tsx`
- `src/components/studio/play-agent/play-agent-studio.module.css`
- `src/components/editor/editor-shell.module.css`
- `src/app/globals.css`

