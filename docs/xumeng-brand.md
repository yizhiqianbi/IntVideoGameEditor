# 叙梦品牌

视觉方向：用一个玫瑰色的月牙对话气泡和星点，把交流、想象与故事放进同一个简洁标记；透明矢量标记兼容深色和浅色页面。

展示位置：页首标记与「叙梦 / XUMENG」字标、安装页、浏览器标签、主屏幕图标。角色目录的来源说明保留。

交互：点击页首品牌返回角色广场，沿用导航的聚焦与悬停反馈；图形保持静止，避免干扰阅读。

标记源文件：`public/dzmm/brand/xumeng-mark.svg`。尺寸和 ICO 由 `node cloudflare/dzmm-web/scripts/build-brand.mjs` 生成。线上资源路径为 `/assets/xumeng/brand/`。

网页图标：页签使用原创 ICO、192px PNG 和 SVG；`/favicon.ico`、`/icon.svg`、两个默认 Apple 图标地址及根目录 manifest 地址直接返回叙梦资源，避免静态应用回退成首页 HTML。搜索结果中的图标需要搜索引擎重新抓取首页后更新。

新站入口为 `/`，页面继续使用 `#characters`、`#chat` 等现有导航。旧 `/dzmm` 仅作兼容跳转。按用户明确的搜索偏好，`/nsfw`、`/porn` 允许抓取并以 `302` 直接跳转主站，不加入导航，不生成独立内容页。主站提供 canonical、index/follow 元信息和仅列真实首页的站点地图。开放抓取及跳转不保证关键词排名或实际收录。
