# Game Studio · 游戏创作间设计规范

**日期**：2026-04-18
**覆盖范围**：`/studio/games`、`/studio/games/agent`、`/studio/games/create/[type]`，以及顶栏入口联动

## Summary

现有 `/studio/games` 只是一个空壳列表页。用户找不到「从哪创建 H5 游戏」，因为：

1. 顶栏 **STUDIO** 指向的是旧的 `/projects`（视频编辑流）
2. 右上角 **进入创作后台** CTA 也指向 `/projects`
3. 新建的游戏创作间与顶栏完全脱节

这轮设计补齐三块：**入口导航** → **AI 雏形生成** → **3 栏可视化编辑器**，形成一条从零到发布的完整创作链。参考对象是 Loopit / Aippy / Google AI Studio 的 build 工作台。

## Problems To Fix

### 1. 入口完全不可发现

- 用户看到首页／游戏列表后，没有任何按钮能带他到游戏编辑器
- 只能靠手动打 `/studio/games` URL 才进得去

### 2. 编辑器不像编辑器

- 旧入口只有一个模板选择页，选完之后没有后续
- 缺少「可视化 + 所见即所得 + 参数微调」的工作流
- 缺少 AI agent 辅助

### 3. 自然语言 → 游戏雏形 的链路缺失

- AI agent 能力已经存在（见 `/pencil-studio-vid/play-agent`），但新公共 studio 路径上没接入
- 用户不知道可以用一句话生成游戏

## Design Principles

### 1. 两条路径，一个目的

用户创建游戏只有两个心智入口：**描述想法 → AI 出雏形** 或 **挑模板 → 手动搭**。都最终落到同一个编辑器工作台。

### 2. 编辑器 = 3 栏 IDE

- **左 · 聊天** — AI 接收自然语言指令，返回可点击的 patch 建议
- **中 · 预览** — 真实游戏雏形的实时渲染，支持 手机 / 平板 / 桌面 三种视口
- **右 · 参数** — 结构化表单（tabs: 基本信息、章节/关卡）

左改一句、右改一字、中间立即变化 —— 这是唯一的工作节奏。

### 3. 参考基准

| 维度 | 参考 |
|---|---|
| Prompt 驱动创作 | Loopit、Aippy |
| 3 栏工作台秩序 | Google AI Studio、Vercel v0 |
| 可视化预览反馈 | Figma、Framer |
| 游戏壳视觉 | Arcade H5、微信小游戏孵化器 |

## Information Architecture

```
/studio/games                       创作间首页（hub）
├─ ✨ AI 一句话生成          → /studio/games/agent
└─ 从模板开始 →              → /studio/games/create

/studio/games/agent                 Prompt-first 雏形生成
├─ 大 Prompt 输入框
├─ 6 个 Starter 卡片（点击自动填入）
└─ 3 步 How it works

/studio/games/create                模板选择
└─ 6 种类型卡片                → /studio/games/create/[type]

/studio/games/create/[type]         3 栏编辑器工作台
├─ Top bar：标题输入 · 类型 tag · 预览 / 存草稿 / 发布
├─ Left pane：AI 聊天 + 快捷 prompt
├─ Center pane：设备切换 + 实时预览
└─ Right pane：tabs（基本信息 · 章节）
```

### 顶栏联动

| 元素 | 旧 | 新 |
|---|---|---|
| `STUDIO / 后台` nav | `/projects` | `/studio/games` |
| 右上 CTA | `进入创作后台` → `/projects` | `创作游戏` → `/studio/games` |
| Studio 内 CTA | — | `✨ AI 生成游戏` → `/studio/games/agent` |

## Interaction Spec

### `/studio/games/agent` — Prompt 驱动

- **输入框**：最小高度 120px，placeholder 给一个具体示例
- **Generate 按钮**：输入非空才可点；点击后应进入 `/studio/games/create/[type]` 并携带雏形
- **Starter 卡片**：6 张，点击 **只填充 prompt 框**（不立即生成），让用户二次确认后再点生成
- **How it works**：3 步说明描述 → 生成 → 编辑

### `/studio/games/create/[type]` — 编辑器

#### Top bar
- 高度 56px
- 标题为 inline 可编辑 input（点即改）
- 类型 tag 橙色 pill，显示 `icon + 英文名`
- 右侧三按钮：`预览`（ghost）· `存草稿`（ghost）· `发布上线`（orange primary）

#### Left · 聊天
- 消息：agent 消息带 `A` 圆形头像（橙）、用户消息带 `你` 灰色头像
- Agent 消息底部可挂 `msgActions` 按钮，每个按钮附一个 `patch: Partial<GameConfig>`，点击立即 apply 到 config 并重绘预览
- 底部输入框：textarea + 发送按钮 `↑`；下方挂 4 个 quick-prompt 芯片（点击预填）
- 工作流逻辑：Agent 的建议 = **可点击的 commit**，不是聊天内容

