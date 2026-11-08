"use client";

/* eslint-disable @next/next/no-img-element -- Xumeng uses art-directed local cover crops. */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Icon, { type IconName } from "@/components/dzmm/icons";
import s from "@/components/dzmm/tavern.module.css";
import x from "./female.module.css";

type View = "characters" | "chat";
type BrowseTab = "新手" | "猜你喜欢" | "关注" | "最新" | "榜单" | "分类";
type ChatSection = "stories" | "chats" | "games";
type Tone = "温柔" | "危险" | "治愈" | "暧昧";
type Mood = "陪伴" | "心动" | "治愈" | "冒险";
type MoodOption = {
  id: Mood;
  label: string;
  hint: string;
  tones: Tone[];
  icon: IconName;
};
type Character = {
  id: string;
  name: string;
  role: string;
  line: string;
  intro: string;
  cover: string;
  tone: Tone;
  tags: string[];
  heat: string;
  online: string;
  replies: string[];
  moment: string;
  starter: string;
  compatibility: string;
};
type Message = { id: string; role: "assistant" | "user"; content: string };

const PEOPLE: Character[] = [
  {
    id: "shenyan",
    name: "沈砚",
    role: "夜间美术馆守灯人",
    line: "闭馆后的灯还亮着，你要进来坐坐吗？",
    intro: "不追问，也不替你做决定。他只是把灯留到你想走的时候。",
    cover: "/dzmm/exported-cards/foreverse-shenyan-cover.png",
    tone: "温柔",
    tags: ["慢热", "陪伴", "都市"],
    heat: "8.6k",
    online: "刚刚在线",
    replies: [
      "我听见了。你不用把每个细节都解释清楚，我会留在这里。",
      "那就先把今天放在门外吧。坐一会儿，也算在往前走。",
      "今晚的雨很慢，适合把心事说得慢一点。",
    ],
    moment: "闭馆后的灯还亮着，今晚适合把话说慢一点。",
    starter: "我今天有点累，想在这里待一会儿。",
    compatibility: "慢热陪伴 · 适合不想解释太多的夜晚",
  },
  {
    id: "peiyu",
    name: "裴聿",
    role: "旧书店的临时店长",
    line: "你上次停在那一页，我替你夹好了书签。",
    intro: "话不多，记性很好。你说喜欢的那一页，他从来没有忘记。",
    cover: "/dzmm/exported-cards/foreverse-peiyu-cover.png",
    tone: "治愈",
    tags: ["书店", "克制", "治愈"],
    heat: "7.9k",
    online: "在线",
    replies: [
      "好，先不解决问题。你可以把肩膀放下来，剩下的明天再想。",
      "我替你记下了。等你愿意的时候，我们再从这里继续。",
      "你不用表现得很有力气。在我这里，疲惫也有它的位置。",
    ],
    moment: "书店十点关门，但他总会为你多留一盏灯。",
    starter: "今天不想解决问题，只想听你说几句。",
    compatibility: "安静治愈 · 适合需要被稳稳接住的时刻",
  },
  {
    id: "huoyushen",
    name: "霍宇深",
    role: "只在凌晨出现的合伙人",
    line: "别急着说没事，今晚把真话交给我。",
    intro: "看起来什么都掌控着，唯独对你的情绪没有办法只做旁观者。",
    cover: "/dzmm/exported-cards/foreverse-huoyushen-cover.png",
    tone: "危险",
    tags: ["危险", "拉扯", "成年人"],
    heat: "9.2k",
    online: "刚刚在线",
    replies: [
      "那就承认你累了。承认不是退让，是把主动权拿回来。",
      "我不需要你现在给答案。先告诉我，哪一部分最难受？",
      "好，我不逼你。第一句话不用组织得漂亮。",
    ],
    moment: "凌晨两点，他把最后一个问题留给你：今晚要不要诚实一点？",
    starter: "别问我应该怎样，先陪我把真话说完。",
    compatibility: "危险拉扯 · 适合想要一点心跳的夜晚",
  },
  {
    id: "jiangchiye",
    name: "江池野",
    role: "凌晨两点的电台主播",
    line: "今晚的频率留给你，想点一首什么？",
    intro: "擅长把难过讲成一首歌，也擅长在歌结束后认真听你。",
    cover: "/dzmm/exported-cards/foreverse-jiangchiye-cover.png",
    tone: "暧昧",
    tags: ["电台", "声线", "暧昧"],
    heat: "8.1k",
    online: "在线",
    replies: [
      "那我把这一段留白给你，等你想说的时候再按下播放。",
      "听起来像是很长的一天。跟着我的节奏慢慢呼吸一次。",
      "我会记得你此刻的声音，只在这次相遇里。",
    ],
    moment: "夜间电台正在播一首没有名字的歌，点歌的人是你。",
    starter: "如果今晚有一首歌，你会替我选哪一首？",
    compatibility: "暧昧声线 · 适合想被温柔注意的夜晚",
  },
  {
    id: "jiangchiye-2",
    name: "江迟野",
    role: "雨夜里替你撑伞的人",
    line: "伞往你这边偏一点，别淋到了。",
    intro: "他习惯站在你身后半步，给你空间，也给你一个回头就能看见的方向。",
    cover: "/dzmm/exported-cards/foreverse-jiwenqing-cover.png",
    tone: "温柔",
    tags: ["雨夜", "日常", "慢慢来"],
    heat: "6.8k",
    online: "今天在线",
    replies: [
      "不用急着走。雨停之前，我们还有很多安静可以共享。",
      "我在你身边，不会替你安排下一步。",
      "你想往哪边走？这次我听你的。",
    ],
    moment: "雨还没有停，他把伞往你这边偏了一点。",
    starter: "陪我走一小段，不用急着说话。",
    compatibility: "日常陪伴 · 适合想慢慢靠近的人",
  },
  {
    id: "niexiaoqian",
    name: "宁昭",
    role: "旧城里不肯熄灯的画家",
    line: "我画了一半，剩下的留给你决定。",
    intro: "有一点锋利，有一点浪漫。她不保证结局，只邀请你一起把故事画完。",
    cover: "/dzmm/exported-cards/foreverse-nie-xiaoqian-cover.png",
    tone: "暧昧",
    tags: ["艺术家", "旧城", "自由"],
    heat: "7.4k",
    online: "刚刚在线",
    replies: [
      "不用把答案交给别人。你的故事，当然由你来落笔。",
      "如果今天只能留下一种颜色，你想选哪一种？",
      "好，我听你的。我们从最想改写的那一笔开始。",
    ],
    moment: "画布上还留着一半空白，她把最后一笔交给你。",
    starter: "如果可以改写今天，你会先改哪一笔？",
    compatibility: "自由暧昧 · 适合想把故事写得特别一点",
  },
];

