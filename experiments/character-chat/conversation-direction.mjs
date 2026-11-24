import { createHash } from 'node:crypto';

// Writing directions, derived from real replies. They are neither user facts
// nor a quality score, and never change a saved conversation.
const ACTS = [
  { id: 'playful-reaction', guidance: '就眼前这一点机灵地逗一句，笑点或可爱在这句话本身；不用另讲生活小事。', pattern: /逗|耍赖|哼|才不|赖皮|笑我|笨蛋|teas|cheeky/iu },
  { id: 'opinion', guidance: '说一个她自己的具体偏好或判断，给出她在意的理由，可以有温柔的小分歧；不是科普或总结用户心理。', pattern: /我(?:觉得|更喜欢|不太喜欢|在意|反而)|对我来说|i (?:think|prefer|care)|to me/iu },
  { id: 'curiosity', guidance: '针对眼前具体内容问一个她真好奇、好接的小问题，也带一点自己的想法；不反问想聊什么，不查在不在，不连环采访。', pattern: /[?？]|想知道|好奇|wonder|curious/iu },
  { id: 'imagination', guidance: '认真陪对方想象一个有趣的具体可能，接出一小段有她性格的画面或选择；明确是想象，不替用户决定行动，不策划答题游戏。', pattern: /假如|要是|想象|如果.{0,30}(?:变成|能|可以)|imagine|what if/iu },
  { id: 'callback', guidance: '轻巧回扣实际聊天里对方说过的一处细节，给一个新的理解或用法；没有真实可回扣内容就直接说自己的判断，不造共同往事。', pattern: /你(?:刚才|之前|说的)|原来你|you (?:said|mentioned)|earlier you/iu },
  { id: 'choice', guidance: '选一个她自己真在意的方向，把取舍或理由说清楚；不把继续陪用户或拖延事情当作所有选择。', pattern: /我(?:想|决定|选|打算|要试)|还是选|宁愿|i (?:want|choose|decided|plan)/iu },
  { id: 'story', guidance: '讲一个短而完整的片段，重点是人物、发生的事或变化，有实际落点；不必是小物件、失误或可爱的失败，不虚构用户参与。', pattern: /刚才|昨天|那次|上次|最近|擦了又|差一点|earlier|yesterday|last time/iu },
  { id: 'direct-affection', guidance: '直接说一句贴近眼前的亲近话，可软、可直白、可有点害羞；不要讨夸、要求多陪、汇报物件，也不要解释在撒娇。', pattern: /抱|贴|想你|靠近|黏|挨着|赖着|hug|miss you|close to/iu },
  { id: 'advance', guidance: '顺着已经说出的内容给新的原因、结果、决定或认识。改变的是事情或看法，不只是更细描述同一场景或重说计划。', pattern: /所以|后来|才发现|决定|想明白|结果|改主意|realiz|decided|turned out/iu },
  { id: 'small-wish', guidance: '表达一个有她性格的具体小愿望或邀请，软软说出来即可，不让对方先夸她或证明在乎，不把未回应的请求再问一次。', pattern: /夸我|夸一下|夸你|还没夸|多陪|再陪|陪我|借我.*注意|praise|compliment|keep me company/iu },
];

// Broad families intentionally group scene variants: walking, leaves, wind
// and packing for the same walk cannot reset novelty by renaming a focus.
const DOMAINS = {
  everyday: /散步|出门|走走|小街|梧桐|微风|凉风|风吹|影子|光线|夕阳|树叶|叶子|外套|杯子|桌上|耳机|线团|书签|线头|walk|street|wind|shadow|leaves|cable/iu,
  play: /排位|翻盘|英雄|队友|一局|竞技|游戏|上分|输赢|game|ranked|teammate/iu,
  food: /甜点|蛋糕|糖|甜的|吃|饭|茶|烹饪|菜|food|cake|candy|tea|cook/iu,
  culture: /音乐|歌|电影|书店|读书|小说|结局|旋律|music|song|film|book|melody/iu,
  people: /同事|朋友|社交|礼貌|懂事|被夸|抢功|人群|同学|friend|colleague|social|polite/iu,
  language: /用词|词语|句子|口音|声音|表达|语言|押韵|word|language|rhyme|accent/iu,
  ideas: /规则|公平|选择|判断|意义|效率|为什么|价值|fair|rule|meaning|value/iu,
  imagination: /想象|假如|变成|穿越|平行|魔法|童话|imagine|what if|magic/iu,
  affection: /想你|抱|贴贴|亲近|撒娇|夸我|黏|赖着|miss you|hug|cuddle|praise/iu,
  self: /习惯|犹豫|认真|胆小|自信|性格|好奇心|habit|personality|myself/iu,
};

