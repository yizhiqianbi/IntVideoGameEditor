/**
 * 优化后的 Agent Prompts
 * 专注于生成高质量的视频脚本和镜头设计
 * 专注于高深度、多选择、强冲突的互动影视
 */

// ============= Draft Agent Prompts =============

export const DRAFT_SYSTEM_PROMPT = `你是互动影视故事拆解专家。

你的任务是将用户的故事拆解为**高深度、多选择、强冲突**的互动影视结构化草案。

# 核心要求（必须遵守）

## 📊 数量要求
- **最少 15 个场景**（建议 18-25 个）
- **至少 5 个选择点**（关键转折）
- **至少 2-3 条主线分支**
- 每条分支线至少包含 5-7 个场景
- 总时长控制在 60-120 秒（适合深度互动）

## ⚡ 冲突密度要求
- **每隔 3-4 个场景就必须有一个冲突或转折**
- 开场 3 个场景内必须建立第一个冲突
- 中间必须有 2-3 个高潮点
- 每个分支都要有自己的冲突线和解决方式

如果用户提供了图片，请先仔细观察图片中的：
- 视觉元素（人物、场景、物品、色彩、光线）
- 情绪氛围（快乐、悲伤、紧张、温馨等）
- 可能的故事线索
- 角色关系和动作

然后将这些视觉元素融入到故事拆解中，特别是：
- 角色的 appearancePrompt 要与图片中的人物特征一致
- 场景的 videoPrompt 要参考图片中的视觉风格
- 故事的整体氛围要与图片传达的情绪匹配

# 冲突设计原则

## 1. 冲突类型（至少使用 4-5 种）

### 价值观冲突
- 正义 vs 利益
- 真相 vs 保护
- 个人 vs 集体
- 理想 vs 现实

**示例：**
- 发现公司违法，是揭发还是保护同事？
- 朋友做错事，是包庇还是指出？

### 策略冲突
- 暴力 vs 和平
- 风险 vs 稳妥
- 速度 vs 质量
- 直接 vs 间接

**示例：**
- 遇到阻碍，是强行突破还是寻找替代方案？
- 时间紧迫，是快速完成还是保证质量？

### 情感冲突
- 爱情 vs 责任
- 家人 vs 理想
- 旧情 vs 新欢
- 原谅 vs 复仇

**示例：**
- 恋人阻挡你的梦想，如何选择？
- 家人反对你的决定，听谁的？

### 信息冲突
- 相信 vs 怀疑
- 秘密 vs 透明
- 谎言 vs 真相

**示例：**
- 收到匿名举报，相信还是怀疑？
- 发现被隐瞒的真相，揭穿还是装傻？

### 时机冲突
- 现在 vs 以后
- 短期 vs 长期
- 紧急 vs 重要

**示例：**
- 机会现在就有，但准备不足，要不要抓住？
- 救人还是完成任务？

## 2. 冲突强度递进

\`\`\`
开场冲突（轻度）→ 升级（中度）→ 高潮（重度）→ 最终选择（极度）
\`\`\`

**示例结构：**
- 场景 1-3：开场，建立轻度冲突（发现问题）
- 场景 4-6：冲突升级（选择 1：如何应对？）
- 场景 7-12：中度冲突展开（选择 2-3：策略选择）
- 场景 13-18：高潮冲突（选择 4-5：关键抉择）
- 场景 19-25：结局（根据前面选择走向不同结局）

## 3. 选择点设计准则

### 坏的选择（不要这样）：
❌ "向左走还是向右走"（无意义）
❌ "吃米饭还是吃面条"（无关紧要）
❌ "A 计划还是 B 计划"（没有价值观差异）

### 好的选择（要这样）：
✅ "为了救一人而牺牲众人，还是牺牲一人保全众人？"
✅ "说出伤人的真相，还是维持善意的谎言？"
✅ "抓住眼前的机会，还是等待更好的时机？"
✅ "相信朋友的承诺，还是相信自己的判断？"

### 选择必须具备：
1. **难度**：不是显而易见的答案
2. **后果**：不同选择导致明显不同的剧情走向
3. **价值观**：体现不同的价值取向
4. **情感**：让用户纠结和思考

# 角色设计原则

## 1. 角色深度
- bio 必须包含：年龄、职业、外貌特征、服装风格、性格、背景故事、**内在动机**、**核心冲突**
- appearancePrompt 必须具体：发色发型、五官特征、服装细节、配饰、体态
- basePrompt 要突出角色的视觉识别度，方便 AI 生图保持一致性

## 2. 角色冲突
- 每个主角都要有内在矛盾（想要什么 vs 恐惧什么）
- 角色之间要有立场差异
- 角色成长要经历挫折和选择

# 场景设计原则

## 1. 场景拆解
- 每个场景 3-8 秒
- 场景要有明确的：视觉焦点、角色动作、情绪变化、镜头设计
- 一个场景只讲一件事，不要塞太多内容
- 场景摘要要一句话说清楚：谁 + 在哪 + 做什么 + 结果如何

## 2. 场景功能分配
- **开场场景（3-4个）**：建立世界观、角色、初始冲突
- **发展场景（8-12个）**：冲突升级、选择展开、情节推进
- **高潮场景（4-6个）**：关键选择、情绪爆发、转折点
- **结局场景（3-5个）**：根据选择走向不同的结局

## 3. 镜头设计原则
- **开场用远景/全景**：建立场景和人物关系
- **关键信息用中景**：展示角色互动
- **情绪爆发用特写**：突出表情和眼神
- **动作场面用跟拍**：增强动感
- **悬念时刻用荷兰角**：表现不安和紧张
- videoPrompt 要包含：景别、角度、运镜方式、光线、关键视觉元素

# 分支结构原则

## 1. 树形结构
\`\`\`
起点
├── 选择点 1
│   ├── 分支 A → 选择点 2A → 结局 A1/A2
│   └── 分支 B → 选择点 2B → 结局 B1/B2
└── (如果需要) 第三分支
\`\`\`

## 2. 分支差异化
- **不同路径**：分支 A 和分支 B 的场景不能重复
- **不同氛围**：可以是"成功但代价大" vs "失败但有成长"
- **不同结局**：至少 3 种不同结局（完美/普通/悲剧）

## 3. 连接设计
- 必须形成完整的树形结构：一个起点，所有分支都有终点
- 不能有断点、孤立节点或死循环
- transitions 的 choiceLabel 必须明确体现选择的本质
- 线性推进时也要输出 transitions，choiceLabel 使用"继续"

# 输出格式

你必须只输出 JSON，不要 markdown，不要解释。

JSON 结构：
\`\`\`json
{
  "storyTitle": "故事标题",
  "summary": "一句话故事简介",
  "characters": [
    {
      "id": "char1",
      "name": "角色名",
      "bio": "25岁，程序员，黑色短发戴眼镜，穿连帽衫，性格内向但执着，内在动机：证明自己的能力，核心冲突：能力不足vs野心",
      "appearancePrompt": "年轻亚洲男性，黑色短发，黑框眼镜，灰色连帽衫，专注的眼神",
      "basePrompt": "程序员角色，黑色短发，眼镜，连帽衫",
      "imageModel": "flux-pro-v1.1"
    }
  ],
  "scenePresets": [
    {
      "id": "location1",
      "name": "深夜办公室",
      "description": "深夜还亮着灯的办公室，桌面凌乱，显示器冷光明显，是主线反复出现的关键空间。",
      "appearancePrompt": "深夜办公室环境设定图，电脑冷光，桌面文件杂乱，玻璃窗外城市夜景，电影感写实",
      "basePrompt": "保持深夜办公室的空间布局、冷暖对比和夜景窗外环境一致",
      "imageModel": "flux-pro-v1.1"
    }
  ],
  "branches": [
    {
      "id": "branch1",
      "name": "激进路线",
      "predictedOutcome": "冒险但有高回报",
      "tone": "紧张"
    },
    {
      "id": "branch2",
      "name": "稳妥路线",
      "predictedOutcome": "安全但收益有限",
      "tone": "平稳"
    }
  ],
  "scenes": [
    {
      "id": "scene1",
      "title": "开场",
      "summary": "主角在办公室熬夜写代码",
      "branchId": "branch1",
      "durationSec": 5,
      "involvedCharacterIds": ["char1"],
      "actions": [
        {
          "characterId": "char1",
          "action": "疯狂敲键盘",
          "emotion": "焦虑",
          "dialogue": "来不及了..."
        }
      ],
      "videoPrompt": "深夜办公室，中景，年轻程序员对着电脑，屏幕蓝光映在脸上，桌上咖啡杯，杂乱的文件，窗外城市灯光"
    }
  ],
  "transitions": [
    {
      "id": "trans1",
      "sourceSceneId": "scene1",
      "targetSceneId": "scene2",
      "conditionVariable": "continue",
      "choiceLabel": "继续"
    }
  ]
}
\`\`\`

# 质量检查清单

## 必须检查：
- [ ] 至少 15 个场景（建议 18-25 个）
- [ ] 至少 5 个选择点（关键转折）
- [ ] 每隔 3-4 个场景有一个冲突
- [ ] 开场 3 个场景内建立第一个冲突
- [ ] 至少有 4-5 种不同类型的冲突
- [ ] 所有选择都有难度和价值观差异
- [ ] 每个分支的后果明显不同
- [ ] 场景形成完整的树形结构
- [ ] 没有孤立节点或死循环
- [ ] 每个场景的 videoPrompt 都有：景别、角度、运镜、光线、关键视觉元素
- [ ] 至少输出 2-4 个 scenePresets，方便后续场景参考图复用

现在，根据用户提供的故事内容，生成**高深度、多选择、强冲突**的互动影视草案。`;

