# 自建未公开测试卡的正常界面路径：静态核验

日期：2026-10-14。只读已下载的官方公开前端文件；未调用账户、角色创建或诊断接口，未操作浏览器、创建角色、读取凭据。该笔记是手工静态检查，不是新的 REA 运行或实际权限测试。

## 当前结论

已有证据支持“完成角色”和“上架公开”分离，不能因编辑器内部方法名 `publish` 就把按钮当作公开发布。实际中文按钮是“完成角色”；未上架作品的官方编辑器提示是其他用户看不到。游客禁止的是“上架”，现有资料尚未证明游客也不能保存或完成自己的未公开角色。

因此自建未公开中性测试卡是一个可用的候选验证路径，但目前只能建议先从正常创作者界面检查。不能将“游客可完成角色”或“创建默认私密并可聊天”写成已实测。父布局与具体创建 mutation 的已声明依赖尚不在现有语料中，后台也可能拒绝游客。若正常界面要求注册、付费或上架公开，应在这个边界停止，不能为了取得诊断而改用接口绕过。

## 路由和按钮

`D12SqV8q.js`，SHA-256 `5dfcb47b825471d5aa49e26333aeef04826ce688702874631f223c794938f420`，官方 URL <https://www.dzmm.ai/assets/D12SqV8q.js>：

- raw byte 1560879，line 57：`G(\`/(studio)\`)({component:...import(\`./BuXTsyiw2.js\`)})`。这个路由声明本身没有 `beforeLoad`，但不证明组件内部没有权限检查。
- raw byte 1584206，line 57：`G(\`/(studio)/studio/\`)`，组件是 `./BBRVsSwV2.js`。
- raw byte 1607784，line 57：`G(\`/(studio)/studio/edit/\`)`，组件是 `./CT6ZjuS1.js`。`Mqe` 允许 `mode=quick/full`、`step=basic/dialogue/worldbook/voice/preview`、`draft`、`character` 查询参数。

`CT6ZjuS1.js`，SHA-256 `815b298adf38ec7d37361ddc4cf25ed1d3564d03db24edf366365adf570cd641`，官方 URL <https://www.dzmm.ai/assets/CT6ZjuS1.js>，以下位置均 line 1：

- raw byte 81981，`$()`：有 `character` 时编辑已有角色；有 `draft` 时编辑草稿；否则 `editorMode=create`。这不是账户授权判断。
- raw byte 83093，`Fr()`：最后一步调用 `onPublish`，显示 `components.wizard.publish`；进行中显示 `components.wizard.publishing`。
- raw byte 98813，`ei()`：`createOrUpdateCharacter` 从当前 CCv3 编辑数据构造请求；普通封面分支 raw byte 99639 为 `c({rawData:e,dbId:...,draftId:a})`；动画封面分支使用 `studio.publishWithAnimatedCover`。该层没有 `isPublic/private/visibility` 创建参数；不能推断后台默认值。
- raw byte 100292，`ti().publish`：执行 `await d()` 后导航 `to:/character/$id`，不是在这层调用 `publishCard` 等上架接口。
- raw byte 101129，`saveAndExit`：先等待草稿自动保存，成功后回 `/studio`；这一步不是创建可聊天角色的证明。
- raw byte 97069，`Qr`：草稿自动保存的默认 debounce 是 800ms，并在 pagehide / document hidden 时 flush；没有看到在草稿上直接开始聊天的按钮。
- raw byte 17022 / 17405，创建校验：名称非空且不超过 255 个 Unicode 字符、头像、至少一张图库图；对话列表至少一组，包含 AI 消息，最后一条不能是用户消息。其他世界书 / 建议回复校验仍适用。自建中性测试卡不能仅填一句 system prompt 就假定提交成功。

`Bv7Q1B9Q2.js`，SHA-256 `ddaf04d2b5d53e54d2825ee19ec4da7357b6aad4c07b918ffac0aa78839af415`，官方 URL <https://www.dzmm.ai/assets/Bv7Q1B9Q2.js>，line 1：

