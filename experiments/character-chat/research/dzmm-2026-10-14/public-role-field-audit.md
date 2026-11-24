# 公开角色页原始字段边界核验

2026-10-14，Asia/Shanghai。只读主代理正常无凭证 GET 保存的 [目标角色页](https://www.dzmm.ai/character/3619318?category=sfw)。未执行脚本、调用外部 API、操作浏览器，或读取账户/会话数据。

来源文件：public/sfw-role-3619318.html；330234 bytes；SHA-256 `8ca6a9f95bdde02b71691b2924f6c69e72a8e3bba2837cbd46716a95ff5ca475`。仅核验这个已保存响应，不代表登录态聊天接口或全平台策略。

## 结论

目标 characterData 对象没有独立 personality、scenario、system_prompt、character_book 或对应 camelCase 原始字段。取得的是公开介绍与展示配置；firstMes 和 chatHistory 虽有字段，当前分别为空字符串、空数组。不能据此称为完整原始角色卡或后台 prompt。

目标绑定由 canonical 角色 URL、characterData.id:3619318 和同一预加载对象中的 numericId:3619318 交叉核验，没有采用其他卡或推荐内容。

目标对象 30 个顶层属性如下（只列名字，不复制角色正文）：

`id`、`name`、`cardFilename`、`isPublic`、`isSensitive`、`isImageBlur`、`isHidden`、`isGamefy`、`gameOrientation`、`userId`、`creatorNotes`、`firstMes`、`chatHistory`、`imageInfo`、`avatarUrl`、`tags`、`suggestedReplies`、`publishStatus`、`createdAt`、`firstPublishedAt`、`creatorFullName`、`creatorAvatarUrl`、`creatorBio`、`creatorDonationEnabled`、`creatorDonationMessage`、`popularityScore`、`weightedRating`、`blurNsfwImages`、`coverAnimatedUrl`、`originalFilename`。

creatorNotes 字面量经纯 JSON 解码有 508 字符，与同页 CreativeWork JSON-LD description 逐字相等；解码后的 UTF-8 SHA-256 为 `2f85b3a9b11018f37eab2537a5638a2c985eba4e8f96b6350dfaa2fa3087223b`。它是公开介绍，虽然内容可以描述性格与场景，也不等于独立原始 personality/scenario 字段。

## 全文命中要归属对象

精确搜索 personality、system_prompt、character_book、characterBook 均为 0 次。systemPrompt 有 4 次，scenario 有 23 次。

这两类命中均是通用 i18n 文案，不在目标 characterData 对象。systemPrompt 的四个 key 是 systemPromptContent / systemPromptContentHint / systemPromptContentPlaceholder / systemPromptRequired；scenario 命中是团本菜单、通用向导等翻译 key。因此全文关键词命中不构成目标卡原始字段泄露的证据。

## 原始字节位置

以下是直接由原始 UTF-8 字节解码得到的零基 byte、一基 line。保留了响应的 CRLF，未采用换行归一化后的偏移；每个短段均按原始文件字节回验。

目标 characterData 对象 span：**[320983, 323896)**，line 533。使用平衡括号/字符串扫描提取，未执行 hydration 代码。creatorNotes 的字符串值 span：**[321324, 322760)**。

| 项 | byte / line | 最短原始片段 |
|---|---|---|
| canonical | 10723 / 58 | `rel="canonical" href="https://www.dzmm.ai/character/3619318"` |
| 目标预加载对象 | 320962 / 533 | `characterData:$R[24]={id:3619318` |
| 目标数字ID | 324027 / 533 | `numericId:3619318` |
| 公开介绍字段 | 321311 / 533 | `creatorNotes:` |
| 开场与历史为空 | 322761 / 533 | `firstMes:"",chatHistory:$R[25]=[]` |
| 展示数组 | 322795 / 533 | `imageInfo:$R[26]=[]` |
| 审核状态 | 322953 / 533 | `publishStatus:"approved"` |
| 通用预设文案 | 173176 / 504 | `systemPromptContent` |
| 通用场景文案 | 33366 / 504 | `"scenario":"团本"` |

未观察到独立字段只能说明本次公开响应未下发；不能推断后台未使用它们，或它们在其他授权接口必然可见。当前没有从这个公开 HTML 取得任何实际生成诊断。
