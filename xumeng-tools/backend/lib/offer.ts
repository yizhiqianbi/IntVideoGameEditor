/** 页面工具清单在 lib/workbench.ts。这里留下最早的四条入口。 */
export const STUDIO_TOOLS = [
  { id: "draw", label: "文生图", detail: "Nova Pro 先翻译，再设计提示词，然后交给 PornMaster。" },
  { id: "image", label: "模板出图", detail: "Qwen 多图编辑。角色图放进画面模板。" },
  { id: "clip", label: "文生视频", detail: "MiniMax H3 文生视频，大约 8 秒。" },
  { id: "video", label: "模板视频", detail: "MiniMax H3。角色图跟着动作模板走。" },
] as const;

export type StudioKind = (typeof STUDIO_TOOLS)[number]["id"];