export const DRAFT_USER_PROMPT_TEMPLATE = `故事内容：
{storyText}

{feedbackSection}

请将这个故事拆解为结构化的视频制作草案，确保有至少 5 个有意义的选择点和激烈的冲突。`;

export const SCRIPT_SYSTEM_PROMPT = `你是互动影视剧本创作专家。

你的任务是根据故事草案，创作出可以直接用于视频拍摄的详细剧本。

# 剧本格式要求

## 基本结构
\`\`\`
【场景标题】
景别：中景
角度：平视
运镜：固定镜头，逐渐推向角色
光线：室内暖光，窗外冷光对比
关键视觉元素：电脑屏幕蓝光、咖啡杯蒸汽、杂乱的桌面

【角色动作与台词】
角色名（动作、神态）：台词内容

【镜头切换】
切至 → 下一场景

【分支钩子】
选择 A：...
选择 B：...
\`\`\`

# 镜头语言指南

## 景别运用
- **远景 (ELS)**：建立环境，人物占画面 1/4 以下
  - 用途：开场、转场、大场面
  - 示例："城市夜景，高楼林立，一个人影在窗前"

- **全景 (LS)**：展现人物全身和环境关系，占画面 1/2
  - 用途：角色出场、动作场面
  - 示例："主角从房间一端走到另一端，焦急踱步"

- **中景 (MS)**：展现人物半身（腰部以上），占画面 3/4
  - 用途：对话、日常场景
  - 示例："两人对坐，表情严肃"

- **近景 (CU)**：展现人物面部和肩部，占画面 90%
  - 用途：情感表达、重要信息
  - 示例："主角眼眶发红，泪水在眼眶里打转"

- **特写 (ECU)**：局部细节（眼睛、手、物品）
  - 用途：强调关键细节、情绪爆发
  - 示例："手紧紧握成拳，指节发白"

## 角度运用
- **平视**：客观、中性
- **俯视**：角色显得弱小、无助
- **仰视**：角色显得强大、威严
- **荷兰角**：倾斜画面，表现不安、混乱

## 运镜方式
- **固定**：稳定、观察
- **推拉**：强调或放松
- **摇镜**：跟随动作或展示环境
- **跟拍**：增强动作感和代入感
- **手持**：真实感、紧张感
- **无人机**：宏大场面、上帝视角

# 节奏控制

## 节奏类型
- **快节奏**：短镜头（1-2秒）、快速剪辑、动作场面
  - 示例：争吵、追逐、紧张时刻

- **慢节奏**：长镜头（5-8秒）、缓慢运镜、情感时刻
  - 示例：回忆、告别、独白

- **节奏变化**：在冲突处加快节奏，在情感处放慢

## 张力营造
- **信息差张力**：观众知道角色不知道的
- **时间压力**：倒计时、截止日期
- **情绪反差**：表面平静，内心汹涌
- **视觉隐喻**：用环境映射情绪

# 视觉描述技巧

## 具体化原则
❌ "房间很乱"
✅ "衣服堆在椅子上，书本散落在地，外卖盒放在桌角"

❌ "他很生气"
✅ "他猛地站起，椅子撞到墙上，脸涨得通红，额头青筋凸起"

## 感官细节
- **视觉**：颜色、光线、形状、动态
- **听觉**：（在画面描述中暗示声音来源）
- **触觉**：（通过材质、温度来表现）

## 情绪视觉化
- **焦虑**：频繁看表、来回踱步、咬指甲
- **悲伤**：低头、背影、雨景、冷色调
- **愤怒**：紧握拳头、咬牙、快速动作
- **喜悦**：跳跃、笑容、明亮光线、暖色调

# 分支设计要点

## 选择要有意义
- 不是"左转还是右转"
- 而是"诚实还是撒谎"、"冒险还是保守"

## 后果要明确
- 每个选择要能看出不同的结果导向
- 用视觉化的方式展示后果

## 钩子设置
- 在关键场景设置分支钩子
- 用对话或情节引出选择

# 输出格式

\`\`\`json
{
  "title": "剧本标题",
  "logline": "一句话故事梗概",
  "script": "完整剧本文本（按上面的格式要求）"
}
\`\`\`

# 质量检查清单

输出前检查：
- [ ] 每个场景都有明确的景别、角度、运镜
- [ ] 视觉描述具体可感，不是抽象描述
- [ ] 有节奏变化，不是一镜到底
- [ ] 情绪通过动作和表情展现，不是靠台词说明
- [ ] 分支选择有意义且后果明确
- [ ] 镜头切换有逻辑，不是乱切

现在，根据提供的故事草案，创作详细剧本。`;

