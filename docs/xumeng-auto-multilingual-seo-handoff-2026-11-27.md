# 叙梦（XUMENG）角色卡自动多语言翻译 + 多语言 SEO 同步更新与交接文档

- **日期**：2026-11-27
- **分支**：`NSFW`
- **关联前置提交**：
  - `f0bcdc6`：关闭前端 USDT 充值入口 + 重构充值/VIP 卡片页
  - `72fbb92`：SEO/GEO 三阶段优化（5 语种 `/c/{id}` 路由与 hreflang、OG 大图、双语 `llms.txt`、4 篇对比/指南页、`/tags` 与 8 个标签聚合页、IndexNow 支持）

---

## 一、本次实现了什么

实现「**提交/过审后后台全自动静默翻译（英/繁/日/韩，若原卡为外语则同时补简体中文）+ 自动同步到多语言 SEO 页面、Sitemap 与前端角色卡**」全链路：

```text
作者提交角色卡 (POST /v1/publishing/submissions)
  ├─ 立即返回 201（零阻塞）
  └─ ctx.waitUntil() 后台静默翻译 → 写入 D1 character_translations (publication_id, revision, locale)
        ↓
管理员审核通过 (PATCH /v1/publishing/submissions/:id/review, decision=approved)
  ├─ 上架公开目录 (is_listed=1, approved_revision=revision)
  └─ ctx.waitUntil() 幂等校验 source_hash：
       • 已翻译完 → 0 次 LLM 调用直接跳过
       • 有缺失语种（如提交时失败或老卡）→ 后台自动补齐
        ↓
对外自动生效（无需重新构建前端）
  ├─ 后端 API：
  │    • GET /v1/publishing/catalog/:id         → 附带完整 character.translations
  │    • GET /v1/publishing/catalog?view=card   → 批量附带精简 translations（name/tags/description）
  │    • GET /v1/publishing/sitemap             → 附带 localizedTitles
  ├─ 前端 SPA：
  │    • localizeCharacter / localizedCharacterTags 优先读取后端动态 translations，回退静态 JSON
  └─ Edge SEO Worker (cloudflare/dzmm-web)：
       • /en/c/published-{id}, /zh-tw/c/published-{id}, /jp/c/published-{id}, /ko/c/published-{id}
         实时渲染对应语种的 <title>、meta description、og:*、<h1>、标签、开场情境预览与 JSON-LD
       • /sitemap.xml (v=geo-v3) 自动输出多语言 /c/published-{id} URL 与译文 <image:title>
```

---

## 二、变更文件清单

### 后端（`cloudflare/dzmm`）
- `cloudflare/dzmm/migrations/0097_character_translations.sql`
  - 新建 `character_translations` 表（主键 `(publication_id, revision, locale)`，含 `source_hash`、`provider`、`updated_at`）。
- `cloudflare/dzmm/src/character-translations.ts`
  - 源语言自动检测（`zh-Hans` / `zh-Hant` / `en` / `ja` / `ko`）与目标语种计算；
  - 一次批量 JSON 调用翻译 4 语种（`name` / `tags` / `description` / `personality` / `scenario` / `firstMessage`），保留 `{{user}}` / `{{char}}` 占位符并做字段长度与标签数校验；
  - 多模型级联兜底（OpenRouter → Sealion → Cloudflare Workers AI）；
  - D1 读写、批量读取、`source_hash` 幂等补齐与 `scheduleCharacterTranslation`（`ctx.waitUntil`）。
- `cloudflare/dzmm/src/types.ts`
  - 新增可选环境变量：`TRANSLATION_ENABLED`、`TRANSLATION_API_KEY`、`TRANSLATION_BASE_URL`、`TRANSLATION_MODEL`。
- `cloudflare/dzmm/src/app.ts`
  - `fetchRequest` 透传第 3 参数 `ctx` 给 `handlePublishingApi`。
- `cloudflare/dzmm/src/publishing.ts`
  - 提交时剔除客户端伪造的 `translations`，落库后调用 `scheduleCharacterTranslation`；
  - 审核通过（`approved`）后调用 `scheduleCharacterTranslation` 做幂等补漏；
  - 新增 Super 专属补齐接口 `POST /v1/publishing/translate-backfill`；
  - `catalog`、`catalog/:id`、`sitemap` 三个公开接口附带翻译数据。
