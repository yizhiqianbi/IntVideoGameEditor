# 叙梦短剧「每集游玩点」执行文档

> 给 Cursor / Grok 的实现说明。先读完整文档，再按 **P0 → P1** 顺序做；不要顺手重构无关模块。

## 0. 当前状态

- 分支：`NSFW`
- 最近提交：`a526972e`
- 线上：后端 `ba22f517`，前端 `ad345a09`
- 已完成、不要回退：
  - 游戏功能已从 UI 移除
  - 视频「互动剧」tab 已移除，只剩 短剧 / 漫剧 / 推荐
  - 视频左右滑动拖进度已上线
  - 短剧「点击去玩」入口已上线
  - 分享卡、VIP 周卡、首单半价已上线
- 现有短剧数据源：`https://video.xumengchat.top/catalog.json`
  - 2,017 部短剧、5,889 集
  - 单集约 205–216 秒
- 现有相关代码：
  - `src/components/dzmm/video-channel.tsx`：播放器、底部「点击去玩」
  - `src/components/dzmm/tavern-app.tsx`：角色详情/开聊、官方卡
  - `src/lib/xumeng-video-character.ts`：当前按「整部剧」生成官方卡
  - `cloudflare/dzmm/src/video-characters.ts`：当前 `/v1/video-characters`
  - `cloudflare/dzmm-web/src/video-character.ts`：AI 生成卡 + 保存
  - `cloudflare/dzmm/src/aigen.ts`：TokenHub 生图/视频
  - `cloudflare/dzmm` 的 `env.AI`：Workers AI binding，可用于 Flux 生图
  - `MEDIA`：R2 binding，bucket `dzmm-media`
  - `DB`：D1 `dzmm-db`

## 1. 产品目标

每集短剧生成 **1 个关键女主游玩点**：

- 绑定：`drama_id + episode_id + start_ms/end_ms`
- 一张官方共享角色卡，所有观众看到同一张
- 一个播放入口：
  - 播放器右下角常驻「游玩」标签
  - 进度条上显示游玩点标记
  - 播到关键点时标签高亮
  - 点击打开角色卡弹层 →「和她玩」进入酒馆对话
- 每集只保留关键女主，不做配角、不做多结局

非目标：

- 不做实时生成
- 不在播放器里直接生成卡片
- 不恢复游戏功能
- 不把整段视频上传给模型

## 2. 总体流程

```text
catalog.json
  ↓
离线脚本：下载 mp4
  ↓
ffmpeg：40 张扫描帧（每 5 秒）+ 8 张关键帧
  ↓
VLM A：找关键点、识别女主、场景摘要
  ↓
Grok 4.3：生成角色卡 JSON
  ↓
Flux / 帧截图：生成游玩点海报
  ↓
写入 D1 episode_play_points + 上传 R2 海报
  ↓
人工审核 status=published
  ↓
前端读取接口，渲染进度条标记 + 右下角「游玩」标签
```

## 3. 数据模型

新增 migration：`cloudflare/dzmm/migrations/0094_episode_play_points.sql`

```sql
CREATE TABLE IF NOT EXISTS episode_play_points (
  id TEXT PRIMARY KEY,
  drama_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK(end_ms > start_ms),
  lead_name TEXT NOT NULL CHECK(length(lead_name) BETWEEN 1 AND 40),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  summary TEXT NOT NULL CHECK(length(summary) <= 1200),
  card_json TEXT NOT NULL,
  poster_key TEXT,
  vlm_model TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','published','rejected')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(episode_id)
);
CREATE INDEX IF NOT EXISTS episode_play_points_drama ON episode_play_points(drama_id, episode_number);
CREATE INDEX IF NOT EXISTS episode_play_points_status ON episode_play_points(status);
```

说明：

- `UNIQUE(episode_id)` 先保证每集 1 个游玩点；以后扩多游玩点时再迁移。
- `card_json` 字段与酒馆角色卡一致：
  - `name/description/personality/scenario/firstMessage/tags`
- `poster_key` 存 R2 key，例如 `play-points/hg-7255/ep-001.webp`
- 只存派生内容，不存原视频。

## 4. 后端接口

新增 `cloudflare/dzmm/src/play-points.ts`，在 `app.ts` 注册：

### 4.1 公共批量读取

```http
GET /v1/play-points?episodeIds=hg-7255-1,hg-7255-2
```

只返回 `status='published'`：

