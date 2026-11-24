import { buildMessages, buildInitiativeMessages, parseResponse } from './engine.mjs';
import { CHARACTERS } from './characters.mjs';
import { readModelStream } from './streaming.mjs';
import { buildPlannerMessages, parsePlan } from './planner.mjs';
import { buildReplyerMessages } from './replyer-context.mjs';

const fail = (message, status = 502) => Object.assign(new Error(message), { status });

// Some DeepSeek initiative endpoints occasionally ignore response_format and
// return the one thing the user can actually see: a plain chat line.  Keep the
// compatibility path deliberately narrow.  It is only used for allowEmpty
// background generation, and JSON-looking output still goes through the
// strict parser so malformed foreground replies cannot be silently accepted.
function plainInitiativeText(content) {
  if (typeof content !== 'string') return null;
  const text = content.trim();
  if (!text || text.length > 600) return null;
  if (/^(?:```|[\[{]|<think\b)/iu.test(text) || /[\]}]/u.test(text)) return null;
  return text;
}

export function providerConfig(env = {}) {
  const apiKey = env.CHARACTER_CHAT_API_KEY || env.OPENROUTER_API_KEY || '';
  const baseUrl = (env.CHARACTER_CHAT_BASE_URL || env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  // Keep the standalone prototype aligned with the XUMENG companion default.
  // An explicit CHARACTER_CHAT_MODEL or OPENROUTER_MODEL still wins, so this
  // remains easy to point at another OpenAI-compatible endpoint for evaluation.
  const model = env.CHARACTER_CHAT_MODEL || env.OPENROUTER_MODEL || 'deepseek/deepseek-v4.1-flash';
  // OpenRouter has model-specific reasoning defaults. Keep the old Grok
  // default for compatibility, while allowing a deployment to opt into a
  // larger Gemini/Grok profile without changing source code.
  const reasoningEffort = normalizeReasoningEffort(env.CHARACTER_CHAT_REASONING_EFFORT)
    || normalizeReasoningEffort(env.OPENROUTER_REASONING_EFFORT);
  let valid = false;
  try {
    const url = new URL(baseUrl);
    valid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch {}
  return { apiKey, baseUrl, model, reasoningEffort, configured: valid && Boolean(apiKey) && !/[\r\n]/.test(apiKey + model + (reasoningEffort || '')) };
}

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

export function normalizeReasoningEffort(value) {
  const effort = String(value || '').trim().toLowerCase();
  return REASONING_EFFORTS.has(effort) ? effort : null;
}

// Clearly marked offline examples: they exercise the UI and storage, not language-model quality.
function demoResponse(session, text) {
  const english = session.effectiveLocale === 'en';
  const japanese = session.effectiveLocale === 'ja';
  const yume = session.characterId === 'yume';
  const turns = session.messages.filter(m => m.role === 'user').length;
  const localeCommand = /speak\s+english|说英文|用英语|日本語|说日语|中文|chinese/i.test(text);
  const facts = [];
  const name = /(?:我叫|我的名字是|my name is\s+)([^，。！？\n,.!?]{1,40})/i.exec(text);
  const preference = /(?:我喜欢|我不喜欢|i (?:like|love|dislike)\s+)([^，。！？\n,.!?]{1,90})/i.exec(text);
  const plan = /(?:我(?:明天|下周|周末|今天)要)([^，。！？\n]{1,90})/.exec(text);
  if (name) facts.push({ text: name[0], category: 'profile', quote: name[0] });
  if (preference) facts.push({ text: preference[0], category: 'preference', quote: preference[0] });
  if (plan) facts.push({ text: plan[0], category: 'plan', quote: plan[0] });
  let reply;
  if (japanese) {
    reply = localeCommand ? 'うん、日本語で話そう。今日はどんな一日だった？' : 'ちゃんと聞いてるよ。少し休んでから、気になることをひとつずつ話してみよう。';
  } else if (localeCommand) {
    reply = english ? 'English it is. I just put my notes away, so you have my attention. What’s on your mind?' : '好，接下来用中文。我刚把手边的事放下了，听你说。';
  } else if (facts.length) {
    reply = english ? 'Got it — I’ll keep that detail in mind. I’m glad you told me.' : `${name ? `${name[1].trim()}，记住了。` : '这件事我记住了。'}${yume ? '我刚结束一局，正好能认真听你说。' : '我把画笔放下了，你可以慢慢说。'}`;
  } else if (/累|压力|难过|tired|stressed|sad/i.test(text)) {
    reply = english ? 'That sounds like a lot to carry. We can slow down a little. Do you want to talk it through, or just sit here together for a minute?' : '听起来你今天已经撑了很久。先缓一缓吧。想讲讲发生了什么，或者就安静待一会儿，都可以。';
  } else if (/记得|记住|remember/i.test(text)) {
    const memory = session.memories.at(-1);
    reply = memory ? (english ? `You told me: “${memory.text}”. That’s the detail I have, so I won’t pretend I know more.` : `你告诉过我：“${memory.text}”。我记得这点，其他没说过的我就不乱猜了。`) : (english ? 'I don’t have a detail about you yet. Tell me something you’d like me to remember.' : '现在还没有记下关于你的具体信息。你愿意的话，可以告诉我一件想让我记住的事。');
  } else {
    const zh = yume ? ['我刚把一页笔记摊开，你就来了。先陪你聊一会儿，复习可以晚一点。', '嗯，我在听。你刚才那句话，让我把手里的游戏暂停了。', '这话我得想一想。别急，我可不想敷衍你。'] : ['今天画了一下午，纸角都被我擦皱了。现在换个脑子，听你聊聊。', '嗯，接着说。我把画本合上了。', '我有点好奇，不过先听听你的想法。'];
    const en = yume ? ['I just opened my notes when you showed up. Studying can wait a minute.', 'I’m listening. You made me pause my game for this.', 'Let me think for a second. I don’t want to give you a throwaway answer.'] : ['I’ve been drawing all afternoon. Talking to you is a welcome change of pace.', 'Go on. I’ve closed my sketchbook.', 'I’m curious, but I want to hear what you think first.'];
    reply = (english ? en : zh)[turns % 3];
  }
  return parseResponse(JSON.stringify({ reply, emotion: /累|压力|难过|tired|stressed|sad/i.test(text) ? 'concerned' : 'friendly', moodReason: english ? 'Listening to the current message.' : '回应你刚刚说的话。', trustDelta: 0, closenessDelta: 0, memories: facts }));
}

export function createProvider(env = {}, { fetch: doFetch = globalThis.fetch } = {}) {
  const config = providerConfig(env);
  const plannerEnabled = env.CHARACTER_CHAT_PLANNER_ENABLED !== 'false';
  const plannerModel = String(env.CHARACTER_CHAT_PLANNER_MODEL || config.model).trim();
  const plannerEffort = normalizeReasoningEffort(env.CHARACTER_CHAT_PLANNER_REASONING_EFFORT) || 'none';
  const isGrok = config.model.startsWith('x-ai/grok');
  // Preserve the historical Grok request shape when no override is supplied.
  // An explicit effort always wins, including for Gemini and future models.
  const reasoningEffort = config.reasoningEffort || (isGrok ? 'low' : null);
  const reasoning = reasoningEffort
    ? { effort: reasoningEffort, ...(isGrok ? { exclude: true } : {}) }
    : null;
  const decide = async (session, text, { initiative = false, signal, now } = {}) => {
    const started = Date.now();
    if (!config.configured) throw fail('尚未配置模型。请配置服务端环境变量，或新建演示对话。', 503);
    if (!plannerModel || /[\r\n]/u.test(plannerModel)) throw fail('决策模型配置无效。', 503);
    try {
      const response = await doFetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'XUMENG Companion Planner' },
        body: JSON.stringify({ model: plannerModel, messages: buildPlannerMessages(session, text, { initiative, now }),
          stream: false, temperature: 0.35, max_tokens: 900, response_format: { type: 'json_object' },
          reasoning: { effort: plannerEffort, exclude: true } }),
      });
      if (!response.ok) throw fail('决策模型暂时无法响应。');
      const content = (await response.json()).choices?.[0]?.message?.content;
      const plan = parsePlan(content, { session, currentUserText: text, initiative, now });
      if (signal?.aborted) throw fail('这次生成已取消。', 409);
      // Foreground input always gets an acknowledgement. Waiting is a runtime
      // action for proactive opportunities, never a lost user turn.
      if (!initiative && plan.action !== 'reply') throw fail('本轮需要回复用户。');
      return { plan, trace: { mode: 'planner-replyer', action: plan.action, focus: plan.focus,
        tone: plan.tone, plannerModel, replyerModel: config.model, durationMs: Date.now() - started, fallback: false } };
    } catch (error) {
      if (signal?.aborted) throw Object.assign(fail('这次生成已取消。', 409), { code: 'CANCELLED' });
      // A failed director must not invent a proactive message. Foreground
      // requests may still use the existing validated reply pipeline.
      return { plan: null, trace: { mode: 'planner-replyer', action: initiative ? 'silent' : 'reply',
        plannerModel, replyerModel: config.model, durationMs: Date.now() - started,
        fallback: true, failure: error.code === 'INVALID_COMPANION_PLAN' ? 'invalid-plan' : 'planner-unavailable' } };
    }
  };
  const complete = async (session, messages, { currentUserText, allowEmpty = false, signal, onMessage } = {}) => {
      if (!config.configured) throw fail('尚未配置模型。请配置服务端环境变量，或新建演示对话。', 503);
      if (!CHARACTERS.some(c => c.id === session.characterId)) throw fail('找不到这个角色。', 400);
      let response;
      try {
        response = await doFetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Character Chat Local Prototype' },
          body: JSON.stringify({
            model: config.model, messages, stream: typeof onMessage === 'function',
            ...(typeof onMessage === 'function' ? { stream_options: { include_usage: true } } : {}),
            temperature: 0.8, max_tokens: 1800, response_format: { type: 'json_object' },
            ...(reasoning ? { reasoning } : {}),
          }),
        });
      } catch {
        if (signal?.aborted) throw Object.assign(fail('这次主动消息已取消。', 409), { code: 'CANCELLED' });
        throw fail('模型连接失败或超时。对话未保存这一轮，可以重试。', 504);
      }
      if (!response.ok) {
        const reasons = { 401: '模型凭据无效', 402: '模型额度不足', 403: '模型服务拒绝了请求', 404: '模型或接口不存在', 429: '模型暂时繁忙' };
        throw fail(`${reasons[response.status] || '模型服务暂时无法响应'}。对话未保存这一轮，可以重试。`, response.status === 429 ? 503 : 502);
      }
      let content;
      const streaming = typeof onMessage === 'function' && /text\/event-stream/iu.test(response.headers.get('content-type') || '');
      try {
        if (streaming) content = await readModelStream(response, { onMessage, signal });
        else content = (await response.json()).choices?.[0]?.message?.content;
      } catch (error) {
        if (signal?.aborted) throw Object.assign(fail('这次生成已取消。', 409), { code: 'CANCELLED' });
        if (Number.isInteger(error.status)) throw error;
        throw fail('模型响应格式无效。对话未保存这一轮，可以重试。');
      }
      let result;
      try {
        result = parseResponse(content, { currentUserText, allowEmpty });
      } catch (error) {
        const plain = allowEmpty ? plainInitiativeText(content) : null;
        if (!plain) { error.code = 'INVALID_MODEL_OUTPUT'; throw error; }
        result = parseResponse({ messages: [plain], emotion: 'friendly', followUp: null }, { currentUserText, allowEmpty: true });
      }
      if (!streaming && typeof onMessage === 'function') for (const [index, text] of result.messages.entries()) await onMessage({ index, text });
      return result;
  };
  const compose = async (session, messages, options, decision) => {
    try { return await complete(session, messages, options); }
    catch (error) {
      if (!plannerEnabled || !['INVALID_MODEL_OUTPUT', 'DIALOGUE_FORMAT'].includes(error.code) || options.signal?.aborted) throw error;
      // A single format repair keeps malformed JSON/narration out of storage.
      // Reuse the decision rather than paying for another planning round.
      const repair = [...messages, { role: 'system', content:
        '上一份输出未满足对白格式，未被保存。请重新生成符合契约的完整 JSON 对象：messages 为 1–3 条纯对白字符串（主动回合无内容可为 []），emotion 为合法枚举，life/beat 无新的事实请省略，followUp 无安排请用 null。不要 Markdown 围栏、角色名、动作括号或分析。保持当前用户目标，不补造历史。' }];
      const result = await complete(session, repair, { ...options, onMessage: undefined });
      if (decision) decision.trace.formatRepaired = true;
      return result;
    }
  };
  return {
    publicConfig: { configured: config.configured, model: config.model, defaultMode: config.configured ? 'ai' : 'demo', reasoningEffort,
      architecture: plannerEnabled ? 'planner-replyer' : 'single-replyer', plannerModel: plannerEnabled ? plannerModel : null },
    async generate(session, text, options = {}) {
      if (session.mode === 'demo') {
        const result = demoResponse(session, text);
        if (typeof options.onMessage === 'function') for (const [index, text] of result.messages.entries()) await options.onMessage({ index, text });
        return result;
      }
      const decision = plannerEnabled ? (options.decision || await decide(session, text, options)) : null;
      const messages = decision?.plan
        ? buildReplyerMessages(session, text, { ...options, plan: decision.plan })
        : buildMessages(session, text, { variation: options.variation === true });
      const result = await compose(session, messages, { ...options, currentUserText: text }, decision);
      return decision ? { ...result, control: decision } : result;
    },
    async generateInitiative(session, { signal, now = new Date().toISOString() } = {}) {
      if (session.mode === 'demo') {
        const messages = session.effectiveLocale === 'en'
          ? ['A tiny confession.', session.characterId === 'yume' ? 'I finished one line of my notes. The little cat in the margin took three tries, though.' : 'I erased that last line. I like the empty space a little more now.']
          : session.effectiveLocale === 'ja'
            ? ['ひとつだけ聞いて。', session.characterId === 'yume' ? 'ノート、一行だけ進んだよ。端っこの猫は三回も描き直したのに。' : '最後の線を消してみた。今は、この余白のほうが少し好き。']
            : ['跟你坦白个事。', session.characterId === 'yume' ? '笔记只多写了一行，边角的小猫倒画了三遍。唔，有一点点偏心。' : '我把最后那一笔擦掉了。现在喜欢多一点，刚才还有点舍不得。'];
        return parseResponse({ messages, emotion: 'playful' }, { allowEmpty: true });
      }
      const decision = plannerEnabled ? await decide(session, '', { initiative: true, signal, now }) : null;
      if (decision && decision.plan?.action !== 'reply') {
        return { ...parseResponse({ messages: [], emotion: 'calm', followUp: null }, { allowEmpty: true }), control: decision };
      }
      const messages = decision?.plan
        ? buildReplyerMessages(session, '', { plan: decision.plan, initiative: true, now })
        : buildInitiativeMessages(session, { now });
      const result = await compose(session, messages, { signal, allowEmpty: true }, decision);
      return decision ? { ...result, control: decision } : result;
    },
  };
}
