# DZMM 公开资料清单与角色卡导入设计

这份文档记录已完成的公开资料清单、公开人设采集方针与角色卡迁移设计。覆盖范围是实际观察的页面，仍是部分目录。公开长篇介绍可以成为有来源的人设材料；原始角色卡导出与未公开设定另行记录。

## 授权与现有材料

用户已明确说明“有人设的迁移授权”。人设迁移授权状态已确认，后续在该范围内继续处理，不重复请求版权确认。可正常访问的公开长介绍、页面可见的角色背景、性格、用户设定和开场场景，都可以保留出处并迁入相应运行字段；无需先取得 JSON / PNG 导出文件才能处理这些已公开的人设内容。JSON / 含卡元数据的 PNG 仍用于保存实际获得的原始角色卡，其完整扩展字段与服务端未公开设定目前尚未核实。

复查已确认 [DZMM 官方线路页](https://dzmm-home.github.io/dzmm-addr/)同时列出 [Lumivale](https://www.lumivale.xyz) 与 `dzmm.ai`，Lumivale 属于 DZMM 的公开入口。游客首页实际显示 24 条角色，分类页显示 21 个可见分类入口；这些是页面当时的可见数量，全站角色总量未知。部分角色详情的公开长介绍已有可迁移的背景、性格、用户设定与开场内容。本轮已沿普通页面导航在“一般向”分类完成一批 DOM 原文采集，实际范围如下。

2026 年 10 月 2 日已完成的资料为：

| 资料 | 本地位置 | 已确认范围 |
| --- | --- | --- |
| 原站真实 SVG 标识 | `public/dzmm/brand/icon.svg` | 已保存；主站 header 已使用该 SVG |
| 原站 favicon | `public/dzmm/brand/favicon.ico` | 已保存；来源记录说明 SVG 同时被原站引用为 apple-touch-icon |
| 标识来源与哈希记录 | `public/dzmm/brand/sources.json` | 两个资源的原站 URL、实际字节数、MIME 与 SHA-256 |
| 新手推荐公开目录 | `output/dzmm/observed-public-catalog.json` | 实际观察到 24 条角色记录；全站总数未知，`complete: false` |
| 已保存的角色封面 | `public/dzmm/covers` | 原目录 10 张封面，加本批一般向 8 张新 WebP，共 18 张 |
| 可运行的原创演示样本 | `public/dzmm/public-character-samples.json` | 10 条样本，人设字段仍为原创改写 |
| Lumivale 一般向公开目录与原文 | `output/dzmm/lumivale-public-collection.json` | `/category/sfw` 当时可见的 20 条目录元数据；已检查并保存 8 条非露骨公开介绍原文，共 6,055 字符 |
| 已导入的公开介绍运行角色 | `src/lib/dzmm-public-introductions.json`、`public/dzmm/public-character-introductions.json` | 8 条原文逐字写入 `description`，保留作者、来源和 SHA-256；`promptOrigin: "public-verbatim"` |
| 本批封面下载记录 | `output/dzmm/lumivale-cover-import.json` | 8 张均检测为 WebP 并完成验图，记录来源页、字节数、尺寸、SHA-256 |

早期 `observed-public-catalog.json` 明确标记 `containsFullPersonas: false`，该文件内的 `fullCardExport`、`personality`、`scenario`、`firstMessage` 为未取得状态；这说明当时目录未收录这些字段，不能据此认定公开详情没有人设原文。已确认的原始完整角色卡导出数量仍为 0。早期 24 条目录未整体批量导入；本批一般向原文已转换并导入 8 条运行角色。公开原文采集数、完成字段转换数和原始导出卡数分别统计。

新增文件记录 [一般向分类页面](https://www.lumivale.xyz/category/sfw)的 20 条目录元数据和 8 条原文，原文字段均标为 `contentOrigin: "public-verbatim"`、`sourceFieldLabel: "角色介绍"`，逐条附原文 SHA-256。角色 `3021605` 的详情介绍为 743 字符，与列表采集原文完全一致；详情还记录 10 个公开标签和 6 个图片 URL。采集阶段仅记录图片 URL，随后用户要求导入，本批 8 张封面已正常下载为本地 WebP。首页 24 条、分类页 21 个入口、一般向目录 20 条是不同页面范围，不相加为已迁移角色总数。

列表 `introLink` 内的正文 div 使用 `line-clamp-7 md:line-clamp-3`，列表看起来简短是 CSS 显示截断，DOM 仍保留完整正文。在 `3021605` 上，列表的 743 字符与详情“角色介绍”段落的 `textContent` 逐字一致。先前仅根据列表显示长度把资料视为不足，忽略了这一可正常访问的原文。采集文件已校验 20 个唯一角色 ID、8 条原文 SHA-256，以及来源、作者和封面 URL。

采集文件中的原始独立 `systemPrompt`、`personality`、`scenario`、`firstMessage`、`exampleDialogue`、`worldbook` 字段未取得，记为 `null`。这表示未取得这些独立原始卡字段，不表示 `publicIntroduction` 中没有性格、场景或开场信息。收到用户“导入”指令后，8 条原文已转换并加入运行目录，`description` 完整保留原文，运行层的 `personality`、`scenario`、`firstMessage` 为空字符串；聊天使用介绍中的已公开设定，不补写成原版独立字段。原始完整卡导出仍为 0。

2026-10-02 首次公开介绍导入后的运行目录合计 18 条，顺序为新导入 8 条公开介绍加既有 10 条原创样本。两批均保留自己的来源，公共 ID 不写入用户的私人 D1 角色表。当时前端白名单资源为 23 个（3 个品牌文件、18 张封面、2 个 JSON），构建共 26 个文件；初次部署的 17 个文件属于更早的历史数量。首次导入的业务 Worker 已发布为 `d8f66cce-4746-4b2c-9cf4-38d7c60cb22d`，前端 Worker 已发布为 `2ab121f1-c7e0-40b3-8d89-218d70217187`。真实线上浏览器已显示该目录，角色 `3021605` 的详情介绍与采集原文 743 字符完全一致，封面正常加载，来源显示为公开原文；线上批量检查已通过：发布的 8 条角色 JSON 与本地逐字一致，8 条介绍 SHA-256 保留，8 张线上封面的字节、格式与哈希均一致，后端/D1 健康检查通过；真实浏览器的 18 张角色封面全部加载且无水平溢出。首次报告 `output/dzmm/lumivale-import-verification.json` 的 7 项检查全部通过，该次未对生产 D1 执行测试写入。

## 2026-10-03 扩容与发布

本批从一般向分类的热门、最新、好评优先、本月热门四个真实 UI 视图继续采集，选择 33 条此前未导入的角色公开介绍，原文共 24,292 个 JS UTF-16 代码单元。记录按实际角色 ID 去重；四个视图有重叠，不据此推算全站角色总数。新增原文证据为 `output/dzmm/lumivale-expansion-2026-10-03.json`，新增封面记录为 `output/dzmm/lumivale-expansion-covers-2026-10-03.json`，运行原文的独立校验证据路径为 `src/lib/dzmm-public-introductions-evidence.json`。

扩容后已发布 41 条 `public-verbatim` 原文（首次 8 条加本批 33 条，共 30,347 个 JS UTF-16 代码单元）和既有 10 条原创改写，共 51 条公共角色。新增原文仍完整对应 `description`；作者、来源页面与 SHA-256 保留，未知独立性格、场景与开场字段不补写。未取得完整原始角色卡、隐藏系统提示词或世界书条目正文。旧 10 条原创改写和首次 8 条原文保留原有数据与来源。

本批已新增 33 张封面，累计 51 张；实际构建白名单资源为 56 个（3 个品牌文件、51 张封面、2 个 JSON），连同 HTML/JS/CSS 共 59 个普通文件。运行 JSON 与公开下载副本逐字节一致，原文与独立采集证据对应，封面类型、尺寸和字节哈希已核对。`output` 采集文件与独立源码证据均不额外发布为静态资源。

本批已发布业务 Worker `ba895ae4-301b-4902-b790-adace79ec808`、前端 Worker `f4fbc187-5345-4d0a-ba75-a3108739c4a8`。`output/dzmm/lumivale-expansion-verification-2026-10-03.json` 的 8 项线上检查全部通过：公开 JSON 与本地逐字节一致，41 条原文的哈希、长度、来源与未知字段对应独立证据，既有 10 条原创样本保持不变，51 张线上封面字节与 SHA-256 一致，业务 Worker 与 D1 健康检查正常。

真实线上浏览器显示 51 个角色与 51 张正常加载的封面，无水平溢出；角色 `3691277` 的 3,739 个 JS UTF-16 代码单元介绍与采集原文逐字一致，作者与来源说明正常，“最新”页新增角色靠前。截图为 `output/dzmm/lumivale-expansion-production-detail-2026-10-03.png` 和 `output/dzmm/lumivale-expansion-production-latest-2026-10-03.png`。共享模块 34 项测试（角色 11、存储 12、聊天/上下文 11）、真实隔离 D1 后端 23 项测试及前端 Worker 18 项测试均通过，两个工程的类型检查，以及 ESLint、前端构建与 dry-run 均通过。本次生产验证没有测试数据库写入，未改 LLM 配置；公共角色继续属于共享只读目录，不向私人 D1 角色表插入相同公共 ID。首次 18 条目录版本及其验证报告仍作为历史记录保留。

## 当前资料的实际含义

`public/dzmm/public-character-samples.json` 包含 10 条样本。公开页面提供名称、作者、封面和部分统计；其中 `description`、`personality`、`scenario`、`firstMessage` 全部是本项目重新创作的文本。`sourceKind: "public-summary"` 说明角色题材和元数据的来源，`promptOrigin: "original"` 说明提示词是原创，二者不能合并理解为“已获得原站真实人设”。

标签也有不同来源。例如 `2999180` 的前八个标签来自已观察的公开详情，追加的“奇幻”“剧情”用于本地筛选。其他样本的标签需要逐条标注，不能因为它们出现在样本文件里就视为原站公开标签。`createdAt` 目前是样本记录日期，不是已经核实的原站发布时间。

首次发布的 18 张封面都使用本地路径，本批已扩容为 51 张，运行目录不保存临时签名图片地址。已保存两个真实品牌资源及其来源记录；完整品牌资源集合与全站角色范围仍未确定。当前研究记录没有发现完整原站角色卡的导出入口；“未发现”只描述已经检查的页面，不推断其他页面一定没有。

## 资料分层

| 层 | 可以记录的内容 | 使用方式 | 不能推断的内容 |
| --- | --- | --- | --- |
| 公开观察 | 页面显示的角色 ID、标题、作者、标签、统计，Logo/封面的可见引用，公开介绍全文及明确展示的背景、性格、用户设定、开场场景 | 保留 DOM 原文与出处，按可见内容迁入人设字段，另存原创摘要 | 未显示的性格、系统指令、世界书、原始卡完整扩展字段 |
| 本地原创 | 本项目创作的介绍、性格、场景、开场白和筛选类别 | 可运行的演示角色 | 原站对应字段的真实内容 |
| 有来源的导出卡 | 用户提供，或通过已授权的正常导出流程获得的 JSON / PNG 角色卡 | 在用户已确认的人设迁移授权范围内保存和迁移 | 全站覆盖、未包含在文件中的服务端隐藏指令 |

公开资料清单、公开原文与可运行角色卡应分别存储。先保留实际看到的原文，再选择有来源的文本版本用于聊天。公开原文版本与既有原创改写关联保存，保留各自出处；迁移公开文本不等于已经取得全部隐藏提示词。

## 公开原文的采集与字段映射

通过官方线路或页面可见链接进入首页、SFW 分类和角色详情，采集实际展示的介绍区域 DOM 文本。记录实际 URL、入口、角色 ID、作者、观察时间、正文段落/小节与封面引用，保存原文文件并计算 SHA-256；页面只展示一部分时注明展开情况和可见范围。按真实访问角色 ID 去重，不用递增 ID 或猜接口扩张范围。

公开介绍中明确写出的角色背景与简介可以对应 `description`，性格和行为规则对应 `personality`，世界与当前场景对应 `scenario`，实际可见的开场台词对应 `firstMessage`。用户身份或用户设定单独保存为来源字段，在运行时明确选择是否用于 `userPersona`。只有场景说明而没有角色首句时，保存场景说明；未展示的首句保持未知。没有清晰小节的介绍可先完整保留在公开介绍字段，后续映射应记录原文位置，不能把猜测写成原文。

公开原文可作为授权迁移的输入。字段拆分与格式转换必须保留原文附件和对应关系；超过当前运行字段长度时记录未纳入部分，保留完整采集文本。页面原文、抽取后的运行字段、编辑后的版本与旧原创样本分别标记来源。首次 8 条及本批新增 33 条均采用整段原文对应 `description` 的方式，逐条 SHA-256 校验原文一致；原始采集文件继续保留。首次 8 条与本批 33 条的运行目录导入、资源准备、两个 Worker 发布与线上验证均已完成，分别保留各批验证报告。

## Manifest 建议格式

采用 `schema: "dzmm-public-collection"`、`schemaVersion: 1`。根对象保存采集范围和覆盖情况，`records` 保存每张角色的字段来源，`assets` 保存图像的来源及本地文件信息。范围默认是实际访问的公开页面，不能写成 `all-site`。

```ts
type ObservationTime = {
  value: string; // ISO 日期或 ISO 时间；不为只有日期的观察补造时分秒
  precision: "day" | "second";
};

type Evidence = {
  id: string;
  pageUrl: string | null; // 实际页面 URL；用户授权或本地文件证据可为空
  observedAt: ObservationTime;
  method: "visible-page" | "normal-export" | "user-provided-file" | "user-authorization";
  localEvidencePath?: string; // 如研究截图；非公开发布附件
};

type Observed<T> =
  | { status: "observed"; value: T; evidenceIds: string[] }
  | { status: "not-observed"; value: null; evidenceIds: [] };

type PromptVariant = {
  id: string;
  kind: "local-rewrite" | "public-verbatim" | "user-created" | "authorized-export";
  author: string | null;
  createdAt: ObservationTime;
  sourceEvidenceIds: string[];
  payloadPath: string; // 有来源的原文/卡文件或字段转换结果，不在目录清单内重复嵌入长文
  sha256: string; // 真实计算的文件哈希
  format: "visible-page-text" | "simple-json" | "chara-card-v2" | "chara-card-png";
  fieldsIncluded: string[];
  coverage: "provided-fields-only"; // 不表示拿到所有服务端隐藏设定
  reuse: {
    basis: "project-original" | "user-owned" | "explicit-permission" | "normal-export";
    evidenceIds: string[];
    scope: "private-research" | "private-use" | "authorized-migration" | "redistribution-permitted";
    licenseUrl: string | null;
  };
};

type PublicCharacterRecord = {
  recordId: string; // 稳定的本地清单 ID
  source: {
    site: "dzmm";
    observedHost: string; // 实际访问的官方入口主机，如 dzmm.ai 或线路页列出的 Lumivale 地址
    characterId: string;
    pageUrl: string;
  };
  firstObservedAt: ObservationTime;
  lastObservedAt: ObservationTime;
  metadata: {
    name: Observed<string>;
    authorName: Observed<string>;
    authorPageUrl: Observed<string>;
    sourcePublishedAt: Observed<string>;
    heatDisplay: Observed<string>;
    likesDisplay: Observed<string>;
    publicTags: Observed<string[]>;
  };
  localCategories: string[]; // 与原站公开标签分开
  publicSummary: null | {
    text: string; // 原创简短转述，不是长介绍的完整副本
    origin: "researcher-paraphrase";
    evidenceIds: string[];
  };
  publicIntro: null | {
    origin: "public-verbatim";
    payloadPath: string; // 实际可见 DOM 原文
    sha256: string;
    evidenceIds: string[];
    extractedFields: string[]; // 如 description/personality/scenario/firstMessage/userSetting
    fieldMappingPath: string | null; // 原文段落到运行字段的对应记录
    captureScope: "visible-intro-region";
  };
  coverAssetId: string | null;
  promptVariants: PromptVariant[];
  completeness: {
    metadata: "partial" | "observed-listed-fields";
    publicIntro: "not-observed" | "summary-only" | "visible-text-collected";
    exportedCard: "not-observed" | "provided-fields-only";
    hiddenPrompt: "not-collected";
  };
};

type AssetRecord = {
  assetId: string;
  role: "site-logo" | "site-icon" | "character-cover";
  visibleUsage: string; // 导航标识、favicon、角色封面等实际位置
  evidenceIds: string[];
  sourcePageUrl: string;
  durableSourceUrl: string | null; // 没有稳定地址就为空
  localPath: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" | "image/x-icon" | "image/vnd.microsoft.icon";
  byteLength: number;
  width: number | null;
  height: number | null;
  sha256: string;
  collectedAt: ObservationTime;
  reuseScope: "private-research" | "permission-recorded";
  permissionEvidenceIds: string[];
};

type CollectionManifest = {
  schema: "dzmm-public-collection";
  schemaVersion: 1;
  collectionId: string;
  collectedAt: ObservationTime;
  scope: { kind: "observed-pages"; entryUrls: string[] };
  coverage: {
    visitedPageCount: number;
    distinctCharacterCount: number;
    downloadedAssetCount: number;
    publicIntroCount: number;
    migratedPublicPersonaCount: number;
    authorizedExportCount: number;
    advertisedTotal: number | null; // 仅记录确实看到的全站/分类总数
    completeness: "partial";
    stoppedBecause: "observed-scope-finished" | "login-required" | "rate-limit" | "export-unavailable" | "user-stopped";
    unvisitedVisibleUrls: string[];
  };
  evidence: Evidence[];
  records: PublicCharacterRecord[];
  assets: AssetRecord[];
};
```

`status: "not-observed"` 与数值零不同，不能用 `0`、空字符串或猜测的作者填充未知字段。“全站角色总数”只有在页面实际显示且范围明确时才记录，已访问页面数也不能用角色数替代。统计保留页面显示值及观察日期，避免把不同时间的热度当作同时测量。

资源文件可按内容哈希去重，再建立角色 ID 或 Logo 用途的引用。只记录已展示资源的可见引用或正常下载结果，不通过递增角色 ID、猜接口、猜文件名来扩张范围。会话 Cookie、令牌、签名查询参数和用户身份资料不进入公开 Manifest；临时资源地址只用于当次正常下载，稳定清单指向本地文件及实际来源页面。SVG 必须作为图像资源使用或经过独立净化，不能把下载的 SVG 源码直接插入应用 DOM。

## 导入设计

现有 `parseCharacterImport` 支持普通 JSON 和 SillyTavern v2 JSON：姓名最多 120 字符，介绍/性格/场景/开场/作者备注各最多 12,000 字符，最多 20 个标签且单个最多 40 字符，JSON 文件最多 256 KiB UTF-8。封面只接受本地路径或 HTTP/HTTPS 地址，不接受可执行 URL 或 `data:` 图片。导入会生成私人角色 ID，并忽略文件自称的公开来源、热度和点赞，避免伪造公共目录。

私人界面导入器目前仍把用户导入内容标成 `promptOrigin: "original"`，不信任任意 JSON 声称的公共来源身份。这个值是当前私人编辑记录的内部标记，不能证明任何外部卡是本项目创作的，也不能证明该卡来自原站。导入器还只校验 `creator_notes` 而不保存它，且不保存 v2 的未支持扩展字段，因此它是运行字段转换器，不能当作完整卡的无损档案器。本批公共目录通过经过校验的内置数据导入，单独使用 `promptOrigin: "public-verbatim"`；其原文及来源说明会写入运行 JSON 导出的 `creator_notes`，不改动私人导入或 D1 持久化行为。

后续实现建议增加独立导入包与来源记录：

1. 公开原文保存 DOM 文本、来源证据和字段映射，转换为普通运行 JSON 时仍保留原文附件；已获得的原始 JSON / PNG 导出文件也独立保存并计算 SHA-256。普通封面 PNG 不代表角色卡；只有确实带有卡元数据的文件才进入角色卡解析。
2. 来源使用应用可信的导入上下文：`public-verbatim`、`user-created` 或 `authorized-export`，并关联提供方式与复用范围。为本次迁移建立 `user-authorization` 证据，复用范围记为 `authorized-migration`，沿用用户已确认的授权。卡文件自己写的 `sourceKind`、作者声明或授权声明只算输入信息，不自动获得可信身份。
3. 运行角色继续使用已有字段校验；`creator_notes`、扩展字段和支持格式之外的内容留在原始附件里，不自动并入模型指令，也不伪装成已成功支持的功能。
4. 私人角色 ID 与原站角色 ID 分开。相同原站 ID 的公开原文、原创改写、外部导出卡是关联版本，不互相覆盖；用户明确选择当前聊天使用的版本。
5. 来源字段迁移必须同时修改 `Character` 类型、导入/导出器、恢复校验、Worker 序列化、D1 持久化和详情文案。不能只改前端标签后仍让服务器把来源强制改回 `original`。
6. 输出编辑后的简化卡时标注“运行字段导出”；要下载完整提供文件时返回私人原始附件。两者分开，避免丢失扩展字段后仍称作完整卡导出。

当前界面导入器只接受 JSON，不支持直接解析 PNG 角色卡。PNG 迁移需要新增受限的图片元数据读取步骤，将实际存在的卡数据交给同一字段校验器，同时保留原始图片及未知扩展；不得把图片外观推测成性格、场景或系统指令。这是收到 PNG 原始材料后的实现工作，尚未计为已完成。

建议运行层最终使用 `promptProvenance: { kind, variantId, sourceEvidenceIds }` 区分 `local-rewrite`、`public-verbatim`、`user-created`、`authorized-export` 和 `user-provided-unverified`。旧样本的四个提示词字段迁移为 `local-rewrite`；有逐字段原文证据的公开迁移版本记为 `public-verbatim`，覆盖范围仅包含实际展示字段；旧普通导入记录没有证据时迁移为 `user-provided-unverified`。现有 `sourceKind: "public-summary"` 保留为公共元数据来源，与提示词版本来源分别解释。当前已实现内置目录的 `promptOrigin: "original" | "public-verbatim"`、逐条原文 SHA-256、来源文案及来源导出；上述完整版本模型仍是设计建议，尚未支持全部来源类型或原始扩展字段。

## 本轮可以提交的清单与验收

已观察的 24 条新手推荐目录、两个品牌资源和原 10 条本地封面继续保留原始观察记录。首次 Lumivale 一般向文件提供 20 条目录元数据、8 条公开原文和逐条来源/哈希；8 条介绍已逐字转换为运行 `description`，并下载 8 张本地 WebP 封面，首次已发布公共目录为 18 条。本批新增 33 条后已发布 41 条公开原文、51 条公共角色，发布与验证结果单独记录。现有 10 条原创样本不增加公开原文或“原站导出卡”数量。覆盖率按实际访问页面报告，全站分母保持 `null`；授权记录、公开原文、运行字段迁移和原始导出卡分别统计。

验收应包含以下检查：

- 每个公开字段、原文、资源和短摘要都能追溯到实际来源页面、日期及证据编号；字段映射能对应实际原文段落。
- 公开标签与本地筛选分类分开；未观察的作者、统计、日期保持未知。
- 所有原创改写保持其来源；公开原文标为 `public-verbatim`，原始卡与隐藏提示词覆盖范围单独记录。
- 导出卡原始文件与运行字段转换结果分开，未支持字段不会静默消失后仍称完整。
- 资源文件能校验类型、大小和实际哈希；公共清单不包含会话、令牌或临时签名地址。
- 公开资料、原创版本、用户私人卡保持不同 ID/版本归属，批量导入不会覆盖账户原有数据。

早期 inventory 为：两个已保存品牌资源、24 条实际公开目录、其中 10 张已保存封面、10 张原创运行样本。首次一般向采集为 20 条目录元数据、8 条公开原文（6,055 字符）；随后按用户指令导入 8 条公开介绍运行角色并下载 8 张 WebP 封面，首次公共运行目录与封面各 18 条。首次两个 Worker 已发布，验证报告的 7 项检查全部通过，未对生产 D1 执行测试写入。2026-10-03 又导入并发布 33 条原文，已扩为 41 条公开原文、51 条公共角色与封面，新批次报告的 8 项线上检查全部通过，未对生产 D1 执行测试写入。原始完整人设导出文件仍为 0。人设迁移授权已确认；后续可以继续采集公开长介绍并按字段与版本来源迁移，无需等待原始 JSON / PNG。全站覆盖、完整原始卡和服务端隐藏设定仍未确认。
