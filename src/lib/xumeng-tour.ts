import type { XumengLocale } from "./xumeng-i18n";
import type { IconName } from "@/components/dzmm/icons";

export interface XumengSpotlightStep {
  id: string;
  selector: string;
  title: string;
  body: string;
  icon?: IconName;
  padding?: number;
}

export type XumengTourId = "discover" | "chat" | "generation";

const TOUR_STORAGE_PREFIX = "xumeng:spotlight-tour:v1:";

export function isXumengTourDone(tourId: XumengTourId): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(`${TOUR_STORAGE_PREFIX}${tourId}`) === "done";
  } catch {
    return false;
  }
}

export function markXumengTourDone(tourId: XumengTourId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${TOUR_STORAGE_PREFIX}${tourId}`, "done");
  } catch {
    // Ignore storage errors.
  }
}

export function getXumengTourSteps(tourId: XumengTourId, locale: XumengLocale): readonly XumengSpotlightStep[] {
  const isEn = locale === "en";
  if (tourId === "generation") {
    return isEn
      ? [
          {
            id: "tpl-nav",
            selector: '[data-tour="tpl-nav"]',
            title: "Templates & Free AI Tools in One Place",
            body: "Browse ready-made video/image templates or jump straight to Free Tools (img2vid, face swap, outfit, novel) anytime.",
            icon: "sparkles",
            padding: 6,
          },
          {
            id: "tpl-search",
            selector: '[data-tour="tpl-search"]',
            title: "Filter by Motion, Style, or Keyword",
            body: "Switch between Video Motion and Image Style shelves, or search by action and vibe.",
            icon: "search",
            padding: 6,
          },
          {
            id: "tpl-card",
            selector: '[data-tour="tpl-card"]',
            title: "Pick a Card to Generate Instantly",
            body: "Hover to preview motion, tap any card to open the studio with your character portrait pre-loaded as reference.",
            icon: "image",
            padding: 6,
          },
        ]
      : [
          {
            id: "tpl-nav",
            selector: '[data-tour="tpl-nav"]',
            title: "模板广场",
            body: "在这里浏览视频动作与图片风格模板，选中任意模板后会直接跳转到对应的 AI 工具开始生成。",
            icon: "sparkles",
            padding: 6,
          },
          {
            id: "tpl-search",
            selector: '[data-tour="tpl-search"]',
            title: "按类型与关键词快速挑模板",
            body: "支持按「视频动作 / 图片风格」筛选和关键词搜索，还支持「自由出图」自定义玩法。",
            icon: "search",
            padding: 6,
          },
          {
            id: "tpl-card",
            selector: '[data-tour="tpl-card"]',
            title: "点选模板 · 自动带入角色立绘做同款",
            body: "鼠标悬停可预览视频动效；如果从角色页或聊天点「用 Ta 做同款」进来，角色立绘会自动填入参考图，选模板即可一键生成！",
            icon: "image",
            padding: 6,
          },
        ];
  }
  if (tourId === "chat") {
    return isEn
      ? [
          {
            id: "chat-model",
            selector: '[data-tour="chat-model"]',
            title: "4-Tier AI Story Models",
            body: "Switch anytime from Glimmer 1× (8+ coins/turn) up to Astral flagship models for richer prose and longer memory.",
            icon: "sparkles",
            padding: 6,
          },
          {
            id: "chat-peek",
            selector: '[data-tour="chat-peek"]',
            title: "Pure Art Peek Mode",
            body: "Tap the eye icon to fade bubbles away and admire the character artwork unobstructed — tap anywhere or press Esc to return.",
            icon: "eye",
            padding: 6,
          },
          {
            id: "chat-comments",
            selector: '[data-tour="chat-comments"]',
            title: "Player Comments Drawer",
            body: "Read player tips, favorite openings, and leave your own review without leaving the chat.",
            icon: "chat",
            padding: 6,
          },
          {
            id: "chat-composer",
            selector: '[data-tour="chat-composer"]',
            title: "Director Palette · Scene Art & Video",
            body: "Tap { } for narration/OOC cues, use Reply Ideas when stuck, or tap Scene Art / Scene Video to turn the latest beat into a 2K still or 5s voiced clip.",
            icon: "braces",
            padding: 8,
          },
        ]
      : [
          {
            id: "chat-model",
            selector: '[data-tour="chat-model"]',
            title: "四品阶 AI 演绎模型随心切换",
            body: "涵盖微光（1× · 8币起）至星穹旗舰（6× · 48币起），按剧情节奏与文风喜好随时切换。",
            icon: "sparkles",
            padding: 6,
          },
          {
            id: "chat-peek",
            selector: '[data-tour="chat-peek"]',
            title: "纯净看图 · 一键欣赏原画",
            body: "故事背景已做柔化护眼处理；点这枚眼睛图标可淡出气泡还原无遮挡原画，点击任意处或按 Esc 即可返回对话。",
            icon: "eye",
            padding: 6,
          },
          {
            id: "chat-comments",
            selector: '[data-tour="chat-comments"]',
            title: "玩家评论区 · 边玩边聊",
            body: "随时拉出当前角色的评论抽屉，看看其他玩家的隐藏玩法、印象标签，顺手留下你的评价。",
            icon: "chat",
            padding: 6,
          },
          {
            id: "chat-composer",
            selector: '[data-tour="chat-composer"]',
            title: "导演面板 · 此刻生图 · 此刻生视频",
            body: "点 { } 快捷插入旁白或 OOC 指令；气泡下「灵感回复」随时帮你接戏；点「此刻生图」定格 2K 高清画面，点「此刻生视频」一键让这一幕动起来并云端保存。",
            icon: "braces",
            padding: 8,
          },
        ];
  }

  return isEn
    ? [
        {
          id: "discover-search",
          selector: '[data-tour="discover-search"]',
          title: "Search Characters & Tags",
          body: "Search by character name, trope, or vibe across the entire library.",
          icon: "search",
          padding: 6,
        },
        {
          id: "discover-card",
          selector: '[data-tour="discover-card"]',
          title: "Pick a Story to Play",
          body: "Tap any card to preview the persona, alternate openings, and player comments before starting.",
          icon: "sparkles",
          padding: 6,
        },
        {
          id: "discover-nav",
          selector: '[data-tour="discover-nav"]',
          title: "Create & Messages",
          body: "Jump between discovery, live messages, and the creator studio from one bar.",
          icon: "compass",
          padding: 6,
        },
      ]
    : [
        {
          id: "discover-search",
          selector: '[data-tour="discover-search"]',
          title: "搜索角色与题材",
          body: "输入角色名、标签或剧情关键词，快速直达你最想玩的故事。",
          icon: "search",
          padding: 6,
        },
        {
          id: "discover-card",
          selector: '[data-tour="discover-card"]',
          title: "点开角色卡 · 看简介与评论",
          body: "点击任意卡片可预览人设、切换不同开场白、逛玩家评论区，并一键开聊。",
          icon: "sparkles",
          padding: 6,
        },
        {
          id: "discover-nav",
          selector: '[data-tour="discover-nav"]',
          title: "创作与陪伴随时切换",
          body: "在这里随时切到消息陪伴列表，或进入创作中心自制专属角色卡与小说。",
          icon: "compass",
          padding: 6,
        },
      ];
}
