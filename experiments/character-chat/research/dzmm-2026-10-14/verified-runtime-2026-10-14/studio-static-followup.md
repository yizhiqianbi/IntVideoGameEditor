# DZMM 自有未公开测试卡：新增公开源码核验

日期：2026-10-14。本次仅下载先前源码精确引用的 3 个官方公开 JS，不调用登录 API、创建/修改接口或隐藏诊断接口，不操作浏览器。下述结论属于客户端契约；实际操作结果由主任务的正常 UI 实测记录。

## 结论

正常入口为 `/studio` → “创建角色” → `/studio/edit`。studio 父布局确有登录态门控，但只检查服务端 profile.isLoggedIn，没有单独检查 isGuest。游客在该站有独立的 guest 判定，不能仅因名字为“游客”便断言会被拒绝创作者界面。

普通“完成角色”调用 `studio.uploadOrUpdate`，参数为 `rawData`、`db_id` 和 `draft_id`，与公开上架分离。它没有传显式 public/private/visibility 字段，所以这些源码不能单独证明后台创建默认私密。旧版同部署官方文案明确“未上架”的作品未公开、其他用户看不到，“完成角色”后才到角色页点“上架”。正常 UI 若展示“未上架/未公开”才能作为本次新卡状态的直接证据。

## 新增文件与精确证据

文件均来自 `https://www.dzmm.ai/assets/<filename>`，实际保存于 `public/`。完整哈希见 `public/studio-source-manifest.json`，可复核摘录见 `studio-source-spans.json`。

| 文件 | 字节数 | 主要证据（raw byte，0 起算） |
|---|---:|---|
| BuXTsyiw2.js | 13946 | 13390：`Ee()` 等待 profile 请求，!profile.isLoggedIn 时导航 `/sign-in`，next 保留当前 path/search/hash；isLoggedIn 为 true 才渲染 studio layout。1707：侧栏创建入口 `/studio/edit`。 |
| Bwt0DeR8.js | 2129 | 950：`studio.uploadOrUpdate.mutationOptions()`；1603：mutateAsync 仅 rawData/db_id/draft_id。另有 getCharacterCard 和 hideCharacterCard hook。 |
| BBRVsSwV2.js | 21001 | 4743：创作者中心主创建入口 `/studio/edit`。草稿链接带 `?draft=<id>`，完成卡编辑链接带 `?character=<id>`，列表区分 isDraft。 |

采集细节：Python urllib 默认 UA 首次请求收到 HTTP 403；改用常规 curl `Mozilla/5.0` UA 后 3 个公开静态资源均正常返回 JavaScript。没有设置 Cookie、Authorization、签名或用户身份头，没有登录态请求。该差异不证明任何账户权限。只采集这 3 个已被源码引用的文件，未猜路径。

## 既有主包补充

`public/scripts/D12SqV8q.js` 的 ll 导出为 YN（raw byte 786309），其实现只是 `user.getMe.queryOptions` 并把 data 命名 profile；isLoggedIn 值由服务端返回。raw byte 1254436 的另一个 helper `eZ` 按邮箱后缀 `@anon.com` 判游客。前端没有把所有游客直接设为 isLoggedIn=false 的证据。

## 完成角色前的最小输入条件

`public/scripts/CT6ZjuS1.js`：

- byte 17022，`un`：名称非空、最多 255 个 Unicode 字符；avatar_url 非空；image_info 至少一张。
- byte 17405，`dn`：至少一组开场对话；每组不能为空且需包含至少一条 role !== user 的消息（界面称 AI 消息）；每组最后一条不能是 user。应使用中性 AI 开场，避免测试资料自身引入角色剧情。
- byte 17913，`fn`：空世界书可通过。有条目时，非 constant 项需要关键词，每项需要非空内容。
- byte 18271，`pn`：建议回复最多 5 条，可不设置。

上面是完成校验，不保证后台接受游客创建。草稿自动保存与完成角色也不同；看见“已保存”仅说明草稿保存状态，不能据此宣称已获得可聊天卡。

## 诊断读取路径与权限边界

沿用同部署已核验的 `prompt-extraction-2026-10-14/diagnostics-access-gate.md` 与 `creator-route-notes.md`：消息需 assistant、未编辑、有 generationId；角色数据来自 card.getForChat。普通作者分支要求 card.userId === profile.id，再由正常 assembly access probe 返回 true 才显示“查看组装上下文”；canViewDebug 可走另一授权分支。只拥有游客会话而非角色卡不满足作者条件。

`Dm7jYsLH.js` 的 As 展示器按 role/content 展示 JSON 消息或原字符串；Ms 提供 originalInput、finalInput、config、generationConfig，其中 finalInput 文案称包含预设、世界书和格式化消息。实际后台可返回哪些字段、是否脱敏、是否保留本次记录，仍需正常授权 UI 实测。此静态检查没有读取任何受保护诊断记录，也没有试图伪造角色作者或权限。

## 尚不能得出的结论

- 不保证当前游客 profile.isLoggedIn 为 true、上传/保存可用或创建成功。
- 不保证未上架卡必定支持完整 assembly record。
- 不保证 model 字段为上游厂商/真实基座而非站内别名。
- 没有获得 DZMM 后端 prompt 组装代码或底层模型权重身份。