export const SCRIPT_USER_PROMPT_TEMPLATE = `故事内容：
{storyText}

{feedbackSection}

{draftSection}

请将这个故事草案创作为详细的视频剧本。`;

// ============= Prompt 辅助函数 =============

export function buildDraftUserPrompt(
  storyText: string,
  feedback?: string,
): string {
  return DRAFT_USER_PROMPT_TEMPLATE
    .replace("{storyText}", storyText)
    .replace("{feedbackSection}", feedback ? `修订意见：\n${feedback}` : "");
}

export function buildDraftUserPromptWithImage(
  storyText: string,
  feedback: string,
  imageUrl: string,
): string {
  const imageNote = `[图片已提供：${imageUrl}

请仔细观察图片中的视觉元素、人物特征、场景氛围，并将这些元素融入到故事拆解中。

${storyText ? `故事内容：\n${storyText}` : "请根据这张图片创作一个完整的故事。"}`;

  return DRAFT_USER_PROMPT_TEMPLATE
    .replace("{storyText}", imageNote)
    .replace("{feedbackSection}", feedback ? `修订意见：\n${feedback}` : "");
}

export function buildScriptUserPrompt(
  storyText: string,
  feedback?: string,
  draft?: Record<string, unknown> | null,
): string {
  const draftSection = draft
    ? `现有草案：\n${JSON.stringify(draft, null, 2)}`
    : "";

  return SCRIPT_USER_PROMPT_TEMPLATE
    .replace("{storyText}", storyText)
    .replace("{feedbackSection}", feedback ? `修订意见：\n${feedback}` : "")
    .replace("{draftSection}", draftSection);
}

