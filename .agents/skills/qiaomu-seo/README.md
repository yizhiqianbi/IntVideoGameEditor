# qiaomu-seo

> 用于 Google、Bing 与 AI Search 的专业 SEO Agent Skill：技术 SEO 审计、关键词—页面策略、自然流量诊断、站点迁移、代码修复与效果验证。

[![GitHub stars](https://img.shields.io/github/stars/joeseesun/qiaomu-seo?style=flat-square)](https://github.com/joeseesun/qiaomu-seo/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/joeseesun/qiaomu-seo?style=flat-square)](https://github.com/joeseesun/qiaomu-seo/commits/main)
[![License](https://img.shields.io/github/license/joeseesun/qiaomu-seo?style=flat-square)](LICENSE)

`qiaomu-seo` 不是检查 title 字符数、H1 数量和关键词密度的打分器。它按照真实的搜索链路工作：

**爬虫访问与 URL 发现 → 抓取与 JavaScript 渲染 → 可索引性（indexability）→ canonical / hreflang → 页面相关性与搜索意图 → 内链与信息架构 → 搜索表现测量。**

## 它解决哪些 SEO 问题

- **页面不收录或收录异常**：检查 robots、状态码、渲染、索引指令、canonical、sitemap、内链发现与 Search Console 证据，定位阻塞发生在哪一层。
- **自然搜索流量下降**：按页面、查询、国家、设备、搜索类型和时间切片，区分技术故障、需求变化、内容衰退、迁移影响与数据口径问题。
- **关键词没有对应落地页**：研究搜索意图与主题关系，生成 keyword-to-page map、内容 brief、页面新建/合并/改进建议，避免关键词互相竞争。
- **技术 SEO 需要落地**：审计并修复 canonical、redirect、sitemap、robots、metadata、JSON-LD、hreflang、分页、内部链接和 JavaScript 渲染问题。
- **网站改版或迁移**：建立 URL inventory、重定向映射、canonical/hreflang/sitemap 一致性检查、上线监控和回滚边界。
- **电商、国际化和大型站点**：检查商品变体、分类/筛选页、程序化页面、多语言/多地区信号，并按模板抽样说明实际覆盖率。
- **AI Search 可见性**：分别检查 Google AI Overviews / AI Mode、ChatGPT Search、Copilot 与 Perplexity 的基础可访问性和供应商边界，不把传统 SEO、模型训练和 AI 引用混为一谈。

## 你会得到什么

| 输入 | 交付物 |
|---|---|
| 网站 URL、代码、渲染页面、sitemap 或 crawl 文件 | 按影响、置信度、工作量和依赖排序的技术 SEO 问题清单 |
| Search Console、Bing Webmaster Tools、分析数据或服务器日志 | 分段后的流量/索引诊断、候选原因、缺失证据与下一步验证 |
| 产品、受众、市场和关键词数据 | 搜索意图分析、keyword-to-page map、内容 brief 与站点架构建议 |
| 迁移计划或新旧 URL inventory | URL 映射、redirect/canonical/hreflang/sitemap 检查与监控方案 |
| 明确授权修改的网站代码 | 最小化代码修复、变更记录、测试结果、回滚信息和复查时间点 |

每个结论都会标明它是**直接观察、合理推断还是缺少证据**。影响和置信度分开表达，不编造搜索量、关键词难度、排名、流量或竞品数据，也不承诺排名、收录、富结果或 AI 引用。

## 安装

一行安装到 Codex、Claude Code、Cursor 等兼容 Agent Skills 的工具：

```bash
npx skills add joeseesun/qiaomu-seo
```

安装后可用下面的命令确认 skill 已被发现：

```bash
npx skills add joeseesun/qiaomu-seo --list
```

### 前置条件

- [ ] 已安装 Node.js：运行 `node --version` 检查；未安装时从 [nodejs.org](https://nodejs.org/) 获取 LTS 版本。
- [ ] 可运行 npm/npx：运行 `npx --version` 检查；它会随 Node.js 一同安装。
- [ ] 使用支持 Agent Skills 的客户端，并允许它读取本机 skills 目录。

## 你可以直接这样说

- “抓取并渲染这个网站，找出为什么产品页没有进入 Google 索引。”
- “分析这份 Search Console 导出，按页面和查询定位过去 90 天自然流量下降的原因。”
- “为这个 SaaS 做关键词研究和 keyword-to-page map；没有工具数据的指标标记 unknown。”
- “修复这个 Next.js 项目的 canonical、sitemap、robots 和 Product JSON-LD，并验证渲染结果。”
- “为网站迁移生成完整 URL redirect map，检查 canonical、hreflang 与 sitemap 是否一致。”
- “审计多语言电商站的商品变体、faceted navigation、分页和 hreflang。”
- “分别检查 Google AI Overviews、ChatGPT Search 和 Perplexity 的抓取与可见性基础，不承诺引用。”
- “为这批内容页设计 SEO 实验，定义处理组、对照组、观察窗口和停止规则。”

## 专业边界

- **审计 / 诊断 / 比较**默认只读，不修改代码、索引控制、站长平台或线上数据。
- **修复 / 实现**只在明确授权后执行，并保留修改前证据、测试结果、回滚信息和监控窗口。
- robots.txt 控制抓取访问，robots meta / X-Robots-Tag 控制受支持的索引与展示行为，canonical 是偏好信号，sitemap 与 IndexNow 是发现/变更通知；它们都不保证收录。
- Schema.org 语法有效、Google 搜索功能资格和实际出现富结果是三个不同层级。
- Lighthouse 等实验室数据用于诊断；Core Web Vitals 现场数据描述真实用户分布，二者不互相替代。
- 不覆盖付费搜索投放、App Store Optimization、垃圾外链、隐藏内容、关键词堆砌或排名保证。

## 1.2 专业能力升级

- 登记并定期复查 33 个 Google、Bing、IndexNow、Schema.org、web.dev、OpenAI、Microsoft 和 Perplexity 官方来源。
- 对平台规则记录来源、复查日期和功能生命周期，自动拦截已知陈旧断言。
- 分离 Schema.org 语法、搜索功能资格和实际展示；分离 IndexNow 接收、抓取与索引结果。
- 增加国际 SEO、电商、图片/视频搜索、程序化 SEO、内容治理、性能测量和 SEO 实验模块。
- 区分 OAI-SearchBot、GPTBot、ChatGPT-User 与其他 AI crawler 的用途和控制边界。

设计依据、竞品 skill 取舍与验证记录见 [`reports/creation-handoff.md`](reports/creation-handoff.md)。

## 验证

```bash
python3 scripts/validate_skill.py .
python3 scripts/validate_knowledge.py . --strict-stale
python3 scripts/validate_audit.py path/to/audit.json
python3 ~/.agents/skills/qiaomu-meta-skill/scripts/export_skill_ir.py . --output reports/skill-ir.json
python3 ~/.agents/skills/qiaomu-meta-skill/scripts/trigger_eval.py . --cases evals/trigger_cases.json --output reports/trigger-eval.json
```

## Troubleshooting

| 问题 | 处理 |
|---|---|
| 没有 Search Console 或关键词工具 | 做定性研究，把搜索量、KD、覆盖率标记为 `unknown` |
| 静态抓取看不到 JSON-LD | 检查渲染后的 DOM，或使用 Rich Results Test |
| 想知道是否被索引 | 优先使用 Search Console URL Inspection；不要把 `site:` 查询当完整索引报告 |
| 只想审计，不想改站 | 使用“审计/诊断/比较”措辞；skill 会保持只读 |
| 官方规则可能变化 | 查看 `data/seo-source-registry.json` 并运行 `validate_knowledge.py` |
| Schema 验证通过但无富结果 | 分别检查语法、当前功能资格、页面政策和实际展示 |
| Lighthouse 满分但 CWV 未通过 | Lighthouse 是实验室诊断；检查 CrUX、Search Console 或真实用户现场数据 |

## 版权

Copyright (c) 向阳乔木  
X: https://x.com/vista8  
GitHub: https://github.com/joeseesun/

<!-- qiaomu-profile:start -->
## 关于向阳乔木

向阳乔木（乔向阳 / Joe）是一位实践型 AI 产品与内容创作者，长期把前沿 AI 变化转译成可复用的工作流、产品判断、AI 编程实践、AI 搜索实践和 GEO/AI 营销方法。

- 个人网站: https://qiaomu.ai
- 博客: https://blog.qiaomu.ai
- X: https://x.com/vista8
- GitHub: https://github.com/joeseesun/
- 微信公众号: 向阳乔木推荐看

### 支持与关注

| 打赏支持 | 微信公众号 |
|---|---|
| <img src="assets/qiaomu-profile/qiaomu_reward_qr.png" alt="向阳乔木打赏二维码" width="180" /> | <img src="assets/qiaomu-profile/qiaomu_wechat_public_account_qr.jpg" alt="向阳乔木推荐看公众号二维码" width="180" /> |
| 感谢支持乔木持续分享 AI 实践 | 扫码关注「向阳乔木推荐看」 |

<!-- qiaomu-profile:end -->

## License

MIT
