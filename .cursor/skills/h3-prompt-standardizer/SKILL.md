---
name: h3-prompt-standardizer
description: >-
  Turns a story, shot, or messy prompt into production-ready MiniMax H3 video
  prompts for this studio. Use when writing, expanding, repairing, or reviewing
  H3 提示词, 分镜 prompt, start/action/camera/setting/sound/end, RI2V/I2V/T2V
  labels, 口型, 环境声, or negative constraints. Keep adult 21+ content explicit.
  Do not generate or edit video files.
---

# MiniMax H3 提示词规范（本仓库）

来源：[minimax-h3-prompt-standardizer](https://github.com/sengseng123/minimax-h3-prompt-standardizer)。压缩进 `src/lib/drama-direction.ts` 与 `composeShotPrompt`。成人短剧照写身体，不降级成隐喻。

## 生产形状

先静默判定：T2V / I2V / 首尾帧 / 多参考；对白、动作还是混合；**连续单镜头**（本工作室默认，禁止镜内剪切）；时长 3–15 秒。故事超过一镜才分段，切在景别、机位、地点、时间或**已完成动作**改变处，不要把未完成姿势拆开。

## 可观察指令顺序

1. 主体 + 唯一核心事件  
2. 场景与连续性（体位、裸露、光线、距离）  
3. 时间轴：起始站住 → 中间一个动作（方向、重量、接触、结束姿势）  
4. 服务故事的运镜（一个景别 + 一种运镜）  
5. 光线、材质  
6. 谁在何时说话、口型、环境声、动作声；默认无字幕  
7. 负面约束  

用看得见、生成得出的句子。不要「震撼」「高级」「电影感」。动作负荷保持可生成。

参考图按实际上传顺序写 `Image 1 / Video 1 / Audio 1`，只引用已有素材。

## 声音

- 对白原句放引号，写说话人、时机、情绪、停顿、口型同步。  
- 环境声/动作声与非叙事配乐分开；不要的配乐写「无突然出现的背景音乐」。  
- 默认无字幕、无 Logo、无水印。

## 负面：写进主提示词，用否定句

H3 **没有**独立 negative 字段。故障词若以肯定形式出现（「手指粘连、油腻」），模型会往那头生成。必须写成：

`无多余手指、无手指粘连、无油腻高光、无畸形生殖器、无口型错位、无字幕`

英文场景用 `no extra fingers`。已有「无/不要/no」的不要再叠一层。只加与本镜相关的约束。

本仓库默认清单在 `src/lib/generation-constraints.ts`（人体结构、性器官解剖、声音、油腻/塑料感、21+）。