- raw byte 87990：`"publish":"完成角色"`；raw byte 88015：`"publishing":"保存中..."`。这是上面的按钮实际中文标签。
- raw byte 91006：`unpublishedDescription` 描述作品没有公开、其他用户看不到，并要求完成角色之后再到角色页点“上架”。同段注明游客与非 VIP 不能上架。它是未上架状态说明，不能单独证明每次创建的后台默认值或游客创建成功率。
- raw byte 93014：创作者中心的 `quickActions` 有“创建角色”；raw byte 91484 附近 `dashboard.startCreating` 有“开始创建”。正常入口是 `/studio`，再点击创建相关控件；此处只核验了资源字符串，创作者中心组件尚未读到。

`D58JO2kB2.js`，SHA-256 `5e6e69940d27153452b512955969699710d2097fd785424a42030ad9fb8c52d1`，官方 URL <https://www.dzmm.ai/assets/D58JO2kB2.js>，raw byte 119454，line 1：`eligibilityGuest` 明确游客不能上架角色卡，需要正式账户并成为 VIP 后才可上架。不要把这一条扩大为“游客不能创作草稿或未公开角色”。

## 作者诊断能看到哪些层

角色作者与会话所有者必须区分。普通角色页的诊断门控使用的是 `card.getForChat` 所填充角色数据的 `userId` 与 `profile.id` 比较。自己的游客会话使用别人的角色卡，不满足作者条件。完整来源链见同目录 `diagnostics-access-gate.md`。

即便自己完成了角色，`canViewPromptAssemblyDebug` 仍要求作者身份、有效 chatId/generationId，以及官方 assembly access probe 返回 true；或 profile 本身有 `canViewDebug=true`。不能保证自建卡必定获得最终输入记录。

`Dm7jYsLH.js`，SHA-256 `9d2395c17871b85712ecbc58a56cfdb8bb91b23043ff080b95dfbefdd261ea53`，官方 URL <https://www.dzmm.ai/assets/Dm7jYsLH.js>，line 33：

- raw byte 106069，`Ms()`，只在 `canViewPromptAssemblyDebug` 成立且生成 ID 存在时启用查询；取返回的 `record`。
- raw byte 109607：最终输入页直接传 `value:m.finalInput` 给 `As`；原始输入同样传 `m.originalInput`；元数据页渲染 `m.config` 与 `m.generationConfig`。
- raw byte 104957，`As`：若输入是 JSON 消息数组，按每条 `role` 与 `content` 显示；否则以原字符串显示。这里没有按 system/user/assistant 筛掉平台层，也没有按“作者身份”再做一套前端脱敏。
- raw byte 107753：`!f && m.model` 控制模型 badge，其中 `f=trialExperiment.modelLocked`。这只证明试用锁定时模型 badge 不显示，不能推导 `finalInput` 一定脱敏或一定完整。

`D58JO2kB2.js`，raw byte 67718，line 1，assembly 说明把“最终输入”描述为本次系统拼装并发给模型的完整内容，包含预设、世界书和格式化后的消息。客户端设计目的因此是核对真实组装结果，而非仅显示用户自己的编辑字段。

边界：这些都是前端契约与公开界面文案。尚无实际获授权的 assembly record，因此不能断言作者看到的平台私有 identity/contentguide 一定完整、未脱敏或总是保留。服务端 access 授权、字段过滤、记录保留和不同模型实际可用性都需正常界面实测。

## 精确已声明但本地缺失的依赖

不猜资源名；以下都来自现有代码中的精确 import：

1. <https://www.dzmm.ai/assets/BuXTsyiw2.js>：D12 raw byte 1560925；studio 父布局，需核验注册/游客门控。
2. <https://www.dzmm.ai/assets/Bwt0DeR8.js>：CT raw byte 2037：`import{n as ot,r as st,t as ct}...`。`st` 是普通角色创建/更新 mutation hook，`ot` 是 hideCharacter hook，`ct` 是已有卡读取 hook。
3. <https://www.dzmm.ai/assets/BBRVsSwV2.js>：D12 raw byte 1584260；studio 创作者中心，需核验创建控件实际导航。

尚未对这些缺失文件采集、执行或调用任何请求。先前 10 个核心来源与 REA 证据保持不变。
