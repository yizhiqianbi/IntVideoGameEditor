import { ClickChaseGame } from "./games/click-chase";
import { CodeBreakerGame } from "./games/code-breaker";
import { CrateSortGame } from "./games/crate-sort";
import { HarborMatchGame } from "./games/harbor-match";
import { LaneDodgeGame } from "./games/lane-dodge";
import { MemoryFlipGame } from "./games/memory-flip";
import { MergeCampGame } from "./games/merge-camp";
import { PerfectCutGame } from "./games/perfect-cut";
import { ReactionShotGame } from "./games/reaction-shot";
import { RhythmGateGame } from "./games/rhythm-gate";
import { RoutePlannerGame } from "./games/route-planner";
import { SignalSequenceGame } from "./games/signal-sequence";
import { StackBalanceGame } from "./games/stack-balance";
import { SwitchLockGame } from "./games/switch-lock";
import { TileRushGame } from "./games/tile-rush";
import { TruthJudgeGame } from "./games/truth-judge";
import type { MiniGameDefinition } from "./types";

export const MINI_GAMES: MiniGameDefinition[] = [
  {
    slug: "click-chase",
    title: "点击追踪",
    subtitle: "追着目标猛点的 25 秒冲刺",
    durationLabel: "25 秒",
    instructions: "目标会持续刷新，尽量在 25 秒里打出更高得分和连击。",
    component: ClickChaseGame,
  },
  {
    slug: "memory-flip",
    title: "记忆翻牌",
    subtitle: "最经典的一局记忆挑战",
    durationLabel: "1-2 分钟",
    instructions: "每次翻开两张，尽快完成全部配对，用更少步数拿更高分。",
    component: MemoryFlipGame,
  },
  {
    slug: "lane-dodge",
    title: "躲避快线",
    subtitle: "三车道躲障碍，坚持越久越高分",
    durationLabel: "30 秒",
    instructions: "用左右键或屏幕按钮切换车道，避开下落障碍撑满 30 秒。",
    component: LaneDodgeGame,
  },
  {
    slug: "signal-sequence",
    title: "信号序列",
    subtitle: "记住灯阵顺序，越往后越难",
    durationLabel: "1-3 分钟",
    instructions: "观察闪烁顺序并按同样次序点击，答对后会自动进入下一轮。",
    component: SignalSequenceGame,
  },
  {
    slug: "crate-sort",
    title: "货箱分拣",
    subtitle: "把货箱快速分到正确区域",
    durationLabel: "35 秒",
    instructions: "先点货箱再点目标区，或直接拖放，尽量在倒计时前完成全部分拣。",
    component: CrateSortGame,
  },
  {
    slug: "truth-judge",
    title: "真假判断",
    subtitle: "连续判断线索陈述的真假",
    durationLabel: "12 题",
    instructions: "快速判断真假，保持连击，题目会自动推进。",
    component: TruthJudgeGame,
  },
  {
    slug: "route-planner",
    title: "路线规划",
    subtitle: "选一条最合理的通关路径",
    durationLabel: "多关卡",
    instructions: "一步步点击相邻格子前进，拿到补给后到终点，别把步数走光。",
    component: RoutePlannerGame,
  },
  {
    slug: "rhythm-gate",
    title: "节奏闸门",
    subtitle: "踩准时机一口气通过闸门",
    durationLabel: "10 回合",
    instructions: "等指针进入高亮区再出手，尽量打满连击。",
    component: RhythmGateGame,
  },
  {
    slug: "harbor-match",
    title: "港口连线",
    subtitle: "把左右两列正确配对",
    durationLabel: "1-2 分钟",
    instructions: "先选左边，再点右边完成配对，尽量减少错误次数。",
    component: HarborMatchGame,
  },
  {
    slug: "code-breaker",
    title: "密码破译",
    subtitle: "8 次机会猜中 4 位密码",
    durationLabel: "8 次尝试",
    instructions: "根据每轮反馈不断修正答案，在 8 次内破解密码。",
    component: CodeBreakerGame,
  },
  {
    slug: "stack-balance",
    title: "猪外有猪",
    subtitle: "叠得越稳，分越高",
    durationLabel: "10 层",
    instructions: "等方块划过塔心时落下，偏移越小越稳，连着叠满 10 层。",
    component: StackBalanceGame,
  },
  {
    slug: "tile-rush",
    title: "三消急救",
    subtitle: "先手三连，后面才会越玩越紧",
    durationLabel: "1 局",
    instructions: "只拿顶层图块，凑满三张自动消除，别让槽位塞满。",
    component: TileRushGame,
  },
  {
    slug: "reaction-shot",
    title: "瞬时开枪",
    subtitle: "灯一亮就打，早了晚了都亏",
    durationLabel: "8 轮",
    instructions: "稳住，等信号亮起再出手，连续命中能叠更高分。",
    component: ReactionShotGame,
  },
  {
    slug: "merge-camp",
    title: "营地合成",
    subtitle: "轻合成，短回合，目标很直",
    durationLabel: "8 回合",
    instructions: "把同类同级资源合到一起，尽快把营火冲到 4 级。",
    component: MergeCampGame,
  },
  {
    slug: "switch-lock",
    title: "机关锁",
    subtitle: "九步之内把电流全打通",
    durationLabel: "9 步",
    instructions: "切换线路，让电流按顺序穿过 6 个机关，别把步数浪费掉。",
    component: SwitchLockGame,
  },
  {
    slug: "perfect-cut",
    title: "完美切线",
    subtitle: "卡准区间，一刀下去",
    durationLabel: "8 轮",
    instructions: "观察来回摆动的切线，在最准的一刻落刀，尽量打满 8 轮高分。",
    component: PerfectCutGame,
  },
];

export function getMiniGameBySlug(slug: string) {
  return MINI_GAMES.find((game) => game.slug === slug) ?? null;
}
