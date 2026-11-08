"use client";

/* eslint-disable @next/next/no-img-element -- The experience uses local portrait crops with art-directed object positioning. */

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./female.module.css";

type Mood = "all" | "温柔" | "危险" | "治愈";
type Character = {
  id: string;
  name: string;
  role: string;
  scene: string;
  mood: Exclude<Mood, "all">;
  cover: string;
  intro: string;
  welcome: string;
  replies: string[];
};
type ChatMessage = { id: string; role: "assistant" | "user"; text: string };

const CHARACTERS: Character[] = [
  {
    id: "shenyan", name: "沈砚", role: "夜间美术馆守灯人", scene: "闭馆后的展厅，雨声替你把话说完。", mood: "温柔",
    cover: "/dzmm/exported-cards/foreverse-shenyan-cover.png", intro: "不追问，也不替你做决定。他只是把灯留到你想走的时候。",
    welcome: "你来了。今天的灯还亮着，想先从哪一件小事说起？",
    replies: ["那就先把今天放在门外吧。你不用马上变好，坐一会儿也算在往前走。", "我听见了。你不用把每个细节都解释清楚，我会留在这里。", "今晚的雨很慢，适合把心事说得慢一点。你想让我陪你安静，还是陪你聊聊？"],
  },
  {
    id: "peiyu", name: "裴聿", role: "旧书店的临时店长", scene: "江边的书店十点关门，但他总为你多留一盏灯。", mood: "治愈",
    cover: "/dzmm/exported-cards/foreverse-peiyu-cover.png", intro: "话不多，记性很好。你上次说喜欢的那一页，他已经夹好书签。",
    welcome: "书签还在原来的位置。今天想读一点什么，或者只想让我陪你待着？",
    replies: ["好，先不解决问题。你可以把肩膀放下来，剩下的明天再想。", "我替你记下了。等你愿意的时候，我们再从这里继续。", "你不用表现得很有力气。在我这里，疲惫也有它自己的位置。"],
  },
  {
    id: "huoyushen", name: "霍宇深", role: "只在凌晨出现的合伙人", scene: "高架桥下的最后一班车，他把沉默留给你。", mood: "危险",
    cover: "/dzmm/exported-cards/foreverse-huoyushen-cover.png", intro: "看起来什么都掌控着，唯独对你的情绪没有办法只做旁观者。",
    welcome: "我在。别急着说没事——今晚你可以把真话交给我。",
    replies: ["那就承认你累了。承认不是退让，是把主动权拿回来。", "我不需要你现在给答案。先告诉我，哪一部分最让你难受？", "好，我不逼你。等你想开口时，第一句话不用组织得漂亮。"],
  },
  {
    id: "jiangchiye", name: "江池野", role: "凌晨两点的电台主播", scene: "他在旧城天台读信，你在耳机另一端呼吸。", mood: "温柔",
    cover: "/dzmm/exported-cards/foreverse-jiangchiye-cover.png", intro: "擅长把难过讲成一首歌，也擅长在歌结束后认真听你。",
    welcome: "今晚的频率留给你。要不要先点一首，或者告诉我你现在的天气？",
    replies: ["收到。那我把这一段留白给你，等你想说的时候再按下播放。", "听起来像是很长的一天。来，跟着我的节奏慢慢呼吸一次。", "我会记得你此刻的声音——只在这次相遇里，留给你自己。"],
  },
];

const MOODS: { id: Mood; label: string }[] = [
  { id: "all", label: "全部" }, { id: "温柔", label: "温柔陪伴" }, { id: "危险", label: "危险心动" }, { id: "治愈", label: "安静治愈" },
];
const PROMPTS = ["我今天有点累", "陪我安静一会儿", "想听你说点什么"];
const initialMessages = (character: Character): ChatMessage[] => [{ id: `${character.id}-welcome`, role: "assistant", text: character.welcome }];