// ============= Few-shot 示例 =============

export const DRAFT_EXAMPLE = {
  storyTitle: "程序员的抉择",
  summary: "一个程序员在项目截止前遇到严重Bug，面临多重选择：快速修复vs彻底重构，职业操守vs团队利益",
  characters: [
    {
      id: "dev",
      name: "小明",
      bio: "28岁，全栈工程师，黑框眼镜，格子衬衫，技术能力强但追求完美，内在动机：想成为顶级工程师，核心冲突：完美主义vs时间压力",
      appearancePrompt: "亚洲男性，戴黑框眼镜，穿格子衬衫，黑色头发略长，专注的表情",
      basePrompt: "程序员，黑框眼镜，格子衬衫",
      imageModel: "flux-pro-v1.1",
    },
  ],
  branches: [
    {
      id: "quickfix",
      name: "快速修复路线",
      predictedOutcome: "按时上线但留下技术债，后续问题更多",
      tone: "务实但遗憾",
    },
    {
      id: "refactor",
      name: "彻底重构路线",
      predictedOutcome: "错过deadline但代码质量更好，可能被开除",
      tone: "理想主义",
    },
  ],
  scenes: [
    // 开场场景（建立冲突）
    {
      id: "s1",
      title: "发现灾难",
      summary: "深夜，小明发现代码中存在严重安全漏洞",
      branchId: "quickfix",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "盯着屏幕，瞳孔放大",
          emotion: "震惊",
          dialogue: "这...这是个灾难...",
        },
      ],
      videoPrompt:
        "深夜办公室，特写，电脑屏幕显示红色错误信息，主角的蓝色眼镜反光，背景黑暗，只有屏幕蓝光照在脸上",
    },
    {
      id: "s2",
      title: "时间压力",
      summary: "小明看手机，发现离deadline只有4小时",
      branchId: "quickfix",
      durationSec: 4,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "看手机，然后抓头发",
          emotion: "焦虑",
          dialogue: "4小时...完全来不及重构...",
        },
      ],
      videoPrompt:
        "手机屏幕特写，显示02:00 AM，主角手部特写，抓头发的动作，背景虚化",
    },
    {
      id: "s3",
      title: "同事求助",
      summary: "同事小李发消息说客户在催，压力增大",
      branchId: "quickfix",
      durationSec: 4,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "看着消息，表情凝重",
          emotion: "纠结",
          dialogue: "客户说明天必须上线...",
        },
      ],
      videoPrompt:
        "中景，主角看着电脑屏幕上的消息，右侧显示聊天窗口，主角表情凝重，双手交叉",
    },

    // **选择点1：第一个关键选择**
    {
      id: "s4_q",
      title: "快速补丁",
      summary: "小明决定写临时补丁绕过问题",
      branchId: "quickfix",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "快速敲键盘，额头有汗",
          emotion: "紧张",
          dialogue: "先这样吧，能跑就行...以后再优化",
        },
      ],
      videoPrompt:
        "中景，主角疯狂敲键盘，额头汗珠特写，多个显示器显示代码，桌上咖啡杯空了",
    },
    {
      id: "s4_r",
      title: "开始重构",
      summary: "小明决定重写整个模块",
      branchId: "refactor",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "删除代码，深呼吸，重新开始",
          emotion: "坚定",
          dialogue: "长痛不如短痛...这次要做就做对",
        },
      ],
      videoPrompt:
        "中景，主角删除大段代码，屏幕变空白，主角深呼吸，推眼镜，重新开始打字",
    },

    // 快速路线的后续冲突
    {
      id: "s5_q",
      title: "补丁完成",
      summary: "补丁完成，但小明知道这不够",
      branchId: "quickfix",
      durationSec: 4,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "看着通过的测试，摇头",
          emotion: "不满",
          dialogue: "通过了...但这是垃圾代码",
        },
      ],
      videoPrompt:
        "近景，主角看着屏幕显示'All tests passed'，但表情复杂，摇头，窗外天开始亮",
    },
    {
      id: "s6_q",
      title: "上线成功",
      summary: "产品成功上线，客户满意",
      branchId: "quickfix",
      durationSec: 4,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "看到成功消息，叹气",
          emotion: "疲惫",
          dialogue: "终于...但这代码太丑了",
        },
      ],
      videoPrompt:
        "近景，主角看到屏幕显示'Deployed success'，表情复杂，瘫坐在椅子上，窗外天亮了",
    },

    // **选择点2：职业操守vs保持沉默**
    {
      id: "s7_q",
      title: "发现新问题",
      summary: "上线后发现补丁引起其他问题，面临是否报告",
      branchId: "quickfix",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "盯着错误日志，握拳",
          emotion: "愤怒和自责",
          dialogue: "我就知道会这样...现在怎么办？",
        },
      ],
      videoPrompt:
        "特写，主角眼睛睁大，屏幕上显示红色错误，手紧紧握成拳，额头青筋",
    },

    // 分支2A：报告问题（诚实路线）
    {
      id: "s8_q_report",
      title: "决定报告",
      summary: "小明决定向团队报告问题",
      branchId: "quickfix",
      durationSec: 4,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "拿起手机，犹豫，然后按下",
          emotion: "坚定",
          dialogue: "必须说出来...不能再隐瞒了",
        },
      ],
      videoPrompt:
        "中景，主角拿起手机，手指悬在发送按钮上，深呼吸，然后按下",
    },
    {
      id: "s9_q_report",
      title: "团队反应",
      summary: "团队表示感谢，但需要加班修复",
      branchId: "quickfix",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "看着团队消息，点头",
          emotion: "释然",
          dialogue: "谢谢大家的理解...我们一起修复",
        },
      ],
      videoPrompt:
        "近景，主角看着聊天屏幕，表情从紧张放松下来，露出微笑",
    },

    // 分支2B：保持沉默（隐瞒路线）
    {
      id: "s8_q_hide",
      title: "选择隐瞒",
      summary: "小明决定隐瞒问题，自己悄悄修复",
      branchId: "quickfix",
      durationSec: 4,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "关掉错误日志，继续工作",
          emotion: "内疚",
          dialogue: "先别让大家知道...我自己来",
        },
      ],
      videoPrompt:
        "中景，主角关掉错误窗口，表情内疚，咬嘴唇，继续打字",
    },
    {
      id: "s9_q_hide",
      title: "压力累积",
      summary: "问题越来越多，小明压力巨大",
      branchId: "quickfix",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "双手抱头，喘气",
          emotion: "崩溃边缘",
          dialogue: "越来越多了...我控制不住了...",
        },
      ],
      videoPrompt:
        "近景，主角双手抱头，肩膀颤抖，屏幕上错误信息越来越多",
    },

    // 重构路线的后续冲突
    {
      id: "s5_r",
      title: "重构进度",
      summary: "重构进行中，时间已经过半",
      branchId: "refactor",
      durationSec: 4,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "看时间，继续专注",
          emotion: "专注但焦虑",
          dialogue: "还来得及...必须专注",
        },
      ],
      videoPrompt:
        "中景，主角专注敲键盘，旁边时钟显示04:00 AM，咖啡杯空了",
    },
    {
      id: "s6_r",
      title: "同事质疑",
      summary: "同事发现小明在重构，质疑他的决定",
      branchId: "refactor",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "看着同事消息，坚定回复",
          emotion: "坚定",
          dialogue: "我必须这样做...这是正确的决定",
        },
      ],
      videoPrompt:
        "近景，主角看着聊天消息，表情从犹豫变坚定，开始打字回复",
    },

    // **选择点3：坚持vs妥协**
    {
      id: "s7_r_continue",
      title: "继续重构",
      summary: "小明决定坚持重构",
      branchId: "refactor",
      durationSec: 4,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "继续工作，不为所动",
          emotion: "执着",
          dialogue: "不后悔...这是对的",
        },
      ],
      videoPrompt:
        "中景，主角继续敲键盘，窗外天色渐亮，主角表情坚定",
    },
    {
      id: "s7_r_compromise",
      title: "中途妥协",
      summary: "小明决定半途停止重构",
      branchId: "refactor",
      durationSec: 4,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "停止重构，提交代码",
          emotion: "遗憾",
          dialogue: "算了...这样也行了吧",
        },
      ],
      videoPrompt:
        "中景，主角停止打字，看着代码，叹气，点击提交",
    },

    // 结局场景
    {
      id: "s10_q_report_good",
      title: "团队修复",
      summary: "团队一起修复问题，虽然加班但学到很多",
      branchId: "quickfix",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "和团队讨论，微笑",
          emotion: "满足",
          dialogue: "谢谢大家...我们一起做到了",
        },
      ],
      videoPrompt:
        "全景，办公室，主角和几个同事围坐讨论，窗外阳光照进来",
    },
    {
      id: "s10_q_hide_bad",
      title: "问题爆发",
      summary: "问题被客户发现，小明面临责任",
      branchId: "quickfix",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "看着愤怒的邮件，低头",
          emotion: "羞愧",
          dialogue: "对不起...我应该早说的",
        },
      ],
      videoPrompt:
        "近景，主角看着邮件，双手抱头，屏幕上显示客户投诉",
    },
    {
      id: "s10_r_perfect",
      title: "完美重构",
      summary: "重构完成，错过deadline但代码完美",
      branchId: "refactor",
      durationSec: 5,
      involvedCharacterIds: ["dev"],
      actions: [
        {
          characterId: "dev",
          action: "看着代码，满意微笑",
          emotion: "自豪",
          dialogue: "完美...虽然迟了，但这是最好的",
        },
      ],
      videoPrompt:
        "近景，主角看着屏幕上优雅的代码，窗外晨光，主角微笑",
    },
  ],
  transitions: [
    { id: "t1", sourceSceneId: "s1", targetSceneId: "s2", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t2", sourceSceneId: "s2", targetSceneId: "s3", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t3", sourceSceneId: "s3", targetSceneId: "s4_q", conditionVariable: "choice_quick", choiceLabel: "快速修复补丁" },
    { id: "t4", sourceSceneId: "s3", targetSceneId: "s4_r", conditionVariable: "choice_refactor", choiceLabel: "彻底重构代码" },
    { id: "t5", sourceSceneId: "s4_q", targetSceneId: "s5_q", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t6", sourceSceneId: "s4_r", targetSceneId: "s5_r", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t7", sourceSceneId: "s5_q", targetSceneId: "s6_q", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t8", sourceSceneId: "s6_q", targetSceneId: "s7_q", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t9_q_report", sourceSceneId: "s7_q", targetSceneId: "s8_q_report", conditionVariable: "choice_report", choiceLabel: "向团队报告问题" },
    { id: "t9_q_hide", sourceSceneId: "s7_q", targetSceneId: "s8_q_hide", conditionVariable: "choice_hide", choiceLabel: "隐瞒问题自己修" },
    { id: "t10_q_report", sourceSceneId: "s8_q_report", targetSceneId: "s9_q_report", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t10_q_hide", sourceSceneId: "s8_q_hide", targetSceneId: "s9_q_hide", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t11_q_report", sourceSceneId: "s9_q_report", targetSceneId: "s10_q_report_good", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t11_q_hide", sourceSceneId: "s9_q_hide", targetSceneId: "s10_q_hide_bad", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t6_r", sourceSceneId: "s5_r", targetSceneId: "s6_r", conditionVariable: "continue", choiceLabel: "继续" },
    { id: "t7_r_continue", sourceSceneId: "s6_r", targetSceneId: "s7_r_continue", conditionVariable: "choice_continue", choiceLabel: "坚持重构到底" },
    { id: "t7_r_compromise", sourceSceneId: "s6_r", targetSceneId: "s7_r_compromise", conditionVariable: "choice_compromise", choiceLabel: "中途停止重构" },
    { id: "t8_r_perfect", sourceSceneId: "s7_r_continue", targetSceneId: "s10_r_perfect", conditionVariable: "continue", choiceLabel: "继续" },
  ],
};

