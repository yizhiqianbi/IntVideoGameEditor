# 我的页充值 Banner · 设计与实现（金币 / Gem）

## 位置

`#profile` 登录后的“我的”页，**账户信息卡片内部、余额上方**（你红框标出的区域）。
整条 banner 与卡片同宽、贴住卡片上沿；下面继续是金币 / Gem 余额。
游客页不显示；没有 `onRecharge` 时退回原来的“账户信息”标题行。

## 代币命名

- 不再使用 Credit / 梦币
- 两种代币：**金币**、**Gem**
- 本卡片内：`金币`（原 Credit 余额）、`Gem`（原梦币，可兑换金币）
- 文案与余额标签都已切换；其他页面仍有旧词，见文末“范围”

## 文案

- eyebrow：账户信息
- 标题：充值金币 / Gem
- 说明：金币和 Gem 可用于短剧解锁、游戏/角色卡、陪聊。
- CTA：充值 → 点击走现有 `onRecharge`，进入充值中心

## 视觉

- 背景：AI 生图（暗玫红 + 黑金、金币 + 玫红宝石 + 玫瑰花瓣 + 粒子光晕，右侧主体、左侧留字）
- 画面中**不出现任何文字/字母/logo**（上一版硬币上的 Credit 已去掉）
- 前景：左侧压暗渐变保证文字可读，右侧保留金币与宝石高光；底部一条玫红细线
- 按钮：白色胶囊“充值 ›”压在右下角
- 尺寸：390px 下 banner 高约 150px；≤520px 140px；≤380px 132px
- 生成图原图 1920×1088，裁成 1600×500 WebP（51KB），放在 `public/dzmm/recharge-banner.webp`

## 生图 Prompt（可复用）

> 以参考图的光影、材质和配色为风格，生成一张高级的 16:9 横版充值活动横幅背景。深玫红与黑金配色，右侧是漂浮的发光金币、玫红色宝石水晶和金色玫瑰花瓣，柔和粒子光晕，左侧保留大面积干净深色负空间用于放文字，电影感体积光，奢华、克制、精致。画面中不要出现任何文字、字母、数字、logo 或水印，不要出现人物。

模型：AIAPI `qwen_image21_multi_image_edit`（16:9，参考图 1 张）。

## 代码改动

| 文件 | 改动 |
| --- | --- |
| `src/components/dzmm/profile-settings.tsx:162` | 账户卡内插入 `.mineRechargeBanner`，点击走 `onRecharge` |
| `src/components/dzmm/profile-settings.tsx:174` | 余额标签改为 `copy.coinBalance` / `copy.gemBalance`，Gem 说明改为“可兑换金币” |
| `src/components/dzmm/profile-settings.module.css:222` | banner 生图背景、压暗渐变、CTA、520/380px 响应式 |
| `src/lib/xumeng-page-copy.ts:313` | 新增充值 banner、金币/Gem 余额、兑换说明五语言文案 |
| `public/dzmm/recharge-banner.webp` | 生图裁切后的 banner 背景 |

## 验证

- 相关文件 TypeScript 检查通过（exit 0）
- 本地 `next dev`：`/assets/xumeng/recharge-banner.webp` 200（image/webp）
- 390 / 360px 静态预览通过，无横向溢出
- 全量 `next build` 仍被既有 `cloudflare:workers` 类型声明问题阻断（`src/app/api/...`，与本次改动无关）；未做登录态真实页面截图

## 范围

本次只改“我的”页账户卡与 banner。全站其他页面（充值中心、VIP、新手任务、计费说明等）仍有 Credit / 梦币文案；要做全站统一，需要单独一轮替换和回归，映射为：
- Credit → 金币
- 梦币 → Gem