function replyFor(character: Character, message: string, turn: number) {
  const normalized = message.toLowerCase();
  if (/(累|疲惫|撑不住|难过|委屈|哭)/.test(normalized)) return character.replies[0];
  if (/(安静|不想说|陪我|在吗)/.test(normalized)) return character.replies[2];
  return character.replies[turn % character.replies.length];
}
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export default function FemaleXumengPage() {
  const [activeId, setActiveId] = useState(CHARACTERS[0].id);
  const [mood, setMood] = useState<Mood>("all");
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages(CHARACTERS[0]));
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [notice, setNotice] = useState("");
  const [showCharacters, setShowCharacters] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyTimer = useRef<number | null>(null);
  const character = CHARACTERS.find((item) => item.id === activeId) ?? CHARACTERS[0];
  const filteredCharacters = useMemo(() => mood === "all" ? CHARACTERS : CHARACTERS.filter((item) => item.mood === mood), [mood]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, typing]);
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
  }, []);
  function flashNotice(text: string) {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2600);
  }
  function selectCharacter(next: Character) {
    if (next.id === character.id) { setShowCharacters(false); return; }
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    setActiveId(next.id); setMessages(initialMessages(next)); setDraft(""); setTyping(false); setShowCharacters(false);
    flashNotice(`已和${next.name}重新开始一段轻盈的相遇`);
  }
  function resetConversation() {
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    setMessages(initialMessages(character)); setDraft(""); setTyping(false); flashNotice("这段对话已经清空，只留下新的开始");
  }
  function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || typing) return;
    const userMessage = { id: uid(), role: "user" as const, text: text.slice(0, 240) };
    const turn = messages.filter((item) => item.role === "user").length;
    setMessages((current) => [...current, userMessage]); setDraft(""); setTyping(true);
    replyTimer.current = window.setTimeout(() => {
      setMessages((current) => [...current, { id: uid(), role: "assistant", text: replyFor(character, text, turn) }]);
      setTyping(false);
      replyTimer.current = null;
    }, 720);
  }
  function onDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a className={styles.brand} href="#top" aria-label="叙梦女性向体验首页"><span className={styles.brandMark} aria-hidden>✦</span><span><strong>叙梦</strong><small>HER STORIES</small></span></a>
        <nav className={styles.nav} aria-label="主要导航"><a className={styles.navActive} href="#discover">发现</a><a href="#conversation">对话</a><a href="#about">关于这次体验</a></nav>
        <div className={styles.sessionBadge} title="不写入账号、云端或浏览器存储"><span className={styles.sessionDot} aria-hidden />本地体验 · 刷新即清空</div>
        <button className={styles.mobileMenu} type="button" onClick={() => setShowCharacters((open) => !open)} aria-expanded={showCharacters} aria-label="打开页面菜单"><span /><span /></button>
      </header>
      {showCharacters && <div className={styles.mobileMenuPanel} role="dialog" aria-label="页面菜单"><a href="#discover" onClick={() => setShowCharacters(false)}>发现角色 <span>01</span></a><a href="#conversation" onClick={() => setShowCharacters(false)}>开始对话 <span>02</span></a><a href="#about" onClick={() => setShowCharacters(false)}>关于体验 <span>03</span></a></div>}

      <section id="top" className={styles.hero}>
        <div className={styles.heroCopy}><p className={styles.eyebrow}><span /> 女性向 · 轻关系互动</p><h1>今晚，<em>和谁</em><br />交换一点心事？</h1><p className={styles.heroLead}>不必表演，不必留档。选一个让你想靠近的他，用一句话打开属于今晚的故事。</p><a className={styles.heroCta} href="#discover">挑选一位角色 <span aria-hidden>↓</span></a></div>
        <div className={styles.heroVisual} aria-label={`当前推荐角色：${character.name}`}><div className={styles.heroGlow} /><img src={character.cover} alt="" /><div className={styles.heroCaption}><span>TONIGHT&apos;S FREQUENCY</span><strong>{character.name}</strong><small>{character.role}</small></div><span className={styles.heroStamp}>01<br /><i>OF 04</i></span></div>
      </section>

      <section id="discover" className={styles.discover}>
        <div className={styles.sectionHead}><div><p className={styles.kicker}>01 / FIND YOUR FREQUENCY</p><h2>先选一个想靠近的人</h2></div><p className={styles.sectionNote}>每次选择都会开始一段新的临时对话<br />没有历史，也没有“应该怎样”的答案</p></div>
        <div className={styles.moodTabs} role="tablist" aria-label="角色氛围筛选">{MOODS.map((item) => <button key={item.id} className={mood === item.id ? styles.moodActive : ""} type="button" role="tab" aria-selected={mood === item.id} onClick={() => setMood(item.id)}>{item.label}</button>)}</div>
        <div className={styles.characterRail}>{filteredCharacters.map((item, index) => <button key={item.id} type="button" className={`${styles.characterCard} ${item.id === character.id ? styles.characterSelected : ""}`} onClick={() => selectCharacter(item)} aria-pressed={item.id === character.id}><span className={styles.characterNumber}>0{index + 1}</span><span className={styles.characterImage}><img src={item.cover} alt="" loading="lazy" /></span><span className={styles.characterInfo}><strong>{item.name}</strong><small>{item.role}</small><em>{item.mood}</em></span><span className={styles.characterArrow} aria-hidden>↗</span></button>)}</div>
      </section>

      <section id="conversation" className={styles.conversationSection}>
        <div className={styles.sectionHead}><div><p className={styles.kicker}>02 / A TEMPORARY ROOM</p><h2>现在就和{character.name}说句话</h2></div><button className={styles.resetButton} type="button" onClick={resetConversation}>清空本次对话 <span aria-hidden>↻</span></button></div>
        <div className={styles.chatLayout}>
          <aside className={styles.profilePanel}><div className={styles.profilePortrait}><img src={character.cover} alt={`${character.name}的角色封面`} /></div><p className={styles.profileMeta}>{character.mood} · {character.role}</p><h3>{character.name}</h3><p>{character.intro}</p><div className={styles.profileScene}><span>SCENE</span><strong>{character.scene}</strong></div></aside>
          <div className={styles.chatPanel}><div className={styles.chatHeader}><span className={styles.liveSignal}><i /> 正在此刻</span><span>只在这一次相遇里</span></div><div className={styles.transcript} aria-live="polite">{messages.map((message) => <div key={message.id} className={`${styles.messageRow} ${message.role === "user" ? styles.messageUser : ""}`}><span className={styles.messageAvatar}>{message.role === "user" ? "你" : character.name.slice(0, 1)}</span><p>{message.text}</p></div>)}{typing && <div className={styles.messageRow}><span className={styles.messageAvatar}>{character.name.slice(0, 1)}</span><p className={styles.typing} aria-label={`${character.name}正在输入`}><i /><i /><i /></p></div>}<div ref={endRef} /></div><div className={styles.composerArea}><div className={styles.promptRow} aria-label="快速开场">{PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => setDraft(prompt)}>{prompt}</button>)}</div><form className={styles.composer} onSubmit={sendMessage}><textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 240))} onKeyDown={onDraftKeyDown} placeholder={`对${character.name}说点什么…`} rows={1} maxLength={240} aria-label={`给${character.name}发送消息`} /><div className={styles.composerFooter}><span>{draft.length}/240 · Shift + Enter 换行</span><button type="submit" disabled={!draft.trim() || typing} aria-label="发送消息">发送 <span aria-hidden>↗</span></button></div></form></div></div>
        </div>
      </section>

      <section id="about" className={styles.about}><p className={styles.kicker}>03 / A QUIET PROMISE</p><div className={styles.aboutGrid}><h2>把选择权<br /><em>还给你。</em></h2><div><p>这是一个轻量的女性向角色体验。你可以靠近、停下、换一个人，或者什么都不说。</p><p className={styles.aboutFine}>当前版本不会请求聊天接口，不建立账号，不把输入写入 localStorage、sessionStorage 或云端。刷新页面，今晚就从头开始。</p></div></div></section>
      <footer className={styles.footer}><span>叙梦 / HER STORIES</span><span>MADE FOR A SOFTER NIGHT</span></footer>
      {notice && <div className={styles.toast} role="status">{notice}</div>}
    </main>
  );
}