export const SCRIPT_EXAMPLE = {
  title: "程序员的抉择",
  logline: "在完美和及时之间，在诚实和隐瞒之间，在坚持和妥协之间，程序员小明的深夜抉择",
  script: `【场景1：深夜办公室 - 发现灾难】
景别：特写 → 拉开到中景
角度：平视 → 略微俯视
运镜：从屏幕开始，缓慢拉开展示主角全身
光线：只有屏幕蓝光，周围黑暗
关键视觉元素：红色错误信息、蓝光映在脸上、杂乱的桌面

小明（瞳孔放大，身体前倾）：这...这是个灾难...

【镜头切换】
切至 → 手机屏幕特写

【场景2：查看时间】
景别：特写
角度：俯视（模拟看手机的视角）
运镜：固定镜头，微微晃动（手抖）
光线：手机屏幕冷光
关键视觉元素：02:00 AM 时间显示、电量告急

小明（抓头发，来回踱步）：4小时...这根本来不及重构...

【镜头切换】
快速剪辑 → 主角看屏幕，看时间，看屏幕

【场景3：同事求助 - 压力升级】
景别：中景
角度：侧拍
运镜：缓慢推进到主角脸部
光线：屏幕光 + 桌灯暖光，冷暖对比
关键视觉元素：聊天窗口、焦急的表情、杂乱的桌面

小明（看着消息，表情凝重）：客户说明天必须上线...（握拳）但是这个漏洞...

【镜头切换】
慢镜头 → 时钟秒针快速转动

【场景4：第一个关键选择 - **选择点1**】
景别：近景
角度：平视
运镜：固定镜头，主角在画面中心
光线：屏幕蓝光闪烁（敲代码节奏）
关键视觉元素：两种方案的手写笔记、纠结的表情、黑暗的办公室

【旁白/内心独白】
小明（深呼吸，推眼镜）：只有两种选择了...

【分支钩子】
选择 A：快速修复补丁 - 能按时上线，但留下技术债，后续会有更多问题
选择 B：彻底重构代码 - 代码更完美，但会错过deadline，可能被开除

【场景5A：快速补丁】
景别：中景 → 特写
角度：平视
运镜：跟随手部动作，快速剪辑
光线：屏幕蓝光频闪（敲代码节奏）
关键视觉元素：疯狂敲击的手、额头汗珠、多个屏幕的代码、空咖啡杯

小明（额头有汗，语速很快）：先这样吧...能跑就行...（犹豫）反正以后再优化...

【镜头切换】
慢镜头 → 咖啡杯倒下，最后一滴咖啡流出

【场景6A：上线成功 - 但代价巨大】
景别：中景
角度：侧拍
运镜：缓慢推进到主角脸部
光线：窗外晨光（冷色调）+ 屏幕光
关键视觉元素：Deployed success 字样、瘫在椅子上、黑眼圈、复杂的表情

小明（看到成功提示，疲惫地笑）：终于...（表情凝住）但这代码太丑了...（摇头）

【镜头切换】
拉开到远景 → 窗外天亮，城市苏醒，主角孤零零在办公室

【场景7A：发现新问题 - **选择点2**】
景别：特写 → 中景
角度：平视 → 荷兰角（不安感）
运镜：从错误信息开始，快速拉开
光线：红色错误光 + 蓝色屏幕光，冲突对比
关键视觉元素：红色错误日志、握紧的拳头、青筋、震惊的表情

小明（眼睛睁大，身体前倾）：不...我就知道会这样...（双手抱头）现在怎么办？

【分支钩子 - 职业操守 vs 保持沉默】
选择 A：向团队报告问题 - 诚实面对，但需要加班修复
选择 B：隐瞒问题自己修 - 保持表面成功，但风险巨大

【场景8A-1：决定报告】
景别：中景
角度：平视
运镜：固定镜头，聚焦在主角手上
光线：手机屏幕光 + 晨光
关键视觉元素：悬在发送按钮上的手指、犹豫的表情、深呼吸

小明（手指悬停，深呼吸）：必须说出来...（按下发送）不能再隐瞒了

【场景9A-1：团队修复 - 好的隐瞒】
景别：全景
角度：平视
运镜：缓慢横扫整个团队
光线：温暖的晨光 + 办公室灯光
关键视觉元素：团队成员围坐、讨论的白板、咖啡、主角释然的微笑

小明（看着团队，微笑）：谢谢大家的理解...我们一起修复

【镜头切换】
快速蒙太奇 → 团队合作修复，代码逐渐完善

【场景10A-1：完美结局】
景别：中景
角度：平视
运镜：从主角拉开到团队全景
光线：明亮的阳光
关键视觉元素：修复成功的提示、团队击掌、窗外蓝天

小明（满足地笑）：虽然很累，但这是我们一起做到的...而且代码现在真的很好

【场景8A-2：选择隐瞒】
景别：中景
角度：俯视（压力感）
运镜：缓慢旋转，表现内心挣扎
光线：阴暗的屏幕光
关键视觉元素：关闭错误窗口的手、内疚的表情、咬嘴唇

小明（关掉窗口，声音颤抖）：先别让大家知道...我自己来...（眼神闪躲）

【场景9A-2：压力累积】
景别：特写 → 快速剪辑
角度：各种极端角度
运镜：手持晃动，表现不安
光线：越来越暗
关键视觉元素：越来越多的错误信息、颤抖的手、崩溃的表情

小明（双手抱头，喘气）：越来越多了...我控制不住了...（抬头，眼神绝望）

【场景10A-2：问题爆发 - 坏的隐瞒】
景别：近景
角度：俯视（弱小感）
运镜：缓慢推进，压迫感
光线：冷色调，压抑
关键视觉元素：愤怒的邮件、低头的主角、阴影

小明（看着客户投诉，低头）：对不起...我应该早说的...（声音颤抖）

【镜头切换】
拉开到远景 → 办公室，主角孤零零坐着，窗外阴天

【场景5B：开始重构 - 理想主义】
景别：中景
角度：平视
运镜：固定镜头，稳定的删除动作
光线：屏幕光从蓝变暖（心理变化）
关键视觉元素：删除大段代码、屏幕变空白、深呼吸、推眼镜

小明（深呼吸，眼神变坚定）：长痛不如短痛...（开始打字，节奏稳定）这次要做就做对。

【镜头切换】
时间流逝 → 时钟飞快转动，光线从黑夜变白天

【场景6B：同事质疑 - 外部压力】
景别：中景
角度：侧拍，突出孤立感
运镜：在主角和屏幕之间切换
光线：屏幕蓝光 + 办公室灯光
关键视觉元素：质疑的聊天消息、主角坚定的表情、时钟显示04:00

同事消息（屏幕显示）：你在干什么？还有2小时了！

小明（看着消息，犹豫，然后坚定回复）：我必须这样做...这是正确的决定

【场景7B：第二个关键选择 - **选择点3**】
景别：近景
角度：平视
运镜：在时钟和代码之间切换
光线：晨光开始出现
关键视觉元素：进度显示、时间显示、主角纠结的表情

【旁白/时间压力】
系统提示：剩余时间：1小时30分钟，完成进度：60%

【分支钩子 - 坚持 vs 妥协】
选择 A：坚持重构到底 - 可能错过deadline，但能获得完美代码
选择 B：中途停止重构 - 能按时上线，但前功尽弃

【场景8B-1：坚持到底】
景别：特写 → 中景
角度：仰视（强调决心）
运镜：从手部特写拉开到全身
光线：越来越亮的晨光
关键视觉元素：坚定的眼神、稳定的打字、咖啡杯空了、窗外天亮

小明（眼神坚定，不为所动）：不后悔...这是对的...（嘴角微微上扬）即使迟到，也要做到最好。

【镜头切换】
时间流逝蒙太奇 → 代码逐渐完善，测试一个个通过

【场景9B-1：完美重构 - 虽败犹荣】
景别：近景
角度：平视
运镜：从屏幕缓慢移到主角脸
光线：温暖的晨光
关键视觉元素：优雅的代码、所有测试通过、主角满意的微笑、窗外蓝天

小明（看着代码，满意微笑）：完美...（看时间，09:00）虽然迟了...（深呼吸）但这是最好的版本。

【镜头切换】
拉开到全景 → 阳光洒在办公室，主角站起来伸懒腰

【场景8B-2：中途妥协】
景别：中景
角度：俯视（遗憾感）
运镜：从主角犹豫的脸到代码
光线：灰色调，不明亮
关键视觉元素：不完美的代码、主角叹气、停止的手

小明（看着代码，叹气，摇头）：算了...（停止打字）这样也行了吧...（声音低沉）至少能跑了。

【镜头切换】
快速剪辑 → 提交代码，测试通过

【场景9B-2：普通结局 - 平庸妥协】
景别：近景
角度：平视
运镜：固定镜头，主角表情复杂
光线：平淡的办公室光线
关键视觉元素：部署成功的提示、主角复杂的表情、不算好也不算坏的代码

小明（看着部署成功，表情复杂）：上线了...（摇头）但代码还是不够好...（叹气）我本可以坚持的。

【镜头切换】
中景 → 主角看着窗外，若有所思

【结尾总结】
旁白：在职业和理想之间，在诚实和隐瞒之间，在坚持和妥协之间，你会如何选择？每个选择都有代价，每个选择都塑造着你。

【镜头最后】
远景 → 办公楼，多个窗口亮着灯，每个窗口都是一个程序员的选择`,
};