const BROWSE_TABS: BrowseTab[] = [
  "新手",
  "猜你喜欢",
  "关注",
  "最新",
  "榜单",
  "分类",
];
const MOODS: MoodOption[] = [
  {
    id: "陪伴",
    label: "想被陪着",
    hint: "不用解释太多",
    tones: ["温柔", "治愈"],
    icon: "heart",
  },
  {
    id: "心动",
    label: "想要心跳",
    hint: "一点危险拉扯",
    tones: ["危险", "暧昧"],
    icon: "flame",
  },
  {
    id: "治愈",
    label: "想安静下来",
    hint: "把今天放在门外",
    tones: ["治愈", "温柔"],
    icon: "sun",
  },
  {
    id: "冒险",
    label: "想换个世界",
    hint: "从一句故事开始",
    tones: ["暧昧", "危险"],
    icon: "sparkles",
  },
];
const QUICK_REPLIES = ["我今天有点累", "陪我安静一会儿", "想听你说点什么"];
const LOCAL_GAMES = ["雨夜电台", "记忆翻页", "月光拼图"];
const initialMessages = (person: Character): Message[] => [
  { id: `${person.id}-opening`, role: "assistant", content: person.line },
];
function replyFor(person: Character, text: string, turn: number) {
  if (/(累|疲惫|撑不住|难过|委屈|哭)/.test(text)) return person.replies[0];
  if (/(安静|不想说|陪我|在吗)/.test(text)) return person.replies[2];
  return person.replies[turn % person.replies.length];
}
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function FemaleXumengPage() {
  const [view, setView] = useState<View>("characters");
  const [tab, setTab] = useState<BrowseTab>("新手");
  const [mood, setMood] = useState<Mood | null>(null);
  const [chatSection, setChatSection] = useState<ChatSection>("stories");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recommended");
  const [dark, setDark] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [chatListOpen, setChatListOpen] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const replyTimer = useRef<number | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const active = PEOPLE.find((person) => person.id === activeId) ?? null;
  const activeMood = MOODS.find((item) => item.id === mood) ?? null;

  const visiblePeople = useMemo(() => {
    const term = query.trim().toLowerCase();
    let list = PEOPLE.filter((person) => {
      if (tab === "关注") return favoriteIds.includes(person.id);
      if (tab === "榜单") return Number.parseFloat(person.heat) >= 8;
      if (tab === "分类")
        return person.tone === "温柔" || person.tone === "治愈";
      return true;
    });
    if (mood)
      list = list.filter((person) => activeMood?.tones.includes(person.tone));
    if (term)
      list = list.filter((person) =>
        `${person.name}${person.role}${person.intro}${person.tags.join("")}`
          .toLowerCase()
          .includes(term),
      );
    if (sort === "heat")
      list = [...list].sort(
        (a, b) => Number.parseFloat(b.heat) - Number.parseFloat(a.heat),
      );
    if (sort === "name")
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, "zh"));
    return list;
  }, [activeMood?.tones, favoriteIds, mood, query, sort, tab]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, typing]);
  useEffect(
    () => () => {
      if (replyTimer.current) window.clearTimeout(replyTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  useEffect(() => {
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setProfileOpen(false);
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);
  function flash(text: string) {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2600);
  }
  function chooseMood(nextMood: Mood) {
    setMood((current) => (current === nextMood ? null : nextMood));
    setTab("猜你喜欢");
    setQuery("");
  }
  function toggleFavorite(person: Character) {
    setFavoriteIds((current) =>
      current.includes(person.id)
        ? current.filter((id) => id !== person.id)
        : [...current, person.id],
    );
    flash(
      favoriteIds.includes(person.id)
        ? `已移除${person.name}`
        : `已收藏${person.name}`,
    );
  }
  function focusMood() {
    setView("characters");
    setMenuOpen(false);
    window.setTimeout(
      () =>
        document
          .getElementById("female-mood")
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  }
  function openCharacter(person: Character) {
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    setActiveId(person.id);
    setMessages(initialMessages(person));
    setDraft("");
    setTyping(false);
    setProfileOpen(false);
    setView("chat");
    setMenuOpen(false);
    flash(`已打开和${person.name}的临时故事`);
  }
  function returnToCharacters() {
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    setTyping(false);
    setProfileOpen(false);
    setView("characters");
    setMenuOpen(false);
  }
  function resetChat() {
    if (!active) return;
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    setMessages(initialMessages(active));
    setDraft("");
    setTyping(false);
    flash("这段临时故事已清空，刷新后也不会保留");
  }
  function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!active || !text || typing) return;
    const turn = messages.filter((message) => message.role === "user").length;
    setMessages((current) => [
      ...current,
      { id: uid(), role: "user", content: text.slice(0, 240) },
    ]);
    setDraft("");
    setTyping(true);
    replyTimer.current = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { id: uid(), role: "assistant", content: replyFor(active, text, turn) },
      ]);
      setTyping(false);
      replyTimer.current = null;
    }, 720);
  }
  function onDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className={`${s.app} ${dark ? s.dark : ""}`}>
      <aside className={s.appRail} aria-label="主导航">
        <button
          type="button"
          className={s.railUser}
          onClick={() => flash("这是独立女性向体验")}
        >
          {" "}
          <span className={s.avatar}>你</span>
          <strong>本地体验</strong>
        </button>
        <nav>
          <a
            href="#characters"
            className={view === "characters" ? s.navActive : ""}
            onClick={(event) => {
              event.preventDefault();
              returnToCharacters();
            }}
          >
            <Icon name="users" size={18} />
            角色广场
          </a>
          <a
            href="#chat"
            className={view === "chat" ? s.navActive : ""}
            onClick={(event) => {
              event.preventDefault();
              if (active) setView("chat");
              else flash("先从角色广场选一个人");
            }}
          >
            <Icon name="chat" size={18} />
            临时聊天
          </a>
          <a
            href="#discover"
            onClick={(event) => {
              event.preventDefault();
              flash("女性向发现正在准备中");
            }}
          >
            <Icon name="compass" size={18} />
            发现
          </a>
          <a
            href="#create"
            onClick={(event) => {
              event.preventDefault();
              flash("创作入口暂时保持独立");
            }}
          >
            <Icon name="edit" size={18} />
            创作
          </a>
        </nav>
        <p className={s.railLabel}>独立体验</p>
        <nav>
          <a
            href="#female-mood"
            onClick={(event) => {
              event.preventDefault();
              focusMood();
            }}
          >
            <Icon name="sun" size={18} />
            今日心情
          </a>
          <a
            href="#data"
            onClick={(event) => {
              event.preventDefault();
              flash("当前版本不保存聊天数据");
            }}
          >
            <Icon name="book" size={18} />
            数据说明
          </a>
        </nav>
      </aside>
      <header className={s.topbar}>
        <button
          className={s.logo}
          type="button"
          onClick={returnToCharacters}
          aria-label="叙梦角色广场"
        >
          <img
            src="/dzmm/brand/xumeng-mark.svg"
            width="36"
            height="36"
            alt=""
            aria-hidden="true"
          />
          <span>
            叙梦 <small>XUMENG</small>
          </span>
        </button>
        <nav className={s.mainNav} aria-label="主导航">
          <a
            href="#characters"
            className={view === "characters" ? s.navActive : ""}
            onClick={(event) => {
              event.preventDefault();
              returnToCharacters();
            }}
          >
            <Icon name="users" size={17} />
            角色
          </a>
          <a
            href="#chat"
            className={view === "chat" ? s.navActive : ""}
            onClick={(event) => {
              event.preventDefault();
              if (active) setView("chat");
              else flash("先从角色广场选一个人");
            }}
          >
            <Icon name="chat" size={17} />
            聊天
          </a>
          <a
            href="#moments"
            onClick={(event) => {
              event.preventDefault();
              flash("女性向动态正在准备中");
            }}
          >
            <Icon name="compass" size={17} />
            发现
          </a>
          <a
            href="#create"
            onClick={(event) => {
              event.preventDefault();
              flash("创作入口暂时保持独立");
            }}
          >
            <Icon name="edit" size={17} />
            创作
          </a>
          <a
            href="#invite"
            className={s.mainReferralEntry}
            onClick={(event) => {
              event.preventDefault();
              flash("这是一次不留档的独立体验");
            }}
          >
            <Icon name="heart" size={15} />
            女性向体验<strong>本地</strong>
          </a>
        </nav>
        <div className={s.navDisclosure}>
          <button
            className={s.navTrigger}
            type="button"
            aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className={s.navBurger}>
              <i />
              <i />
              <i />
            </span>
            <span className={s.navTriggerLabel}>菜单</span>
          </button>
        </div>
        <label className={s.search}>
          <Icon name="search" size={18} />
          <input
            aria-label="搜索角色"
            placeholder="搜索角色、剧情或氛围"
            maxLength={60}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => setQuery("")}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
        <button
          className={s.iconButton}
          type="button"
          aria-label={dark ? "切换浅色" : "切换深色"}
          onClick={() => setDark((value) => !value)}
        >
          <Icon name={dark ? "moon" : "sun"} size={19} />
        </button>
        <div className={s.topEnd}>
          <button
            className={s.account}
            type="button"
            onClick={() => flash("独立版本暂不需要注册或登录")}
          >
            <span className={s.avatar}>你</span>
            <span>本地体验</span>
          </button>
        </div>
      </header>
      {menuOpen && (
        <div className={s.navOverlay} role="dialog" aria-label="页面菜单">
          <button
            className={s.navBackdrop}
            type="button"
            aria-label="关闭菜单"
            onClick={() => setMenuOpen(false)}
          />
          <div className={s.navDrawer}>
            <button
              type="button"
              className={s.navClose}
              onClick={() => setMenuOpen(false)}
              aria-label="关闭菜单"
            >
              ×
            </button>
            <div className={s.navBrand}>
              <img src="/dzmm/brand/xumeng-mark.svg" alt="" />
              <span>
                叙梦<small>HER STORIES</small>
              </span>
            </div>
            <nav className={s.navList}>
              <a
                href="#characters"
                aria-current={view === "characters" ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  returnToCharacters();
                }}
              >
                角色广场
              </a>
              <a
                href="#female-mood"
                onClick={(event) => {
                  event.preventDefault();
                  focusMood();
                }}
              >
                今日心情
              </a>
              <a
                href="#chat"
                aria-current={view === "chat" ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (active) setView("chat");
                  else flash("先从角色广场选一个人");
                  setMenuOpen(false);
                }}
              >
                临时聊天
              </a>
              <a
                href="#about"
                onClick={(event) => {
                  event.preventDefault();
                  flash("当前版本不保存聊天数据");
                  setMenuOpen(false);
                }}
              >
                数据说明
              </a>
            </nav>
            <div className={s.navDrawerFooter}>
              <button
                className={s.navDrawerTool}
                type="button"
                onClick={() => setDark((value) => !value)}
              >
                <Icon name={dark ? "moon" : "sun"} size={17} />
                {dark ? "浅色模式" : "深色模式"}
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "characters" && (
        <>
          <div className={s.browseNav}>
            <div className={s.browseHead}>
              <div className={s.tabScroll}>
                <nav className={s.tabs} aria-label="浏览角色">
                  {BROWSE_TABS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="tab"
                      aria-selected={tab === item}
                      className={tab === item ? s.tabActive : ""}
                      onClick={() => {
                        setTab(item);
                        setQuery("");
                      }}
                    >
                      {item === "榜单" && <Icon name="trophy" size={15} />}{" "}
                      {item}
                    </button>
                  ))}
                </nav>
              </div>
              <label className={s.sortSelect}>
                <span>排序</span>
                <select
                  aria-label="排序"
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="recommended">推荐</option>
                  <option value="heat">热度</option>
                  <option value="name">名称</option>
                </select>
              </label>
            </div>
          </div>
          <main className={s.catalog}>
            <section className={s.catalogHero}>
              <div>
                <span className={s.eyebrow}>
                  FEMALE-ORIENTED · PRIVATE PREVIEW
                </span>
                <h1>
                  {activeMood
                    ? `${activeMood.label}，从一个人开始`
                    : "今晚想要的故事，从一句感觉开始"}
                </h1>
                <p>
                  {activeMood
                    ? `${activeMood.hint}。选一个让你想靠近的人，故事会从你按下发送的那一刻开始。`
                    : "先告诉我你现在想要的感觉，再从一个角色、一段片段或一句话开始。"}
                </p>
              </div>
              <div className={s.catalogStats}>
                <span>角色</span>
                <strong>{visiblePeople.length}</strong>
                <span>本地</span>
                <strong>100%</strong>
                <span>记录</span>
                <strong>0</strong>
              </div>
            </section>
            <section
              className={x.moodSection}
              id="female-mood"
              aria-labelledby="female-mood-title"
            >
              <div className={x.moodHeader}>
                <div>
                  <span id="female-mood-title">今晚想要什么？</span>
                  <small>选一种感觉，推荐会跟着变</small>
                </div>
                {mood && (
                  <button
                    className={x.moodClear}
                    type="button"
                    onClick={() => setMood(null)}
                  >
                    清除选择
                  </button>
                )}
              </div>
              <div className={x.moodOptions}>
                {MOODS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={mood === option.id}
                    className={`${x.moodOption} ${mood === option.id ? x.moodOptionActive : ""}`}
                    onClick={() => chooseMood(option.id)}
                  >
                    <span className={x.moodIcon}>
                      <Icon name={option.icon} size={15} />
                    </span>
                    <span className={x.moodCopy}>
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <div className={x.momentBar}>
              <div className={x.momentCopy}>
                <span className={x.momentLabel}>
                  今日片段 · {activeMood?.label ?? "为你挑选"}
                </span>
                <strong>
                  {visiblePeople[0]?.name ?? "叙梦"}：
                  {visiblePeople[0]?.moment ??
                    "换个关键词，下一段故事正在等你。"}
                </strong>
              </div>
              {visiblePeople[0] && (
                <button
                  className={x.momentAction}
                  type="button"
                  onClick={() => openCharacter(visiblePeople[0])}
                >
                  打开片段 <Icon name="chevron" size={14} />
                </button>
              )}
            </div>
            {visiblePeople.length ? (
              <div className={s.cardGrid}>
                {visiblePeople.map((person) => (
                  <article key={person.id} className={s.card}>
                    <button
                      type="button"
                      className={s.coverButton}
                      onClick={() => openCharacter(person)}
                      aria-label={`和${person.name}开始故事`}
                    >
                      <img src={person.cover} alt="" />
                      <div className={s.coverTags}>
                        {person.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                      <span className={s.heat}>
                        <Icon name="heart" size={13} />
                        {person.heat}
                      </span>
                      <span className={s.localBadge}>{person.online}</span>
                    </button>
                    <div className={s.cardBody}>
                      <button
                        className={s.cardText}
                        type="button"
                        onClick={() => openCharacter(person)}
                      >
                        <h2>{person.name}</h2>
                        <p>
                          {person.role} · {person.intro}
                        </p>
                      </button>
                      <div className={s.cardFooter}>
                        <span className={s.author}>
                          <span className={s.authorAvatar}>
                            {person.name.slice(0, 1)}
                          </span>
                          女性向角色
                        </span>
                        <button
                          type="button"
                          className={
                            favoriteIds.includes(person.id) ? s.liked : s.like
                          }
                          aria-label={
                            favoriteIds.includes(person.id)
                              ? `取消收藏${person.name}`
                              : `收藏${person.name}`
                          }
                          aria-pressed={favoriteIds.includes(person.id)}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFavorite(person);
                          }}
                        >
                          <Icon name="heart" size={14} />
                          {favoriteIds.includes(person.id) ? "已收藏" : "收藏"}
                        </button>
                        <button
                          type="button"
                          className={s.favorited}
                          aria-label={`和${person.name}开始故事`}
                          onClick={() => openCharacter(person)}
                        >
                          <Icon name="chat" size={14} />
                          开始
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={s.empty}>
                <Icon name="search" size={36} />
                <h2>
                  {tab === "关注" ? "还没有收藏角色" : "没有找到合适的角色"}
                </h2>
                <p>
                  {tab === "关注"
                    ? "在角色卡上点一下收藏，下一次回来就能直接找到。"
                    : "换一个关键词，或者先看看全部角色。"}
                </p>
                <button
                  className={s.primary}
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setTab("新手");
                    setMood(null);
                  }}
                >
                  浏览全部
                </button>
              </div>
            )}
            <div className={s.shelfMore}>
              <p>当前版本不加载云端目录 · 刷新后恢复默认角色</p>
            </div>
          </main>
          <footer className={s.footer}>
            <span>叙梦 · 与角色相遇，让故事继续。</span>
            <button
              type="button"
              onClick={() =>
                flash("女性向独立副本：不注册、不留档、不调用聊天接口")
              }
            >
              数据说明
            </button>
            <button
              type="button"
              onClick={() => flash("当前共有 6 位本地角色")}
            >
              角色来源
            </button>
            <button type="button" onClick={() => setDark((value) => !value)}>
              {dark ? "浅色模式" : "深色模式"}
            </button>
          </footer>
        </>
      )}

      {view === "chat" && active && (
        <main
          className={s.chatLayout}
          data-list={chatListOpen ? "open" : "closed"}
        >
          <aside
            id="female-chat-list"
            className={`${s.chatSidebar} ${s.hasActive}`}
          >
            <label className={s.conversationSearch}>
              <Icon name="search" size={16} />
              <input
                aria-label="搜索临时故事"
                placeholder="搜索故事、角色或剧情"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className={s.filters} role="group" aria-label="互动分类">
              <button
                type="button"
                className={chatSection === "stories" ? s.filterActive : ""}
                aria-pressed={chatSection === "stories"}
                onClick={() => setChatSection("stories")}
              >
                故事
              </button>
              <button
                type="button"
                className={chatSection === "chats" ? s.filterActive : ""}
                aria-pressed={chatSection === "chats"}
                onClick={() => setChatSection("chats")}
              >
                聊天
              </button>
              <button
                type="button"
                className={chatSection === "games" ? s.filterActive : ""}
                aria-pressed={chatSection === "games"}
                onClick={() => setChatSection("games")}
              >
                游戏
              </button>
            </div>
            <div className={s.conversationList} aria-label="临时会话列表">
              {chatSection === "games"
                ? LOCAL_GAMES.map((game) => (
                    <button
                      key={game}
                      className={s.conversation}
                      type="button"
                      onClick={() => flash(`${game}会在独立版本的下一轮加入`)}
                    >
                      <span className={s.unavailableAvatar}>
                        <Icon name="game" size={20} />
                      </span>
                      <span>
                        <strong>{game}</strong>
                        <small>本地互动预览</small>
                      </span>
                    </button>
                  ))
                : PEOPLE.filter(
                    (person) =>
                      !query.trim() ||
                      `${person.name}${person.role}`.includes(query.trim()),
                  ).map((person) => (
                    <button
                      key={person.id}
                      className={`${s.conversation} ${activeId === person.id ? s.conversationActive : ""}`}
                      type="button"
                      onClick={() => openCharacter(person)}
                    >
                      <span className={s.conversationAvatar}>
                        <img src={person.cover} alt="" />
                      </span>
                      <span>
                        <strong>{person.name}</strong>
                        <time className={s.conversationTime}>
                          {person.online.replace("在线", "")}
                        </time>
                        <small>{person.line}</small>
                      </span>
                    </button>
                  ))}
            </div>
            <button
              className={s.importConversation}
              type="button"
              onClick={() => flash("独立版本暂不导入历史会话")}
            >
              ＋ 只在本次创建
            </button>
          </aside>
          <button
            type="button"
            className={s.chatListToggle}
            aria-expanded={chatListOpen}
            aria-controls="female-chat-list"
            aria-label={chatListOpen ? "收起会话列表" : "展开会话列表"}
            onClick={() => setChatListOpen((open) => !open)}
          >
            <Icon name="chevron" size={16} />
          </button>
          <section className={s.chatMain}>
            <header className={s.chatHeader}>
              <button
                className={`${s.iconButton} ${s.mobileBack}`}
                type="button"
                aria-label="返回角色广场"
                onClick={returnToCharacters}
              >
                <Icon name="chevron" size={18} />
              </button>
              <button
                className={s.chatIdentity}
                type="button"
                onClick={() => setProfileOpen(true)}
              >
                <img src={active.cover} alt="" />
                <span>
                  <strong>{active.name}</strong>
                  <small>
                    <span className={s.onlineDot} />
                    {active.online}
                  </small>
                </span>
              </button>
              <div className={s.chatHeaderTools}>
                <button
                  className={s.iconButton}
                  type="button"
                  aria-label="查看角色信息"
                  onClick={() => setProfileOpen(true)}
                >
                  <Icon name="book" size={17} />
                </button>
                <button
                  className={s.iconButton}
                  type="button"
                  aria-label={
                    favoriteIds.includes(active.id)
                      ? "取消收藏角色"
                      : "收藏角色"
                  }
                  aria-pressed={favoriteIds.includes(active.id)}
                  onClick={() => toggleFavorite(active)}
                >
                  <Icon name="heart" size={17} />
                </button>
                <button
                  className={s.iconButton}
                  type="button"
                  aria-label="清空临时故事"
                  onClick={resetChat}
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
            </header>
            <div className={s.messageScroll}>
              <div className={s.messageList}>
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    className={`${s.messageRow} ${message.role === "user" ? s.userRow : ""} ${index > 0 && messages[index - 1]?.role === message.role ? s.messageGrouped : ""}`}
                  >
                    {message.role === "assistant" ? (
                      <button
                        className={s.messageAvatarButton}
                        type="button"
                        aria-label={`查看${active.name}`}
                        onClick={() => setProfileOpen(true)}
                      >
                        <img
                          className={s.messageAvatar}
                          src={active.cover}
                          alt=""
                        />
                      </button>
                    ) : (
                      <span
                        className={`${s.avatar} ${s.messageAvatar}`}
                        aria-hidden="true"
                      >
                        你
                      </span>
                    )}
                    <div className={s.messageContent}>
                      <span className={s.srOnly}>
                        {message.role === "user" ? "你" : active.name}
                      </span>
                      {index === 0 && message.role === "assistant" && (
                        <small className={s.openingTag}>故事起点</small>
                      )}
                      <div className={s.messageBubble}>{message.content}</div>
                    </div>
                  </div>
                ))}
                {typing && (
                  <div
                    className={s.typing}
                    role="status"
                    aria-label={`${active.name}正在输入`}
                  >
                    <span />
                    <span />
                    <span />
                  </div>
                )}
                {messages.length === 1 && !typing && (
                  <div className={s.quickStarts} aria-label="快速开场">
                    {QUICK_REPLIES.map((reply) => (
                      <button
                        type="button"
                        key={reply}
                        onClick={() => setDraft(reply)}
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                )}
                <div ref={endRef} />
              </div>
            </div>
            <div className={s.composerWrap}>
              <form className={s.composer} onSubmit={send}>
                <div className={s.composerBar}>
                  <span className={s.composerHint}>
                    Enter 发送，Shift+Enter 换行 · 本次对话不保存
                  </span>
                </div>
                <textarea
                  aria-label="发送消息"
                  placeholder={`对${active.name}说点什么`}
                  rows={1}
                  maxLength={240}
                  value={draft}
                  onChange={(event) =>
                    setDraft(event.target.value.slice(0, 240))
                  }
                  onKeyDown={onDraftKeyDown}
                />
                <div className={s.composerSendRow}>
                  {typing ? (
                    <button
                      className={`${s.sendButton} ${s.stopButton}`}
                      type="button"
                      onClick={() => {
                        if (replyTimer.current)
                          window.clearTimeout(replyTimer.current);
                        setTyping(false);
                      }}
                    >
                      停止
                    </button>
                  ) : (
                    <button
                      className={s.sendButton}
                      type="submit"
                      disabled={!draft.trim()}
                    >
                      发送
                    </button>
                  )}
                </div>
              </form>
              <p className={s.composerNote}>
                当前页面关闭或刷新后，这段对话会自动消失
              </p>
            </div>
          </section>
        </main>
      )}
      {profileOpen && active && (
        <div
          className={x.profileOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={`${active.name}的角色信息`}
        >
          <button
            className={x.profileBackdrop}
            type="button"
            aria-label="关闭角色信息"
            onClick={() => setProfileOpen(false)}
          />
          <section className={x.profileSheet}>
            <header className={x.profileSheetHeader}>
              <span>角色档案 · 只在本次浏览有效</span>
              <button
                className={x.profileClose}
                type="button"
                aria-label="关闭角色信息"
                onClick={() => setProfileOpen(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className={x.profileHero}>
              <img src={active.cover} alt="" />
              <div className={x.profileHeroCopy}>
                <span className={x.profileEyebrow}>
                  {active.tone} · {active.online}
                </span>
                <h2>{active.name}</h2>
                <p>{active.role}</p>
              </div>
            </div>
            <div className={x.profileTags}>
              {active.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <div className={x.profileStats}>
              <div>
                <strong>{active.heat}</strong>
                <small>正在靠近</small>
              </div>
              <div>
                <strong>{active.compatibility.split(" · ")[0]}</strong>
                <small>故事气质</small>
              </div>
              <div>
                <strong>0</strong>
                <small>云端记录</small>
              </div>
            </div>
            <section className={x.profileSection}>
              <h3>今晚的片段</h3>
              <p>{active.moment}</p>
            </section>
            <section className={x.profileSection}>
              <h3>角色会记住的开场</h3>
              <p>{active.intro}</p>
            </section>
            <button
              className={x.profileCta}
              type="button"
              onClick={() => {
                setDraft(active.starter);
                setProfileOpen(false);
              }}
            >
              用这句话开始
            </button>
          </section>
        </div>
      )}
      {notice && (
        <div className={s.toast} role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
