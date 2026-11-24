# NariYume 官方公开技术证据

查阅日期：2026-10-12（Asia/Shanghai）。只阅读官方公开网页及其公开链接；没有登录、注册、购买、发送对话、联系作者或探测后台。这里的“明确披露”指官方文字明确说过，不等于已经验证当前部署。网页行号是本次网页阅读工具的文本定位，随页面更新可能变化。

## 关键结论

官方确认它有推理代理、结构化记忆、情绪与好感状态、角色分别保留的对话，以及语音和实时动画运行时。公开文档没有给出当前 LLM 型号、完整 prompt、记忆检索算法或状态更新公式。不能仅凭聊天风格判定是 Grok，也不能仅凭语音体积判定是 Kokoro。

## 明确披露与边界

| 编号 | 证据与原文位置 | 可确认的内容 | 仍不能确认的内容 |
|---|---|---|---|
| E01 | [Support](https://www.nariyume.com/support)，`What AI model powers Nari?`，本次 L43–45 | LLM 经其推理代理接入，具体模型可能随质量改进变化。 | 没有披露模型名、版本、训练方式、推理参数或路由规则。 |
| E02 | [Privacy Policy](https://www.nariyume.com/privacy)，§2.2，L18–20 | 保存从对话提取的事实、实体、关系记忆及情绪、好感状态。 | 未披露提取器、schema、向量库或衰减规则。 |
| E03 | 同上，§4，L57–62 | 模型及语音请求经过其控制的基础设施；上下文可含近期对话、记忆、笔记、姓名、生日摘要及授权设备摘要。 | 没有给出 prompt 拼装顺序或服务商名称。 |
| E04 | 同上，§2.3 / §2.6，L21–23 / L38–43 | 语音会转成文本；iOS 可选日历、粗略位置及主动附图可形成上下文。 | 不代表当前 web 具有相同设备权限；未披露 STT 型号。 |
| E05 | 同上，§4，L62 | 个性化回复和音频不刻意放入应用缓存，共享脚本录音可缓存。 | 不能断言所有语音都是实时生成，也不能断言没有任何临时缓存。 |
| E06 | 同上，§6 / §11，L69 / L115 | 使用托管认证、云存储、服务端授权及 TLS 等基础设施类别。 | 没有命名云、数据库或认证厂家。 |
| E07 | [Support](https://www.nariyume.com/support)，`I signed out but my data is still there`，L34–36 | 明说 web 聊天历史保留在原浏览器，不随用户转到其他浏览器或设备；iOS 有符合条件的云同步。 | 不宜把总隐私政策的跨设备概述直接套在当前 web 聊天上。 |
| E08 | [Support](https://www.nariyume.com/support)，`Voice mode doesn't work on launch`，L37–39 | 当前 web 通话使用在线转写，不要求浏览器语音识别引擎或下载识别模型。 | STT 服务名、VAD、打断及音频格式没有披露。 |
| E09 | [Koro Interactive](https://www.korointeractive.com/)，`Real-time character rig`，L47–53 | 厂家称角色采用实时物理运动、表情与口型绑定，web/native 共用渲染器。 | 未披露具体渲染库；不应把“model”一词中的角色模型误读成 LLM。 |
| E10 | 同上，`Real-time neural voice`，L55–60 | 厂家声称角色语音量化后约 67 MB、设备端运行、首段音频约 150 ms。 | 这是营销技术指标，并非此次测量；没有模型名、设备条件或完整延迟定义。不能由体积认定 Kokoro。 |
| E11 | 同上，`One character runtime` / `Built on Koro: NariYume`，L70–72 / L90–92 | 厂家称单一 persona 定义跨端一致，NariYume iOS 采用同套实时动画、神经语音及设备端运行时。 | 不足以证明当前 web 每个功能都走端侧；没有 persona 文件内容或 prompt。 |
| E12 | [Premium](https://www.nariyume.com/premium)，`Nari and Yume` / `Letters that remember`，L36–38 / L70–72 | 每个角色保留自己的对话与记忆；信件依据已有交流写成，最多每日一封。 | 没有披露信件由定时任务还是访问触发、哪种模型生成，或它是否等于实时聊天主动发言。 |
| E13 | [首页](https://www.nariyume.com/)，`Long-term memory` / `A slow burn`，L60–73；[FAQ](https://nariyume.com/faq)，`Does she remember me?`，L72–74 | 宣称共同历史跨周、月保留，随交流逐渐开放。 | 不能据此推断确切关系等级阈值、情感算法或某种 agent 架构。 |
| E14 | [Studio note](https://www.nariyume.com/studio)，`Start with a conversation` / `Meet Nari` / `Meet Yume`，L12–27 | 设计目标包含角色自己的生活细节、不同看法、共享经历及下次访问可延续的内容。Nari 咖啡店与偶像愿望；Yume 商科、竞技与烹饪。 | 是创作方向声明，未披露自主生活模拟器、日程引擎或原始角色卡。 |
| E15 | [Safety](https://www.nariyume.com/safety)，`Our self-harm & suicide protocol`，L15–20 | 官方称每条输入有独立于模型回答的确定性危机筛查，固定资源通知；安全指令优先。 | 不知道实际检测规则、模型或误报率；不是此次安全评测。 |
| E16 | [Security](https://www.nariyume.com/security)，`How we protect your account`，L24–29；[Support](https://www.nariyume.com/support)，L40–42 | 官方命名 Stripe 为 web 支付处理方；iOS 使用 Apple 购买。 | 只能证明支付类别，不能反推 LLM、存储或托管厂商。 |

## 证据之间的差异

- **存储范围**：隐私政策 §2.2 / §3 以 App 整体描述跨设备延续；Support 明确给出 web 浏览器本地历史限制。应保留这个差异，当前 web 数据流优先参考平台专属说明，不能声称已确认聊天全面云同步。
- **端侧语音与 web 转写**：Koro 宣称轻量端侧 TTS，Support 明确 web STT 在线。这两者分别是输出与输入链路，彼此不矛盾；尚不能把厂家 iOS 运行时说明扩大到当前 web TTS。
- **主动性**：每日信件、角色社媒与聊天中的无用户输入主动发言属于不同机制。公开材料足以确认前两类产品/运营能力，未能确认最后一类的触发策略。
- **关系与人设**：持久化情绪/好感状态已经有官方依据；向量检索、planner–actor、自动 world simulation、多模型 ensemble 等都仍只是候选实现。

## 方法与未获得的来源

公开检索覆盖 NariYume、Koro Interactive 与其技术关键词。官方首页链接的 X 账号是 [NariYumeAI](https://x.com/NariYumeAI)，此次网页抓取返回 403，因此没有把第三方社媒镜像当成技术确认来源。官方 `/nari`、`/yume` 链接本次返回 404。没有找到公开论文、官方源码库或详细工程博文；这是本次检索未找到，不代表不存在。

## 历史供应商线索的重新核验

已有本地 [2026-10-06 调研笔记](/Users/pencil/.codex/visualizations/2026/10/06/01a11155-4d95-7f50-8335-43e35a05693b/nariyume-technical-research.md:11) 记录：当时搜索索引显示的 2026-09-10 旧版官方隐私政策提到 DeepSeek（对话、游戏、记忆）、Gemini（附图与回退）、OpenRouter / Cloudflare Workers / 可选 AI Gateway（推理路由）、Groq（web 转写）、自家服务器或 Modal（托管语音）。笔记给出的来源仍是同一个 `/privacy` URL，没有保存可逐字核对的旧原页或独立存档地址。

2026-10-12 重新检索了带引号的 `nariyume.com/privacy + DeepSeek`、`NariYume + Groq + Modal`、`NariYume + OpenRouter`、`NariYume + Gemini`，均未返回相关旧摘录；再用官方域名过滤、去引号及旧日期组合查询，只得到当前泛化版页面。本次没有复现旧原文。

因此这些名称的证据级别只能是**先前研究记录中的历史线索，原始旧页面本次不可复现**，不能升级成今日厂家披露，也不能写“已确认现在使用 DeepSeek / Groq”。当前公开官方证据只支持 E01 / E03 的自控代理与可变第三方提供商。旧线索应保留用于以后核验，不应完全丢掉或伪装成已经重新确认。

官方 [Terms §4](https://www.nariyume.com/terms)（L17–26）对自动化 App 交互及超过法律许可的专有资产提取列有限制。此次仅作公开文档调研，没有执行这类交互或资产提取，也没有就其法律适用作判断。官方 [Security](https://www.nariyume.com/security) L14–23 的善意安全研究说明不等于对任何资产提取的授权，本次没有做漏洞测试。

## 对我们原型最有依据的借鉴

可以独立实现：角色分开保存上下文；事实/实体/关系记忆与短期对话分层；情绪和关系状态独立于纯文本回复；按场景加入有限上下文；把每日信件与实时聊天主动触发分开；语音、表情和文字统一消费角色状态。以上是我们自己的实现建议，不是 NariYume 私有 prompt 或源码的复原。
