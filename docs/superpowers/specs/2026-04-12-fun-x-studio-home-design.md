# Fun-X-Studio Home Design

## Goal
把当前首页从“通用产品说明页”收成一个更像创作平台入口的首页，品牌切换为 `Fun-X-Studio`，首屏只承担产品线分流职责，第二屏承担“精选案例”占坑职责。

## Product framing
首页不是项目库，也不是编辑器说明书。首页只做三件事：

1. 建立品牌：`Fun-X-Studio`
2. 让用户选择产品线
3. 给出一个轻量的内容流感知

当前唯一真实可用的产品线是 `互动影游`。`MV` 和 `互动游戏生成器` 先做成 `Coming Soon` 状态，不给出假的可用入口。

## Information architecture

### First viewport
- 左上保留统一顶栏品牌
- 首屏中心区域使用大标题 `Fun-X-Studio`
- 极短副标题，用一句话描述平台方向
- 下方放三张产品线入口卡：
  - `MV`
  - `互动影游`
  - `互动游戏生成器`

### Product cards
- 三张卡都应是“大入口卡”，不是小功能卡
- `互动影游` 是唯一主推卡：
  - 视觉最强
  - 文案为“立即进入”
  - 跳转 `/projects`
- `MV`：
  - 标注 `Coming Soon`
  - 不跳真实产品页
- `互动游戏生成器`：
  - 标注 `Coming Soon`
  - 不跳真实产品页

### Second viewport
- 标题：`精选案例`
- 作用：建立平台感和未来内容流位置
- 当前阶段只做占坑：
  - 3 到 6 张静态案例卡
  - 每张卡包含封面、标题、类型标签、状态
- 不做复杂社区交互，不做假的点赞/播放等数据

## Visual direction
- 保留深色基底和当前产品的紫蓝高光系统
- 首屏更像海报，而不是官网说明块
- 用更大的留白、更强的卡片层级，把注意力集中在三栏入口
- `互动影游` 卡片要比另外两张更亮、更完整
- `Coming Soon` 两卡保持存在感，但明显弱于主推卡

## Scope
本轮只改首页与顶栏品牌表达，不改项目库、编辑器和 Agent 页的功能结构。

### Files in scope
- `src/app/page.tsx`
- `src/app/page.module.css`
- `src/components/top-nav.tsx`
- `src/components/top-nav.module.css`
- 新增首页数据文件与测试文件

## Success criteria
- 首页品牌统一为 `Fun-X-Studio`
- 首页出现三栏产品入口
- `互动影游` 是唯一真实入口
- 首页出现“精选案例”占坑区
- 页面整体不再像说明书，而更像创作平台入口
