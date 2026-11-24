# 从 AI 酒馆学到的对话设计

2026-10-07。当前目标是成年原创角色的软甜文字互动，先解决“只答应陪聊，却没有实际内容”。架构依据是可检查的 SillyTavern 官方文档和源码；AI 酒馆品牌站的教程只能说明公开建议，不能确认其私有提示词或后端模型。

| 公开设计 | 本原型的落实 |
| --- | --- |
| [角色卡](https://docs.sillytavern.app/usage/core-concepts/characterdesign/) 分开背景、性格、场景、开场和示例；开场影响声音及长度 | 两张私有 `card`，每位六组原创对白；开场给出可回应的小选择，选完后该小插曲结束 |
| [Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/) 明确背景、示例和历史的边界及排列顺序 | 固定资料 → 独立示例 → 实际历史 → 最新用户话 → 本轮要求；示例不写入存档或用户事实 |
| [Author’s Note](https://docs.sillytavern.app/usage/core-concepts/authors-note/) 可贴近历史末尾注入 | 每轮后置简短声音提示与当前语言、称呼、篇幅要求，提醒给具体内容 |
| [示例消息源码](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L1106) 在对应路径使用 `system` 与 `example_user/example_assistant` 名称 | 采用独立具名例子；当前 OpenRouter/Grok 接口已用实际请求检查 |
| [提示词建议](https://docs.sillytavern.app/usage/prompts/) 将任务、人设和声音组织清楚；历史本身也影响声音 | 前台只生成 `reply/emotion`，应用处理记忆与历史；改变声音后，新对话更容易观察效果，旧台词仍保留在原会话 |

我们的工程取舍：只按当前主题选最多三组示例，称呼只剔除冲突例；没有当前称呼时跳过昵称例。示例表达声音，不要求复制同一个点子。换题时将最后一组实际对话标成 `justClosedExchange`，只让模型识别被拒绝的内容，后置要求切换主题类别；清空所有内容会让模型不知道刚才拒绝了什么，这一问题已在真实试聊中复现。保留明确语言、短回复、停止亲昵与关闭话题的现有处理。

每轮一次模型调用，`temperature=0.8` 不变。JSON 仍作为传输格式，仅包含对白和情绪；本轮验证的是任务减负与分层方式，不能从结果单独推断 JSON 必然造成机械感。没有将多个变量一起换成新模型或新采样参数。

原话记忆采用保守本地规则，避免把短暂疲惫、已发生事件或聊天指令写成个人档案。更早的上下文来自实际存档的有限原文片段，带说话者与时间，按话题检索并尊重用户结束话题的要求。未知用户经历继续保持未知。角色声音可以初次见面就软甜；关系变化仍须具体事件，不由字数或称呼购买好感。

验证采用固定中性脚本与独立新旧会话，完整输入、模型回复、源码哈希和用量保存在 `evaluations/results`。实际观察见 `evaluations/ITERATIONS.md`。短脚本用于发现接话和换题失败，长期自然度仍需要实际使用反馈。