```json
{
  "points": [
    {
      "id": "pp_xxx",
      "dramaId": "hg-7255",
      "episodeId": "hg-7255-1",
      "episodeNumber": 1,
      "startMs": 45000,
      "endMs": 62000,
      "leadName": "林蕙香",
      "title": "浴室里的试探",
      "summary": "……",
      "card": { "name": "...", "description": "...", "personality": "...", "scenario": "...", "firstMessage": "...", "tags": [] },
      "posterUrl": "https://video.xumengchat.top/play-points/hg-7255/ep-001.webp"
    }
  ]
}
```

限制：

- 一次最多 50 个 episodeId
- 只读公开字段，不返回 vlm_model/confidence/status

### 4.2 内部写入（只给离线脚本/管理员）

```http
POST /v1/play-points
Authorization: Bearer <ADMIN_TOKEN>
```

或者 **更简单**：离线脚本直接用 `wrangler d1 execute` 插入，不新增写入 API。P0 用后者。

## 5. 离线 pipeline

新增脚本：`scripts/xumeng-play-points.mjs`

### 5.1 前置

- Node 18+
- `ffmpeg` / `ffprobe`
- 环境变量：
  - `OPENROUTER_API_KEY`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN`
- 本地 `.env.local` 已有 `OPENROUTER_API_KEY`
- 输出目录：`.cache-play-points/`
- 只处理指定剧集，默认 **不跑全站**

### 5.2 单集流程

1. 从 catalog 取 episode 信息：`dramaId/title/episode/mediaKey`
2. 下载 mp4 到 `.cache-play-points/<episodeId>.mp4`
3. 抽帧：
   - 扫描帧：`fps=1/5`，512px，最多 60 张
   - 关键帧：确定时间后，在起止点前后每 2 秒抽 1 张，512–768px，8–12 张
4. 调 VLM A 选关键点：
   - 默认模型：`nvidia/nemotron-3.5-super-vl:free`
   - 备选：`mistralai/mistral-small-3.2-24b-instruct`
   - 输入：扫描帧 + 标题/标签 + 可选字幕
   - 输出 JSON：`leadName/keyMoment{startSec,endSec}/summary/confidence`
5. 调 Grok 4.3 写卡：
   - model：`x-ai/grok-4.3`
   - 输入：8–12 张关键帧 + 标题 + 标签 + 第 4 步摘要 + 已知台词
   - 输出严格 JSON：
     ```json
     {
       "name": "角色名",
       "description": "外貌/身份/关系/动机",
       "personality": "行为逻辑/说话方式/边界",
       "scenario": "该时间点的具体场景",
       "firstMessage": "第二人称开场，250-450字",
       "tags": ["短剧", "禁忌关系"]
     }
     ```
6. 生成海报：
   - P0 先用关键帧截图裁 9:16 作 `poster`
   - P1 改成 Workers AI Flux 生成：
     - 后端加内部接口 `POST /v1/play-points/poster`
     - `env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt, steps: 6 })`
     - 写入 R2 `MEDIA.put("play-points/<episodeId>.webp", bytes)`
7. 上传海报到 R2
8. 生成 SQL 插入 D1（status=draft）
9. 审核后更新 `status='published'`

### 5.3 成本控制

- 扫描 40 帧：Nemotron 免费版，单集 $0
- 写卡 8 帧：Grok 4.3，约 $0.005–0.01/集
- 生图：Flux 约 $0.001/张
- **单集目标 < ¥0.10**
- 免费模型限流：20 RPM，免费 key 1000 请求/天
- Grok Tier 0：grok-4.3 37 RPS / 10M TPM，足够

### 5.4 NSFW 注意

- 阿里系模型（Qwen）会直接返回 400 `data_inspection_failed`，不要用于露骨帧
- Nemotron 免费版对露骨帧不稳定（10 帧可能过，20 帧可能 422）
- Grok 4.3 实测可接受露骨帧，但仍要人工审核
- 扫描阶段优先选脸部/上半身/非裸露帧；露骨帧只做定位，不一定要上传
- 所有生成卡片必须 `status='draft'`，人工审核后才能 `published`

## 6. 前端实现

### 6.1 新客户端库

新增 `src/lib/dzmm-play-points.ts`：

```ts
export type DzmmPlayPoint = {
  id: string; dramaId: string; episodeId: string; episodeNumber: number;
  startMs: number; endMs: number; leadName: string; title: string; summary: string;
  card: { name: string; description: string; personality: string; scenario: string; firstMessage: string; tags: string[] };
  posterUrl: string | null;
};
```

- `fetchDzmmPlayPoints(episodeIds)` 调 `/api/backend/v1/play-points?...`
- 校验字段/长度，失败静默返回空数组，不阻塞播放

### 6.2 播放器

修改 `src/components/dzmm/video-channel.tsx`：

- 新增 state：
  - `points: DzmmPlayPoint[]`
  - `activePoint: DzmmPlayPoint | null`
  - `playSheetOpen`
- 当前集变化时批量拉取 points
- 进度条：在 `startMs / duration` 位置画一个小标记
- 右下角：常驻「游玩」标签
  - 无点：显示「游玩」
  - 有点但未到：显示「游玩」
  - 播放时间进入 `startMs` 后：加 `active` 类，显示「本集可游玩」
  - 点击：打开 `PlayPointSheet`
- 保证不破坏已有手势：
  - 左右滑拖动进度
  - 上下滑切换集
  - 点击 12px 内 toggle play

### 6.3 卡片弹层

新增 `src/components/dzmm/play-point-sheet.tsx`：

- 背景遮罩 + 底部 sheet
- 顶部：海报
- 内容：女主名、标题、2–4 行摘要
- 按钮：
  - 「和她玩」→ 父组件 `onPlay(point)`
  - 「继续看」→ 关闭
- 剧透提示：不在关键点点击时显示「可能剧透，确定打开？」

### 6.4 接入酒馆

`tavern-app.tsx` 新增：

```ts
async function openPlayPoint(point: DzmmPlayPoint) {
  const character = parseCharacterImport({
    name: point.card.name,
    description: point.card.description,
    personality: point.card.personality,
    scenario: point.card.scenario,
    firstMessage: point.card.firstMessage,
    tags: point.card.tags,
    creator_notes: "官方短剧游玩点角色卡",
  }, `playpoint-${point.id}`);
  character.author = "叙梦短剧";
  showDetail(character);
}
```

- 不要把卡片写入用户 `custom`
- 点「和她玩」后可直接 `startChat(character)`，或先展示详情

## 7. 文件清单

新增：

- `cloudflare/dzmm/migrations/0094_episode_play_points.sql`
- `cloudflare/dzmm/src/play-points.ts`
- `src/lib/dzmm-play-points.ts`
- `src/components/dzmm/play-point-sheet.tsx`
- `src/components/dzmm/play-point-sheet.module.css`
- `scripts/xumeng-play-points.mjs`

修改：

- `cloudflare/dzmm/src/app.ts` 注册公共 GET
- `cloudflare/dzmm/src/types.ts` 如需新增 env
- `src/components/dzmm/video-channel.tsx` / `.module.css`
- `src/components/dzmm/tavern-app.tsx`
- `docs/xumeng-video-play-points-execution.md`（本文件）

## 8. P0 / P1 验收

### P0

- 只选 1 部剧 1 集
- 生成 1 个 draft 游玩点
- 接口能返回 published 数据
- 播放器能在进度条看到标记、右下角看到「游玩」
- 点击打开卡片，能「和她玩」
- 原有左右滑动进度/上下切换集不受影响
- `npm run check:client`、`npm run check:worker` 通过
- 不改游戏、支付、VIP、分享代码

### P1

- 1 部剧全部集数
- 审核 status
- 海报由 Flux 生成
- 移动端/桌面端截图验收

## 9. 发布

```bash
# 后端
cd cloudflare/dzmm
HOME=/Users/pencil/Documents/IntVideoGameEditor/.wrangler-home \
CLOUDFLARE_ACCOUNT_ID=274d62c1f24b885b3dfe562cda5d60c1 \
npm run deploy:production

# 前端
cd cloudflare/dzmm-web
HOME=/Users/pencil/Documents/IntVideoGameEditor/.wrangler-home \
CLOUDFLARE_ACCOUNT_ID=274d62c1f24b885b3dfe562cda5d60c1 \
npm run deploy
```

发布前：

```bash
cd cloudflare/dzmm-web
npm run check:client
npm run check:worker
```

## 10. 回滚

- 前端：关闭 video-channel 的 play points 渲染（feature flag `XUMENG_PLAY_POINTS_ENABLED=false`）
- 后端：保留旧 `/v1/video-characters` 接口
- 数据：`episode_play_points` 只新增，不删表，回滚不影响现有视频播放

## 11. 给 Cursor 的一句话

> 请按本文件执行 P0：先只做「1 部剧 1 集」的离线生成、`episode_play_points` 表、公共读取接口、播放器右下角「游玩」标签与卡片弹层；复用现有 `video-channel.tsx` / `tavern-app.tsx` / `parseCharacterImport`，不要修改游戏、支付、VIP、分享模块。完成后跑 `check:client` 和 `check:worker`，给出改动文件和验证截图。
