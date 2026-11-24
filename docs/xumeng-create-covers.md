# 创作页封面（生图模型出品）

- 模型：TokenHub 国际站 `wand-vega-image-lite`（`xumeng-gen/lib/image-lite.mjs`，密钥在 `xumeng-gen/.env.local`）
- 尺寸：生成 1536×1024，落盘缩到 1200 宽 JPEG（横幅 1600 宽），存 `public/dzmm/content-covers/create-*.jpg`
- 发布链路：`cloudflare/dzmm-web/scripts/copy-assets.mjs` 白名单 + `worker.ts` 的 `PUBLIC_ASSET_FILES` 白名单，线上路径 `/assets/xumeng/content-covers/create-*.jpg`
- 统一风格前缀：`明亮温暖的高级时尚写真，柔和金色与粉色光，细腻肌肤质感，性感迷人，电影级布光，画面纯净无文字，无 logo，横向构图。`

## 各图提示词（主体部分）

| 文件 | 主体提示 |
| --- | --- |
| create-hero.jpg | 超宽横向构图，明亮复古卧室，丝绸睡裙女性斜倚在铺满玫瑰与角色卡的床榻上，暖金晨光，右侧留暗色空白 |
| create-role.jpg | 年轻女性坐在复古梳妆台前回头看向镜头，丝绸吊带滑落肩头，暖金灯光，角色卡、羽毛笔、红玫瑰 |
| create-novel.jpg | 女性倚在丝绒沙发读旧书，薄纱睡裙，暖色台灯与天光，慵懒性感，红玫瑰 |
| create-girlfriend.jpg | 女友视角：蕾丝吊带睡衣的女性靠近镜头温柔微笑，暖粉床头灯，床单与玫瑰花瓣 |
| create-game.jpg | 性感女玩家穿吊带背心握着手柄，霓虹与暖灯混合，俏皮挑逗，游戏海报与手办 |
| create-scenario.jpg | 三位魅力角色在明亮会客厅围坐，丝绸礼服与衬衫，烛光红酒，优雅暧昧群像 |
| create-generate.jpg | 摄影棚里穿丝绸浴袍的模特在柔光下摆姿势，相机反光板，暖金色调 |

## 调整方式

改提示词后按上面流程重新生成、覆盖同名文件即可；两张白名单都要保留同名条目。


## v2 更性感版（2026-11-20）

- 风格前缀：`明亮柔和的暖粉色写真，性感撩人的氛围，肌肤质感细腻，高级成人写真风格，画面纯净无文字，无 logo，横向构图。`
- 主体：蕾丝内衣/丝绸睡袍/湿发/近景女友视角/长腿交叠/多人暧昧群像等（模型可出性感但不露点）。
- 同时移除了横幅上的文字叠加（标题/说明/CTA），卡片只保留一个半透明标题胶囊，副标题小字也去掉。
- 文件同名覆盖即可。


## v3（2026-11-20，当前线上）

- 横幅换成更 spicy 的「男女亲密相拥」暖光卧室图；页面标题「开始一段新创作」和「返回主站」按钮移除，仅保留横幅左下角「创建角色 + 人设/开场/世界书」文字与右侧箭头。
- 卡片仅保留标题胶囊，去掉了副标题小字。


## 顶部广告位 banner（2026-11-20）

- 创作页顶部是可左右滑动的**广告位**，与下方创作入口不重复；当前放了 3 张站内推广：会员 / 金币充值 / 邀请好友（点击分别去 vip、recharge、invite）。
- 图片：`public/dzmm/content-covers/promo-{member,recharge,invite}.jpg`（1200 宽 JPEG，生图模型同款流程）。
- 代码位置：`src/components/dzmm/creator-center.tsx` 里的 `PROMO_COVERS` 和 `banners` 数组；轮播组件 `BannerCarousel` 支持自动圆点、左右箭头、触摸滑动。
- 以后接真实广告：新增图片（或外链图）+ 在 `banners` 数组加一条 `{ key, cover, title, hint, run }`；`run` 里 `onRoute(...)` 跳站内页，外部链接可直接改 `banners` 为 `<a>` 或扩展 `href`。
- 新增图片文件同时要加两处白名单：`cloudflare/dzmm-web/scripts/copy-assets.mjs` 的 `files` 和 `worker.ts` 的 `PUBLIC_ASSET_FILES`。


## 资源格式（2026-11-20）

- 首页 hero（3 张）与创作页封面/广告图全部转成 **WebP**（quality ~80，宽度 1200/1600），体积下降约 65–75%；
- 文件：`public/dzmm/home/hero-*.webp`、`public/dzmm/content-covers/*.webp`；
- `copy-assets.mjs` 的 content-covers 校验已同时支持 JPEG/WebP；
- 首页 hero 自动轮播 5.2s、创作页广告位 6s，hover/焦点/触摸暂停，`prefers-reduced-motion` 下不自动切换。
