import type { HtmlGameArtifact, PlayAgentPlan, PlayAgentPlanInput } from "./types";

/**
 * The postMessage protocol between generated games and the host iframe.
 * Every game MUST speak this protocol so the harness can detect finish/error.
 */
export const HOST_BRIDGE_PROTOCOL = `
// 在游戏结束时必须调用：
//   window.parent.postMessage({ type: 'finish', score, summary }, '*')
// 失败、错误或主动退出时：
//   window.parent.postMessage({ type: 'error', message }, '*')
// 想上报中间事件（得分变化、关卡切换）：
//   window.parent.postMessage({ type: 'event', name, data }, '*')
`.trim();

const HTML_EXAMPLE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>__TITLE__</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; background: #0a0a0c; color: #f5f3ec;
    font-family: -apple-system, "Helvetica Neue", sans-serif; overflow: hidden;
    display: grid; place-items: center; user-select: none; touch-action: manipulation; }
  .stage { width: min(100%, 480px); aspect-ratio: 9/16; position: relative;
    background: radial-gradient(circle at 50% 30%, rgba(255,61,0,0.12), transparent 60%), #101013;
    border-radius: 18px; overflow: hidden; display: grid; place-items: center; }
  .hud { position: absolute; top: 14px; left: 14px; right: 14px;
    display: flex; justify-content: space-between; font-weight: 700; font-size: 13px; }
  .target { width: 84px; height: 84px; border-radius: 999px;
    background: radial-gradient(#ff7a3d, #c41e00); box-shadow: 0 0 40px rgba(255,61,0,0.6);
    display: grid; place-items: center; color: #fff; font-size: 34px;
    transform: translate(var(--tx,0), var(--ty,0)); transition: transform .18s ease; cursor: pointer; }
  .done { position: absolute; inset: 0; background: rgba(10,10,12,0.92);
    display: none; place-items: center; flex-direction: column; gap: 14px; padding: 24px; text-align: center; }
  .done.on { display: grid; }
  .done h2 { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; }
  .done p { color: rgba(255,255,255,0.7); font-size: 14px; }
  .done button { height: 44px; padding: 0 20px; border: none; border-radius: 999px;
    background: #ff3d00; color: #fff; font-weight: 700; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
<div class="stage">
  <div class="hud"><span id="score">0 分</span><span id="time">10s</span></div>
  <div class="target" id="target">⚡</div>
  <div class="done" id="done">
    <h2 id="doneTitle">结束</h2>
    <p id="doneSummary"></p>
    <button id="retry">再来一局</button>
  </div>
</div>
<script>
  const el = (id) => document.getElementById(id);
  let score = 0, time = 10, timer;
  const start = () => {
    score = 0; time = 10;
    el('score').textContent = '0 分';
    el('time').textContent = time + 's';
    el('done').classList.remove('on');
    clearInterval(timer);
    timer = setInterval(() => {
      time -= 1;
      el('time').textContent = time + 's';
      if (time <= 0) finish();
    }, 1000);
  };
  const finish = () => {
    clearInterval(timer);
    el('doneTitle').textContent = 'Nice! 你得了 ' + score + ' 分';
    el('doneSummary').textContent = '试试把分数冲到 20+';
    el('done').classList.add('on');
    parent.postMessage({ type: 'finish', score, summary: '点击反应 10 秒挑战' }, '*');
  };
  el('target').onclick = (e) => {
    score += 1;
    el('score').textContent = score + ' 分';
    const r = (s) => (Math.random()-0.5) * s;
    e.currentTarget.style.setProperty('--tx', r(180) + 'px');
    e.currentTarget.style.setProperty('--ty', r(280) + 'px');
    parent.postMessage({ type: 'event', name: 'tap', data: { score } }, '*');
  };
  el('retry').onclick = start;
  window.addEventListener('error', (ev) => {
    parent.postMessage({ type: 'error', message: String(ev.message || ev) }, '*');
  });
  start();
</script>
</body>
</html>`;

export function buildHtmlGameSystemPrompt() {
  return [
    "你是 Fun-X-Studio 的 H5 小游戏代码代理。",
    "你的输出必须是一个 **完整、自包含、单文件** 的 HTML，可以直接双击在浏览器里运行。",
    "",
    "## 硬性约束",
    "- 以 `<!DOCTYPE html>` 开头，包含 `<html>`、`<head>`、`<body>` 完整结构",
    "- 所有 CSS 写在 `<style>` 标签里，所有 JS 写在 `<script>` 标签里 — **禁止任何外部资源链接**（无 CDN、无 link、无 img src 外链、无 font import）",
    "- 视口默认 9:16 竖屏，可滑入手机屏幕，最大宽度 480px，aspect-ratio 9/16",
    "- 支持触摸和鼠标两种交互",
    "- 使用系统字体（-apple-system, Helvetica, sans-serif）",
    "- 用内联 SVG 或 emoji 替代图片资源",
    "",
    "## 宿主桥（必须实现）",
    HOST_BRIDGE_PROTOCOL,
    "",
    "## 质量要求",
    "- 视觉要像真游戏：深色背景、高对比前景、清楚的 HUD、清楚的状态切换（开始 → 进行中 → 结束）",
    "- 结束屏要有「重开」按钮，点击后能立即开始新一局",
    "- 错误要被 try/catch 兜住，然后通过 postMessage('error') 上报",
    "- 不要有 placeholder 文本、TODO、或未实现的入口",
    "",
    "## 输出格式",
    "只输出一段 HTML 代码块，包在 ```html ... ``` 里。不要加任何解释、不要 JSON 包装、不要前后缀。",
  ].join("\n");
}

export function buildHtmlGameUserPrompt(input: PlayAgentPlanInput, plan: PlayAgentPlan) {
  return [
    `## 游戏概念`,
    `${plan.concept}`,
    "",
    `## 核心循环`,
    `${plan.loop}`,
    "",
    `## 控制方式`,
    `${plan.controls.join("、")}`,
    "",
    `## 获胜条件`,
    `${plan.winCondition}`,
    "",
    `## 失败条件`,
    `${plan.failCondition}`,
    "",
    plan.progression ? `## 进度曲线\n${plan.progression}\n` : "",
    `## 用户原始需求`,
    `${input.prompt}`,
    "",
    `## 参考样例（你必须按这个结构组织，但游戏内容要完全重写以匹配上述概念）`,
    "```html",
    HTML_EXAMPLE.replace("__TITLE__", plan.concept),
    "```",
    "",
    "现在输出完整的 HTML，只输出一段 ```html ... ``` 代码块。",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Extract the <code>html</code> fenced block from LLM output.
 * Falls back to the entire text if it already looks like raw HTML.
 */
export function extractHtmlBlock(text: string): string {
  const fenced = text.match(/```(?:html|HTML)?\s*([\s\S]*?)```/);
  if (fenced?.[1] && /<!DOCTYPE\s+html/i.test(fenced[1])) {
    return fenced[1].trim();
  }
  if (/<!DOCTYPE\s+html/i.test(text)) {
    const start = text.search(/<!DOCTYPE\s+html/i);
    return text.slice(start).trim();
  }
  throw new Error("LLM 返回的内容里没有可解析的 HTML 代码块。");
}

/**
 * Validate a generated HTML string — returns warnings but doesn't reject.
 */
export function validateHtmlGame(html: string): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (!/<!DOCTYPE\s+html/i.test(html)) warnings.push("缺少 <!DOCTYPE html>");
  if (!/<script[^>]*>/i.test(html)) warnings.push("没有内联 <script>");
  if (!/postMessage/i.test(html)) warnings.push("没有调用 postMessage — 结束时宿主无法收到信号");
  if (/<link[^>]+href=["']https?:/i.test(html)) warnings.push("检测到外部 link — 违反自包含约束");
  if (/<script[^>]+src=["']https?:/i.test(html)) warnings.push("检测到外部 script — 违反自包含约束");
  return { ok: warnings.length === 0, warnings };
}

/**
 * Minimal, guaranteed-runnable HTML game for mock adapter and fallbacks.
 */
export function buildFallbackHtmlGame(
  title: string,
  description: string,
): HtmlGameArtifact {
  return {
    html: HTML_EXAMPLE.replace("__TITLE__", title),
    meta: { title, description, durationSec: 10 },
    runtime: { width: 480, height: 854, orientation: "portrait" },
  };
}