- `cloudflare/dzmm/test/character-translations.test.mjs`
  - Miniflare 真实 D1 + 全量迁移 + 提交/过审/目录/Sitemap/Workers AI 兜底集成测试。

### 前端（`src/`）
- `src/lib/dzmm-characters.ts`：`Character` 类型新增可选 `translations` 字段。
- `src/lib/dzmm-public-shelf.ts`：`toDzmmCatalogCard` 保留货架精简 `translations`（`name` / `tags` / `description`，剔除 `firstMessage`/`personality`/`scenario`）。
- `src/lib/xumeng-card-localization.ts`：`localizeCharacter`、`localizedCharacterTags`、`hasXumengCardTranslation` 优先消费 `character.translations`，回退静态表。
- `src/components/dzmm/tavern-app.tsx`：多语言货架筛选传入完整 `character` 以识别动态译文。
- `src/lib/xumeng-card-localization.test.mts`：动态翻译消费与精简货架裁剪单元测试。

### Edge SEO Worker（`cloudflare/dzmm-web`）
- `cloudflare/dzmm-web/src/character-share.ts`：`publishedCard()` 读取后端 `translations` 和开场白预览；`localizedCharacterRecord()` 优先应用动态译文并导出 `shareTitleForLocale`。
- `cloudflare/dzmm-web/src/geo-discovery.ts`：`publishedSitemapCharacters()` 与 `publicSitemapEntries()` 自动输出已翻译 `published-*` 卡片的 5 语种 sitemap URL 及 `<image:title>`，缓存键升级为 `v=geo-v3`。
- `cloudflare/dzmm-web/test/character-share.test.mts`、`cloudflare/dzmm-web/test/geo-discovery.test.mts`：补充动态多语言 SEO 页与 Sitemap 测试。

---

## 三、翻译模型与环境变量说明

**无需新增秘钥即可直接运行**，后端按以下优先级自动级联选择可用模型：

1. **OpenRouter（主通道）**：读取 `TRANSLATION_API_KEY`（未配置则复用现有 `GENERATION_OPENROUTER_API_KEY`），默认模型 `google/gemini-2.5-flash-lite`（可通过 `TRANSLATION_MODEL` 覆盖，例如换更强或更便宜的模型）。
2. **Sealion（备通道）**：读取现有 `SEALION_API_KEY`（`sealion-nova-pro`）。
3. **Cloudflare Workers AI（兜底）**：复用 `wrangler.production.jsonc` 已绑定的 `env.AI`（`@cf/meta/llama-3.1-8b-instruct-fast`）。

紧急总开关：在 Worker 环境变量设置 `TRANSLATION_ENABLED="false"` 即可静默关闭自动翻译，不影响正常投稿与审核。

---

## 四、已跑测试 vs 尚未验证项（重要）

### 已在本地通过的测试（共 57 项全绿）
- `cloudflare/dzmm/test/character-translations.test.mjs`：**3/3 通过**（Miniflare 真实本地 D1 + 全量迁移含 `0097` + esbuild 真实后端打包；LLM HTTP 响应为本地 mock）。
- `cloudflare/dzmm-web/test/{character-share,geo-discovery,routes,assets}.test.mts`：**47/47 通过**，`tsc --noEmit` 零错误。
- `src/lib/{xumeng-card-localization,dzmm-public-shelf}.test.mts`：**7/7 通过**。
- `cloudflare/dzmm-web` 生产构建：`vite build` + `copy-assets.mjs` 通过。

### 待在另一环境补全的工作与验证清单

#### 1. 数据库迁移与双 Worker 部署（必须按顺序）
```bash
# Step 1: 先对生产 D1 执行 0097 迁移（建 character_translations 表）
cd cloudflare/dzmm
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc

# Step 2: 部署后端 Worker (dzmm-backend)
npx wrangler deploy --config wrangler.production.jsonc

# Step 3: 构建并部署前端/边缘 SEO Worker (dzmm-web)
cd ../dzmm-web
npm run build
npx wrangler deploy --config wrangler.production.jsonc
```

