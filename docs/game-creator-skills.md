# Fun-X 游戏创作者 Skill 库

## 目标

这一套 Skill 不是为了“模仿某一个名人”，而是把小游戏行业里最有用的创作方法论蒸馏成可复用角色。

后续在制作小游戏时，建议采用下面的组合方式：

- 先选一个 **玩法 Skill**
- 再叠一个 **封面 Skill**
- 最后再补具体 prompt

也就是说，未来的小游戏创作流程会是：

1. 选模板或玩法 Skill
2. 选创作方向
3. 再用 prompt 补充题材、主题、视觉和特殊规则
4. 输出小游戏与封面

## 调研依据

这套 Skill 的蒸馏方向主要参考了几类公开可确认的案例：

- `羊了个羊`
  - 简单规则 + 高传播 + “差一点”的重复游玩冲动
  - 来源：[维基百科](https://zh.wikipedia.org/wiki/%E7%BE%8A%E4%BA%86%E4%B8%AA%E7%BE%8A)
- `无尽冬日`
  - 事件堆叠、目标层次、回流驱动、联盟与榜单牵引
  - 来源：[机核活动分析案](https://www.gcores.com/articles/209643)
- `微信小游戏生态`
  - 社交留存、视频号增长、轻度品类高活跃
  - 来源：[搜狐 / 微信小游戏机遇分析](https://www.sohu.com/a/976510217_121124868)
- `4399`
  - 高密度封面流、排行榜、低门槛进入
  - 来源：[4399 热门榜](https://www.4399.com/top)

## Skill 列表

### 1. `funx-instant-arcade`

适合：
- 点击
- 躲避
- 节奏
- 反应类

创作人格：
- 可读性极强
- 规则 3 秒内理解
- 20 到 60 秒一局

### 2. `funx-viral-puzzle`

适合：
- 翻牌
- 消除
- 排列
- 轻逻辑

创作人格：
- 先会玩，再变难
- 强“差一点”体验
- 强复玩冲动

### 3. `funx-meta-retention`

适合：
- 轻养成
- 事件制小游戏
- 多轮目标推进

创作人格：
- 有回流理由
- 有持续进度条
- 有阶段目标和里程碑

### 4. `funx-social-challenge`

适合：
- 排行榜小游戏
- 挑战型小游戏
- 分享卡友好内容

创作人格：
- 结果可晒
- 分数可比
- 一局结束就想挑战别人

### 5. `funx-browser-inventor`

适合：
- 小而巧的网页小游戏
- 单屏玩法
- 机关 / 路线 / 配对 / 网格类

创作人格：
- 一个巧思就够
- 一屏讲清规则
- 鼠标和触摸都能玩

### 6. `funx-cover-director`

适合：
- 所有上公共平台的内容

创作人格：
- 封面先行
- 一眼看懂
- 封面流里也能打

## 使用建议

## 创作端后续入口

未来小游戏创作入口统一为：

- 模板
- skill
- prompt

推荐顺序：

1. 先选模板
2. 再叠一个或多个 skill
3. 最后用 prompt 补题材、主题、视觉与特殊规则

这个模型的目标不是让用户“从零乱写 prompt”，而是先借助结构化创作骨架，再用 prompt 做局部扩展。

### 推荐组合

- 快节奏反应游戏：
  - `funx-instant-arcade` + `funx-cover-director`

- 病毒传播式益智游戏：
  - `funx-viral-puzzle` + `funx-social-challenge` + `funx-cover-director`

- 带回流的轻养成小游戏：
  - `funx-meta-retention` + `funx-cover-director`

- 小而巧的一屏网页游戏：
  - `funx-browser-inventor` + `funx-cover-director`

## 后续扩展方向

后面还应继续补更多 Skill，至少包括：

- 合成 / 消除类
- 跑酷 / 闯关类
- 经营 / 放置类
- 轻剧情 / 多结局类
- 关卡策划 Skill
- 微信小游戏商业化与分享素材 Skill

## 维护规则

每次新增或调整小游戏创作方向时，需要同步更新：

- [ARCHITECTURE.md](/Users/pencil/Documents/IntVideoGameEditor/ARCHITECTURE.md)
- 本文档

当前本地 Skill 目录：

- `/Users/pencil/.codex/skills/funx-instant-arcade`
- `/Users/pencil/.codex/skills/funx-viral-puzzle`
- `/Users/pencil/.codex/skills/funx-meta-retention`
- `/Users/pencil/.codex/skills/funx-social-challenge`
- `/Users/pencil/.codex/skills/funx-browser-inventor`
- `/Users/pencil/.codex/skills/funx-cover-director`