#### Center · 预览
- 设备切换 3 档：`📱 手机 (380px)` · `平板 (560px)` · `🖥 桌面 (900px)`
- Reload 按钮强制 remount 预览（key++）
- 预览框：圆角 20px、深色边框、阴影
- 每种 gameType 挂一个独立的 Preview 组件：
  - `text-choice` → 章节轮播（CHAPTER 1/N、场景徽章、A/B 选项）
  - `click-reaction` → 圆形目标 + 分数/连击/目标 HUD
  - `memory` → 4×4 翻牌
  - 其他 → 通用占位（icon + 标题 + 说明）

#### Right · 参数
- Tabs：`基本信息` · `章节 (N)`
- `基本信息`：游戏名、简介、目标时长、通关分数
- `章节`：每章 card，含阶段、标题、场景提问、A/B 选项（文案 + 后果）
- `+ 添加章节`：虚线 dashed 描边按钮，点击 push 空章节
- 所有输入 on-change 立即 set state（`applyPatch` / `updateChapter` / `updateChoice`），preview 同步

### 实时同步契约

```
用户输入任意字段
  → state.config 更新
  → previewKey++
  → Preview 组件以新 key 重新 mount
  → 用户 100ms 内看到变化
```

## Visual Design

### 色彩与层级

- 编辑器主背景：`#0a0a0c`（比 `/play` 更深，强调工作态）
- pane 分隔线：`rgba(255,255,255,0.06)` 1px
- 预览背景：双 radial gradient（橙 + 蓝）+ `#0a0a0c`
- 强调色：`var(--color-accent)` 保持橙（与公共站一致）

### 字号与字体

| 元素 | 字号 | 字体 |
|---|---|---|
| Agent 页英文主标题 "Prompt" | 56–112px | Instrument Serif italic |
| Agent 页中文副标 "一句话做游戏" | 36–64px | Space Grotesk bold |
| Editor top bar 标题 input | 14px | sans-serif bold |
| Pane titles "AI 助手/实时预览/参数" | 11px uppercase + 0.18em letter-spacing | — |
| 预览内场景标题 | 28px | sans-serif bold |
| 预览内数字（分数/连击） | 26px | Instrument Serif italic |
| chapter card 序号 | 11px uppercase | — |

**核心规则**：功能区用 `Space Grotesk`，所有「数字」「章节号」「阶段」用 `Instrument Serif italic` 制造质感。

### 组件语言

- **pill（橙）** — 进行中状态：章节号、类型 tag
- **pill（ghost）** — 元信息：时长 `180s`、线索数
- **chunky button with offset shadow** — 所有选择类按钮（3px offset → hover 5px）
- **radial grid background** — 游戏预览舞台标识
- **dashed border** — 添加/占位类入口
- **pulseDot** — Agent 在线/运行指示器

### Responsive

- `> 1280px`：3 栏 320 / flex / 360
- `1280 ~ 960px`：3 栏 280 / flex / 320
- `< 960px`：1 栏纵向堆叠（chat → preview → params）

## State & Data

### `GameConfig` 结构

```ts
type GameConfig = {
  title: string;
  description: string;
  duration: number;         // 秒
  targetScore: number;
  chapters: Chapter[];
};

type Chapter = {
  age: string;
  title: string;
  prompt: string;
  choices: [Choice, Choice];
};

type Choice = {
  label: string;
  consequence: string;
};
```

### 后续接入点

1. **Agent 页 Generate 按钮** 当前为 stub — 后续接到 `lib/api/play-agent` 的 `generatePlayAgentPlan`
2. **Editor AI 聊天** 当前是 mock patch — 后续接 `runPlayAgent` 流式
3. **发布上线** 目前无逻辑 — 需要定义 draft → publish 的 state machine 与持久化表

## Non-Goals

- 不在此版处理登录 / 权限 / 多用户
- 不实现跨设备保存（当前 state 全部在内存）
- 不支持非文字选择类游戏的完整 runtime（physics / rhythm / puzzle 走通用占位）
- 不改 `/pencil-studio-vid/*` 老路径（保留历史兼容）

## Open Questions

- [ ] 发布流怎么绑定到 `public-catalog`？需要一个从 `GameConfig` → 游戏注册表条目的转换器
- [ ] Agent 应该返回完整替换 config 还是 JSON patch？后者更可解释、支持撤销
- [ ] 手机预览需不需要真实的 device frame（圆角、刘海）？当前只用边框，留待用户反馈
