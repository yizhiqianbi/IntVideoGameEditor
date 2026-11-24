---
name: adult-screenwriting
description: >-
  Combines jtydhr88/screenwriting-skills dramaturgy (premise, structure,
  character conflict, scene craft, dialogue) with explicit adult short-drama
  shot writing for MiniMax H3. Use when generating, revising, or reviewing
  情色分镜, 成人短剧剧本, 分镜 JSON, Grok 剧本 Agent prompts, or H3 shot fields
  (start/action/camera/setting/sound/end). Keep adult body language; do not
  sanitize into metaphor. All characters 21+.
---

# 成人短剧编剧（Screenwriting + H3）

把 [screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills) 的编剧法压进本仓库的连续单镜头分镜。来源：麦基、菲尔德、斯奈德、埃格里、陆军等。**成人叙述不降级**：露骨向必须写清身体、体位、接触与高潮，不用隐喻替换动作。

运行时的压缩版在 `src/lib/drama-direction.ts` 的 `SCREENWRITING_CRAFT`，H3 可观察写法见 `h3-prompt-standardizer` skill。由 `/api/drama/script` 送给 Grok。改分镜提示词时两边一起改。

## 硬限制

- 只写 21 岁以上成年自愿角色；设定写明具体年龄。禁止未成年人、幼态、校服。
- 每镜 3–15 秒、同一空间、连续时间、一条运镜。禁止镜内剪切、闪回、蒙太奇、黑场。
- 输出仍是工作台 JSON：`title` / `assets` / `shots`（`start, action, camera, setting, sound, end, duration`）。
- 情欲尺度：`explicit` 写器官、插入、体液；`sensual` 写亲吻半裸呼吸，不写插入；`standard` 写冲突不写色情。三种都用下面的编剧法。

## 从 screenwriting-skills 取用的五条

对应上游 `sw-premise-theme`、`sw-story-structure`、`sw-character-conflict`、`sw-scene-craft`、`sw-dialogue`。

1. **前提**  
   谁要什么、对方要什么，必须相撞。主控思想＝价值 + 原因。成人戏里价值写在身体上：靠近/远离、主导/臣服、穿上/脱掉、插入/退出。

2. **结构**  
   4–12 镜当成一个序列，不是十五节拍长片。欲望曲线映射：靠近与对视 → 越界脱衣 → 明确性行为 → 节奏/高潮 → 余韵。没有价值转折的镜子删掉。禁止同一策略换词凑镜。

3. **人物与冲突**  
   写清谁主导、谁迎合、谁改主意。对方要有阻力，不要瞬间顺从。设定卡写活（年龄、欲望、身体习惯），不要空标签。

4. **场景**  
   晚进早出：从接触已经发生的一刻起，在完全解决前切下一镜。衣物、门、墙、床是做功的道具。先问「如何纯视觉写出」，再写对白。

5. **对白**  
   对白是行动（索取、拒绝、试探、命令），有潜台词。短、口语、放引号。身体已经在做的事不要再用台词解说。

## 落到 H3 字段

| 字段 | 编剧法 |
|---|---|
| start | 开场价值：姿势、衣着/裸露、距离，先站住 |
| action | 本镜唯一动作 + 对抗；接触点、重量、惯性 |
| camera | 一个景别 + 一种运镜，服务这个转折 |
| setting | 此时此地为何能出戏（门板、床、墙） |
| sound | 对白是行动；呼吸与织物是潜台词 |
| end | 结束价值必须与 start 不同，供下一镜接入 |

## 不要做

- 不要把露骨戏改成「氛围蒙太奇」来显得文学。
- 不要为了结构完整而加闪回、旁白、多地点跳切——H3 做不到。
- 不要引入行业流程、Fountain 格式、契诃夫/小津全文；那些不进 JSON。