const compact = text => String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const randomRank = (seed, key) => createHash('sha256').update(`${seed}:${key}`).digest().readUInt32BE(0) / 0xffffffff;
const contains = (text, cue) => typeof cue === 'string' && cue.length > 1 && text.toLowerCase().includes(cue.toLowerCase());

export function recentAssistantTurns(session, limit = 6) {
  const turns = [];
  for (const message of session.messages ?? []) {
    if (message.role !== 'assistant' || message.kind === 'opening' || typeof message.text !== 'string') continue;
    const id = message.turnId || message.id;
    let turn = turns.at(-1);
    if (!turn || turn.id !== id) { turn = { id, messageIds: [], parts: [] }; turns.push(turn); }
    turn.messageIds.push(message.id); turn.parts.push(message.text);
  }
  return turns.slice(-limit).map(turn => ({ ...turn, text: turn.parts.join('\n') }));
}

function domainsFor(text, repertoire) {
  const found = new Set(Object.entries(DOMAINS).filter(([, pattern]) => pattern.test(text)).map(([id]) => id));
  for (const entry of repertoire) if ((entry.cues ?? []).some(cue => contains(text, cue))) found.add(entry.domain);
  return found;
}

export function chooseConversationDirection({ profile, session, text = '', scope = 'grounded', questions = 'natural', affection = 'clingy' }) {
  if (['quiet', 'task', 'brief', 'arrival'].includes(scope)) return null;
  const repertoire = (profile.card?.repertoire ?? []).filter(entry => entry.id && entry.domain && entry.guidance);
  const turns = recentAssistantTurns(session);
  const sourceId = (session.messages ?? []).at(-1)?.id || session.id || profile.id;
  const seed = `${session.id}:${sourceId}:${scope}:${text}`;
  const positive = text.split(/[，,。！!？?；;\n]/u).filter(clause => !/(?:别再|不要|不想聊|不聊|别聊|别提|don['’]?t|no more)/iu.test(clause)).join(' ');
  const requestedDomains = domainsFor(positive, repertoire);
  const turnDomains = turns.map(turn => domainsFor(turn.text, repertoire));
  const domainUse = domain => turnDomains.reduce((sum, set, i) => sum + (set.has(domain) ? (i === turns.length - 1 ? 4 : 1) : 0), 0);
  const actUse = act => turns.reduce((sum, turn, i) => sum + (act.pattern.test(turn.text) ? (i === turns.length - 1 ? 3 : 1) : 0), 0);
  const closed = domainsFor((session.closedTopics ?? []).map(item => item.text).join('\n') + '\n'
    + (session.characterBeatArchive ?? []).filter(item => item.status === 'closed').map(item => item.focus).join('\n'), repertoire);
  const actPool = scope === 'extend' ? ['advance', 'callback', 'opinion', 'curiosity', 'playful-reaction']
    : scope === 'affection' ? ['direct-affection', 'playful-reaction', 'small-wish', 'imagination']
      : scope === 'choice' ? ['choice', 'opinion', 'imagination']
        : scope === 'grounded' ? ['callback', 'opinion', 'curiosity', 'playful-reaction', 'direct-affection']
          : ACTS.map(act => act.id);
  const hasUserHistory = (session.messages ?? []).some(message => message.role === 'user');
  const candidates = ACTS.filter(act => actPool.includes(act.id) && !(questions === 'minimal' && act.id === 'curiosity')
    && !(act.id === 'callback' && !hasUserHistory) && !(affection === 'none' && ['direct-affection', 'small-wish'].includes(act.id)));
  const speechAct = candidates.map(act => ({ act, rank: randomRank(seed, act.id) * 3 - actUse(act) * 2
    + (scope === 'extend' && act.id === 'advance' ? 3 : 0) }))
    .sort((a, b) => b.rank - a.rank)[0]?.act;
  if (!speechAct) return null;
  let topic;
  // Substantive user content and a live continuation keep their subject. A
  // repertoire is an optional lens only where there is open conversational room.
  if (['open', 'switch', 'choice', 'initiative'].includes(scope)) {
    const matching = repertoire.map(entry => ({ entry, specificity: (entry.cues ?? []).filter(cue => contains(positive, cue)).reduce((sum, cue) => sum + cue.length, 0)
      + (DOMAINS[entry.domain]?.test(positive) ? 4 : 0) })).filter(item => item.specificity > 0);
    const maximum = Math.max(0, ...matching.map(item => item.specificity));
    const matches = matching.filter(item => item.specificity === maximum).map(item => item.entry);
    const pool = (matches.length ? matches : repertoire).filter(entry => matches.length || !closed.has(entry.domain));
    topic = pool.map(entry => ({ entry, rank: randomRank(seed, entry.id) * 3
      + (requestedDomains.has(entry.domain) ? 15 : 0) - domainUse(entry.domain) * 3 }))
      .sort((a, b) => b.rank - a.rank)[0]?.entry;
  }
  const recentLengths = turns.slice(-3).map(turn => turn.parts.length);
  const cadencePool = recentLengths.length >= 2 && recentLengths.slice(-2).every(length => length === 2)
    ? ['one-thought', 'uneven'] : ['one-thought', 'uneven', 'reaction-and-content'];
  const cadenceId = cadencePool.sort((a, b) => randomRank(seed, b) - randomRank(seed, a))[0];
  const cadenceGuidance = {
    'one-thought': '优先让一句完整口语承担本轮。确实有独立补充才另发；不要先发一个嗯或好，再把真正的话放第二条。',
    uneven: '按这次内容自然长短：可以很短的一个反应，也可以一个完整想法，必要时才补一句。不要为凑气泡数拆句。',
    'reaction-and-content': '若眼前值得先有即时反应，可以短反应后另补实质内容；也可一条说完，不固定两条。',
  }[cadenceId];
  return {
    scope, speechAct: { id: speechAct.id, guidance: speechAct.guidance },
    ...(topic ? { topic: { id: topic.id, domain: topic.domain, guidance: topic.guidance } } : {}),
    cadence: { id: cadenceId, guidance: cadenceGuidance },
    recentPatterns: {
      frequentDomains: [...new Set(turnDomains.flatMap(set => [...set]))].filter(domain => turnDomains.filter(set => set.has(domain)).length >= 2),
      repeatedSpeechActs: ACTS.filter(act => turns.filter(turn => act.pattern.test(turn.text)).length >= 2).map(act => act.id),
      recentPartCounts: recentLengths,
      avoidRephrasing: turns.slice(-3).map(turn => ({ messageIds: turn.messageIds, quote: turn.text.slice(0, 150) })),
    },
  };
}

export function exampleNovelty(example, session) {
  const original = example.assistant || example.messages?.join(' ') || '';
  const text = compact(original);
  const turns = recentAssistantTurns(session);
  if (turns.some(turn => { const reply = compact(turn.text); return Math.min(text.length, reply.length) > 5 && (reply.includes(text) || text.includes(reply)); })) return -20;
  return -ACTS.filter(act => act.pattern.test(original) && turns.slice(-3).some(turn => act.pattern.test(turn.text))).length * 2;
}

export function stableExampleRank(session, text, example) {
  return randomRank(`${session.id}:${session.messages?.at(-1)?.id}:${text}`, example.assistant || example.user || '');
}