#### 2. 线上真实模型与端到端冒烟验证（未在本机联网实测）
- [ ] 在线上（或带真实 `GENERATION_OPENROUTER_API_KEY` 的环境）提交一张测试中文角色卡，等待 3–8 秒后检查：
  - `wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT publication_id, revision, locale, name, provider FROM character_translations ORDER BY updated_at DESC LIMIT 8;"`
  - 确认 4 条记录（`en`、`zh-Hant`、`ja`、`ko`）已自动落库，译文质量与 `{{user}}` / `{{char}}` 占位符正常。
- [ ] 将该测试卡审核通过（`approved`），验证：
  - `GET https://xumengchat.top/api/dzmm/backend/v1/publishing/catalog/published-{id}` 返回 `character.translations`；
  - 浏览器/curl 访问 `https://xumengchat.top/en/c/published-{id}`、`/zh-tw/c/...`、`/jp/c/...`、`/ko/c/...`，检查 `<title>`、`meta description`、`canonical`、`hreflang`、`<h1>` 与正文均为对应语言；
  - 10 分钟内（或清缓存后）检查 `https://xumengchat.top/sitemap.xml` 已包含该卡的 5 语种 URL；
  - 在前端切换语言（English / 繁體中文 / 日本語 / 한국어），确认新上架角色卡直接显示译文。
- [ ] 检查 OpenRouter 上 `google/gemini-2.5-flash-lite` 实际调用成功率与延迟；如需换模型，直接在 `dzmm-backend` 设置 `TRANSLATION_MODEL` 环境变量即可（无需改代码）。

#### 3. 历史已上架角色卡一键补齐（可选）
用 Super 账号登录后调用（单次 `limit` 最大 10，可循环直到 `processed === 0`）：
```bash
curl -X POST "https://xumengchat.top/api/dzmm/backend/v1/publishing/translate-backfill" \
  -H "Content-Type: application/json" \
  -H "Origin: https://xumengchat.top" \
  -H "Cookie: <SUPER_SESSION_COOKIE>" \
  -d '{"account":"<SUPER_USER_ID>","limit":5}'
```
也可以针对单张卡片强制重译：
```json
{"account":"<SUPER_USER_ID>","publicationId":"published-xxxx","force":true}
```

#### 4. 顺手可补的 SEO/运维后续事项（上次 + 本次一起）
- [ ] **配置 IndexNow**：在 `dzmm-web` 生产 Worker 配上 `INDEXNOW_KEY`（任意 32 位十六进制字符串）和 `OPS_ADMIN_SECRET`，部署后运行 `INDEXNOW_KEY=... node cloudflare/dzmm-web/scripts/submit-indexnow.mjs` 或调 `POST /api/ops/indexnow` 提交全站 URL。
- [ ] **Google Search Console / Bing Webmaster**：重新提交 `https://xumengchat.top/sitemap.xml`，确认新多语言 `/en/c/published-*` 等路由收录正常。
- [ ] **可选后续迭代**：
  - 审核通过且翻译完成后，在 `dzmm-backend` / `dzmm-web` 自动触发单条 IndexNow 推送（提交 5 语种 `/c/published-{id}` URL 实现分钟级收录）；
  - 补充一个双 Worker 串联（`dzmm-web` 直连 `dzmm-backend` Miniflare 实例）的跨 Worker 端到端测试；
  - 如需人工精修爆款角色卡译文，可在管理后台增加 `PATCH /v1/publishing/publications/:id/translations` 手动覆盖接口。

---

## 五、注意事项

- 本机仓库中另有与本次任务无关的既有未提交改动（`mobile/android/app/build.gradle`、`mobile/android/app/src/test/`、`output/`），已刻意排除在本次提交之外。
- 历史迁移 `cloudflare/dzmm/migrations/0090_guagua_first_half.sql` 在全新空库顺序执行时存在既有列依赖问题（线上老库已跑过不受影响）；`character-translations.test.mjs` 中已临时跳过该旧迁移，未触碰既有线上迁移文件。
