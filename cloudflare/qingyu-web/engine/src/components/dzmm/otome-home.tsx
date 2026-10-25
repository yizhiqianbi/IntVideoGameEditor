import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Character } from "@/lib/dzmm-characters";
import type { DzmmPreferences } from "@/lib/dzmm-storage";
import type { DzmmAuthor } from "@/lib/dzmm-discovery";
import { QINGYU_CHARACTERS } from "@/lib/qingyu-catalog";
import { SAFETY_MESSAGE, hasBlockedContent } from "@/lib/qingyu-content-policy";
import s from "./otome-home.module.css";

type Props = {
  characters: Character[];
  favorites: string[];
  likes: string[];
  preferences: DzmmPreferences;
  authors: DzmmAuthor[];
  onCharacter: (c: Character) => void;
  onStart: (c: Character) => void;
  onFavorite: (id: string) => void;
  onLike: (id: string) => void;
  onAuthor: (a: DzmmAuthor) => void;
  onNavigate: (view: "chat" | "live" | "novels" | "studio" | "voice" | "presets" | "profile" | "settings" | "forum") => void;
  onImport: () => void;
  dark?: boolean;
  onToggleTheme?: () => void;
};

type Screen = "home" | "alerts" | "mail" | "saved" | "subs" | "person";
type Shot = { src: string; pos: string; zoom?: number };
type Post = { id: string; creatorId: string; ago: string; text: string; shots?: Shot[]; locked?: boolean; price?: number; likes: number };
type Letter = { id: string; text: string; time: string; price?: number; shots?: Shot[] };
type Comment = { id: string; text: string; at: number };
type Subscription = { id: string; months: number; renew: boolean; at: number };
type Store = {
  subs: Subscription[];
  liked: string[];
  saved: string[];
  unlocked: string[];
  hidden: string[];
  read: string[];
  seenStories: string[];
  comments: Record<string, Comment[]>;
  tips: { id: string; creatorId: string; amount: number; at: number }[];
};
type Modal =
  | { kind: "subscribe"; creatorId: string; months: number }
  | { kind: "unlock"; itemId: string; creatorId: string; price: number; count: number }
  | { kind: "tip"; creatorId: string; postId?: string; amount: number; note: string }
  | { kind: "cancel"; creatorId: string }
  | { kind: "story"; index: number };

const STORE_KEY = "qingyu-lounge-v2";
const EMPTY: Store = { subs: [], liked: [], saved: [], unlocked: [], hidden: [], read: [], seenStories: [], comments: {}, tips: [] };
const TIP_AMOUNTS = [6, 18, 52, 99];
const BUNDLES = [{ months: 1, off: 0 }, { months: 3, off: 15 }, { months: 6, off: 25 }, { months: 12, off: 35 }];

const CREATORS = [
  { id: "qy-shiyu", handle: "lushiyu", price: 28, role: "钢琴家", place: "晴屿音乐厅", online: "现在在线", banner: "50% 34%",
    bio: "台上从容，偏偏会在你认真听的时候弹错一个音。\n没改完的那一小节，只留在订阅里。", more: "26岁 · 社区音乐厅驻场钢琴家 · 正在筹备“雨夜来信”音乐会" },
  { id: "qy-shen", handle: "shenyu.archive", price: 36, role: "古籍修复师", place: "晴屿文献馆", online: "2小时前在线", banner: "50% 26%",
    bio: "话不多。公开的是灯，那句写得很近的边注，不放在外面。", more: "28岁 · 文献馆古籍修复师 · 一封年代对不上的旧信还在抽屉里" },
  { id: "qy-linchuan", handle: "jilinchuan", price: 28, role: "旅行摄影师", place: "海岸慢车沿线", online: "现在在线", banner: "50% 30%",
    bio: "笑着改路线，认真替你留住拒绝的权利。\n有一卷底片不进公开影集。", more: "27岁 · 旅行摄影师 · 海岸慢车停运前在做最后一册影集" },
  { id: "qy-xingcheng", handle: "xingcheng.obs", price: 18, role: "天文工程师", place: "晴屿天文台", online: "刚刚在线", banner: "50% 22%",
    bio: "能把星图讲明白，偏偏把想见你说得特别直接。", more: "25岁 · 天文台设备工程师 · 老望远镜校准中" },
] as const;
type CreatorId = (typeof CREATORS)[number]["id"];

const art = (id: string) => `/art/${id.replace("qy-", "")}.webp`;
const full = (id: string): Shot => ({ src: art(id), pos: "50% 22%" });
const face = (id: string): Shot => ({ src: art(id), pos: "50% 14%", zoom: 1.7 });
const hands = (id: string): Shot => ({ src: art(id), pos: "50% 72%", zoom: 1.8 });
const coast: Shot = { src: "/art/island.webp", pos: "30% 50%" };
const garden: Shot = { src: "/art/island.webp", pos: "78% 40%", zoom: 1.5 };

const POSTS: Post[] = [
  { id: "xc-clear", creatorId: "qy-xingcheng", ago: "2小时前", shots: [full("qy-xingcheng")], likes: 862, text: "校准又错了一次。我承认。\n星星会等，我却有点不想等你先开口。今晚云少，台里的灯我先留着。" },
  { id: "sy-bar", creatorId: "qy-shiyu", ago: "5小时前", shots: [full("qy-shiyu")], locked: true, likes: 1204, text: "这段不放在公开动态里。新曲中间那一小节，我只想弹给你一个人听。你要是今晚有空，琴凳在左边。" },
  { id: "lc-ppv", creatorId: "qy-linchuan", ago: "7小时前", shots: [hands("qy-linchuan"), full("qy-linchuan"), face("qy-linchuan")], locked: true, price: 15, likes: 734, text: "这卷底片冲出来了。三张，都是你没注意到我在拍的时候。发不发，你说了算。" },
  { id: "lc-seat", creatorId: "qy-linchuan", ago: "昨天", shots: [coast], likes: 2408, text: "海岸慢车的最后一班。我给空座位留了一张，没有署名。你可以来，也可以让这张照片就停在这里。" },
  { id: "sh-note", creatorId: "qy-shen", ago: "昨天", locked: true, likes: 640, text: "边注上有一句写得很近。我没有读给别人听，信还在抽屉里。你来了，我们再决定要不要打开。" },
  { id: "sy-ppv", creatorId: "qy-shiyu", ago: "昨天", shots: [hands("qy-shiyu"), face("qy-shiyu")], locked: true, price: 18, likes: 955, text: "手稿拍下来了。第二张是我改错的那一页，别笑。" },
  { id: "sy-toast", creatorId: "qy-shiyu", ago: "2天前", likes: 511, text: "许阿姨问我明天的吐司还要不要。我说要。\n又怕自己拿太多，补了一句：如果有人来，再留一份。" },
  { id: "xc-slot", creatorId: "qy-xingcheng", ago: "3天前", shots: [face("qy-xingcheng")], locked: true, likes: 990, text: "观测时段我留了四十分钟，不对外开放。你要是来，我讲人话。云要是又堆上来，我们就先不看星星。" },
  { id: "sh-lamp", creatorId: "qy-shen", ago: "3天前", shots: [full("qy-shen")], likes: 733, text: "灯还开着。这页边注不是我写的，字迹比正文更急。我没有替你下结论，只是把灯留到你愿意看的时候。" },
  { id: "sy-sea", creatorId: "qy-shiyu", ago: "4天前", shots: [garden], likes: 1320, text: "温室后面能看见海。排练间隙出来站了五分钟，回去又改了两小节。" },
  { id: "lc-roll", creatorId: "qy-linchuan", ago: "4天前", shots: [face("qy-linchuan")], locked: true, likes: 1588, text: "这张不进影集。是我回头的时候，你正在看海。在你点头之前，它只在这里。" },
  { id: "sh-ppv", creatorId: "qy-shen", ago: "5天前", shots: [hands("qy-shen")], locked: true, price: 9, likes: 412, text: "那封信的第二页。我只拍了边注那一行，剩下的，等你来一起看。" },
  { id: "xc-ppv", creatorId: "qy-xingcheng", ago: "6天前", shots: [hands("qy-xingcheng"), full("qy-xingcheng")], locked: true, price: 12, likes: 688, text: "今晚拍到的那颗星，只拍了两张。第一张糊了，留着是因为那时候你在旁边说话。" },
  { id: "xc-text", creatorId: "qy-xingcheng", ago: "1周前", likes: 377, text: "有人问天文台为什么晚上不开灯。因为开了就看不见了。\n不过门口那盏我会留。" },
  { id: "sh-public", creatorId: "qy-shen", ago: "1周前", likes: 298, text: "今天修完了一本县志的封面。胶干得比预想慢，等的时候把眼镜擦了三遍。" },
  { id: "lc-island", creatorId: "qy-linchuan", ago: "1周前", shots: [garden], likes: 1102, text: "改了路线，走到崖上那间小书店。猫比店主先出来迎客。" },
];

const LETTERS: Record<CreatorId, Letter[]> = {
  "qy-shiyu": [
    { id: "sy-m1", time: "昨天 22:14", text: "谢谢你订阅。琴凳在左边，留给你。" },
    { id: "sy-m2", time: "昨天 22:16", text: "新曲录了一小段，只发给你。", price: 12, shots: [hands("qy-shiyu")] },
    { id: "sy-m3", time: "今天 08:02", text: "琴凳还空着。你要是忙，我就先把灯关掉。" },
  ],
  "qy-shen": [
    { id: "sh-m1", time: "前天 19:40", text: "订阅的消息我看到了。谢谢。" },
    { id: "sh-m2", time: "昨天 21:05", text: "边注那一行我拍下来了。你想看再看。", price: 8, shots: [hands("qy-shen")] },
    { id: "sh-m3", time: "今天 09:30", text: "信还在抽屉里。不急。" },
  ],
  "qy-linchuan": [
    { id: "lc-m1", time: "昨天 17:20", text: "欢迎上车。这一站风大，记得带外套。" },
    { id: "lc-m2", time: "昨天 17:22", text: "给你留的那张，冲出来了。", price: 10, shots: [face("qy-linchuan")] },
    { id: "lc-m3", time: "今天 07:48", text: "座位我留到这一站。过了就不等。" },
  ],
  "qy-xingcheng": [
    { id: "xc-m1", time: "昨天 23:51", text: "你订阅了？……好。那我今天就不装镇定了。" },
    { id: "xc-m2", time: "今天 00:10", text: "刚才拍的那颗，给你。", price: 6, shots: [face("qy-xingcheng")] },
    { id: "xc-m3", time: "今天 00:12", text: "我在台里。你说话就可以。" },
  ],
};

const STORIES: { creatorId: CreatorId; shot: Shot; caption: string }[] = [
  { creatorId: "qy-xingcheng", shot: full("qy-xingcheng"), caption: "云散了。今晚的灯会留到很晚。" },
  { creatorId: "qy-shiyu", shot: garden, caption: "排练间隙。海风把谱子吹翻了一页。" },
  { creatorId: "qy-linchuan", shot: coast, caption: "最后一班慢车，还剩一个空座位。" },
  { creatorId: "qy-shen", shot: full("qy-shen"), caption: "灯开着。今天没人来问那封信。" },
];

type Alert = { id: string; tab: "comment" | "mention" | "sub" | "tip" | "promo"; creatorId: CreatorId; text: string; ago: string };
const STATIC_ALERTS: Alert[] = [
  { id: "a1", tab: "mention", creatorId: "qy-linchuan", text: "在动态里提到了你：“给空座位留了一张，没有署名。”", ago: "昨天" },
  { id: "a2", tab: "promo", creatorId: "qy-shen", text: "开放了订阅套餐，6个月 75 折。", ago: "2天前" },
  { id: "a3", tab: "promo", creatorId: "qy-xingcheng", text: "公开了新的观测时段，订阅后可以看到。", ago: "3天前" },
];

function readStore(): Store {
  if (typeof localStorage === "undefined") return EMPTY;
  const ids = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (raw && typeof raw === "object") {
      const subs = Array.isArray(raw.subs) ? raw.subs.filter((item: Subscription) => item && typeof item.id === "string" && typeof item.months === "number" && typeof item.renew === "boolean" && typeof item.at === "number") : [];
      const comments: Record<string, Comment[]> = {};
      if (raw.comments && typeof raw.comments === "object") for (const [key, list] of Object.entries(raw.comments as Record<string, unknown>)) {
        if (Array.isArray(list)) comments[key] = list.filter((item): item is Comment => Boolean(item) && typeof (item as Comment).id === "string" && typeof (item as Comment).text === "string" && typeof (item as Comment).at === "number").slice(-30);
      }
      const tips = Array.isArray(raw.tips) ? raw.tips.filter((item: Store["tips"][number]) => item && typeof item.id === "string" && typeof item.creatorId === "string" && typeof item.amount === "number" && typeof item.at === "number").slice(-100) : [];
      return { subs, comments, tips, liked: ids(raw.liked), saved: ids(raw.saved), unlocked: ids(raw.unlocked), hidden: ids(raw.hidden), read: ids(raw.read), seenStories: ids(raw.seenStories) };
    }
    const legacy = JSON.parse(localStorage.getItem("qingyu-lounge-v1") || "null");
    if (legacy && typeof legacy === "object") return { ...EMPTY, subs: ids(legacy.subscribed).map(id => ({ id, months: 1, renew: true, at: Date.now() })), liked: ids(legacy.liked), saved: ids(legacy.saved) };
  } catch { /* 读不到旧记录时从空白开始。 */ }
  return EMPTY;
}

const bundlePrice = (price: number, months: number) => {
  const bundle = BUNDLES.find(item => item.months === months) ?? BUNDLES[0];
  return Math.round(price * months * (100 - bundle.off) / 100);
};
const formatCount = (value: number) => value.toLocaleString("zh-CN");

const svg = (paths: ReactNode, size = 22) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
const I = {
  home: (n?: number) => svg(<><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" /></>, n),
  bell: (n?: number) => svg(<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>, n),
  mail: (n?: number) => svg(<><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" /></>, n),
  bookmark: (n?: number) => svg(<path d="M6 3h12v18l-6-4-6 4Z" />, n),
  subs: (n?: number) => svg(<><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M17 11l2 2 4-4" /></>, n),
  user: (n?: number) => svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, n),
  more: (n?: number) => svg(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>, n),
  plus: (n?: number) => svg(<path d="M12 5v14M5 12h14" />, n),
  heart: (n?: number) => svg(<path d="M12 20s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 5C19 15.6 12 20 12 20Z" />, n),
  comment: (n?: number) => svg(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />, n),
  coin: (n?: number) => svg(<><circle cx="12" cy="12" r="9" /><path d="M9 8l3 4 3-4M8.5 13h7M8.5 16h7M12 12v6" /></>, n),
  lock: (n?: number) => svg(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, n),
  image: (n?: number) => svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></>, n),
  search: (n?: number) => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, n),
  back: (n?: number) => svg(<path d="M15 5l-7 7 7 7" />, n),
  next: (n?: number) => svg(<path d="M9 5l7 7-7 7" />, n),
  close: (n?: number) => svg(<path d="M6 6l12 12M18 6 6 18" />, n),
  star: (n?: number) => svg(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />, n),
  share: (n?: number) => svg(<><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></>, n),
  refresh: (n?: number) => svg(<><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 20v-4h-4" /></>, n),
  moon: (n?: number) => svg(<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />, n),
  pen: (n?: number) => svg(<><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>, n),
  send: (n?: number) => svg(<path d="M21 3 10 14M21 3l-7 18-4-7-7-4Z" />, n),
};
function Verified() {
  return <svg className={s.verified} width="16" height="16" viewBox="0 0 24 24" aria-label="已认证"><path fill="currentColor" d="m12 1.8 2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 22.2l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3-1-3 2.6-1.9 1-3 3.2.1Z" /><path d="m8 12.2 2.7 2.6L16.2 9" fill="none" stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function Photo({ shot, alt = "", className }: { shot: Shot; alt?: string; className?: string }) {
  const style: CSSProperties = { objectPosition: shot.pos, transform: shot.zoom ? `scale(${shot.zoom})` : undefined, transformOrigin: shot.pos };
  return <img className={className} src={shot.src} alt={alt} style={style} loading="lazy" />;
}

export default function OtomeHome(p: Props) {
  const [screen, setScreen] = useState<Screen>("home");
  const [personId, setPersonId] = useState<CreatorId>(CREATORS[0].id);
  const [profileTab, setProfileTab] = useState<"posts" | "media">("posts");
  const [showMore, setShowMore] = useState(false);
  const [query, setQuery] = useState("");
  const [store, setStore] = useState<Store>(readStore);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [commentError, setCommentError] = useState("");
  const [menuPost, setMenuPost] = useState<string | null>(null);
  const [railMenu, setRailMenu] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState("");
  const [alertTab, setAlertTab] = useState<"all" | Alert["tab"]>("all");
  const [mailId, setMailId] = useState<CreatorId | null>(null);
  const [mailFilter, setMailFilter] = useState<"all" | "unread" | "paid">("all");
  const [subsTab, setSubsTab] = useState<"active" | "expired" | "all">("active");
  const [savedTab, setSavedTab] = useState<"posts" | "lists">("posts");
  const [suggestOffset, setSuggestOffset] = useState(0);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* 浏览器拒绝存储时，本次打开内仍然有效。 */ }
  }, [store]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!modal && !menuPost && !railMenu) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setModal(null); setMenuPost(null); setRailMenu(false); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [modal, menuPost, railMenu]);

  const people = useMemo(() => CREATORS.map(creator => ({ ...creator, character: p.characters.find(item => item.id === creator.id) ?? QINGYU_CHARACTERS.find(item => item.id === creator.id) }))
    .filter((item): item is typeof item & { character: Character } => Boolean(item.character)), [p.characters]);
  const creator = (id: string) => people.find(item => item.id === id);
  const sub = (id: string) => store.subs.find(item => item.id === id);
  const isSub = (id: string) => Boolean(sub(id));
  const visible = (post: Post) => isSub(post.creatorId) && (!post.price || store.unlocked.includes(post.id)) || (!post.locked && !post.price);
  const needle = query.trim().toLowerCase();
  const nickname = p.preferences.nickname || "我";

  const update = (fn: (previous: Store) => Store) => setStore(fn);
  const toggle = (key: "liked" | "saved" | "hidden", id: string) => update(previous => ({ ...previous, [key]: previous[key].includes(id) ? previous[key].filter(item => item !== id) : [...previous[key], id] }));

  function go(next: Screen) { setScreen(next); setRailMenu(false); setMenuPost(null); window.scrollTo({ top: 0 }); }
  function openPerson(id: string) { setPersonId(id as CreatorId); setProfileTab("posts"); setShowMore(false); go("person"); }
  function openMail(id: CreatorId) { setMailId(id); update(previous => previous.read.includes(id) ? previous : { ...previous, read: [...previous.read, id] }); }

  function confirmModal() {
    if (!modal) return;
    if (modal.kind === "subscribe") {
      const target = creator(modal.creatorId);
      update(previous => ({ ...previous, subs: [...previous.subs.filter(item => item.id !== modal.creatorId), { id: modal.creatorId, months: modal.months, renew: true, at: Date.now() }], read: previous.read.filter(item => item !== modal.creatorId) }));
      setNotice(`已订阅${target?.character.name ?? ""}。扣费未开放，这次没有收款。`);
    } else if (modal.kind === "unlock") {
      update(previous => ({ ...previous, unlocked: [...previous.unlocked, modal.itemId] }));
      setNotice("已解锁。扣费未开放，这次没有收款。");
    } else if (modal.kind === "tip") {
      if (modal.note && hasBlockedContent(modal.note)) { setNotice(SAFETY_MESSAGE); return; }
      update(previous => ({ ...previous, tips: [...previous.tips, { id: `t-${Date.now()}`, creatorId: modal.creatorId, amount: modal.amount, at: Date.now() }] }));
      setNotice(`心意 ¥${modal.amount} 已记下。扣费未开放，这次没有收款。`);
    } else if (modal.kind === "cancel") {
      update(previous => ({ ...previous, subs: previous.subs.filter(item => item.id !== modal.creatorId) }));
      setNotice("已取消订阅。");
    }
    setModal(null);
  }

  function sendComment(postId: string) {
    const text = draft.trim();
    if (!text) return;
    if (hasBlockedContent(text)) { setCommentError(SAFETY_MESSAGE); return; }
    setCommentError(""); setDraft("");
    update(previous => ({ ...previous, comments: { ...previous.comments, [postId]: [...(previous.comments[postId] ?? []), { id: `c-${Date.now()}`, text, at: Date.now() }] } }));
  }

  function copyLink(post: Post) {
    setMenuPost(null);
    const url = `${location.origin}/#characters`;
    navigator.clipboard?.writeText(url).then(() => setNotice("链接已复制。"), () => setNotice(url));
  }

  function subscribeButton(id: string, compact = false) {
    const target = creator(id);
    if (!target) return null;
    if (isSub(id)) return <button className={compact ? s.pillGhost : s.subscribedPill} onClick={() => openPerson(id)}>已订阅</button>;
    return compact
      ? <button className={s.pillSmall} onClick={() => setModal({ kind: "subscribe", creatorId: id, months: 1 })}>订阅</button>
      : <button className={s.subscribePill} onClick={() => setModal({ kind: "subscribe", creatorId: id, months: 1 })}><span>订阅</span><span>¥{target.price} 每月</span></button>;
  }

  function lockedMedia(post: Post) {
    const count = post.shots?.length ?? 0;
    const subscribed = isSub(post.creatorId);
    return <div className={s.locked}>
      {post.shots?.[0] && <Photo shot={post.shots[0]} className={s.lockedBlur} />}
      <div className={s.lockedCenter}>{I.lock(34)}</div>
      <div className={s.lockedBar}>
        <div className={s.lockedCounts}>{count > 0 ? <span>{I.image(16)}{count}</span> : <span>{I.lock(16)}文字</span>}{post.price ? <span>¥{post.price}</span> : null}</div>
        {subscribed && post.price
          ? <button className={s.unlockButton} onClick={() => setModal({ kind: "unlock", itemId: post.id, creatorId: post.creatorId, price: post.price!, count })}>解锁这条 ¥{post.price}</button>
          : <button className={s.unlockButton} onClick={() => setModal({ kind: "subscribe", creatorId: post.creatorId, months: 1 })}>订阅后查看他的动态</button>}
      </div>
    </div>;
  }

  function renderPost(post: Post) {
    const who = creator(post.creatorId);
    if (!who || store.hidden.includes(post.id)) return null;
    const open = visible(post);
    const liked = store.liked.includes(post.id);
    const saved = store.saved.includes(post.id);
    const comments = store.comments[post.id] ?? [];
    return <article className={s.post} key={post.id}>
      <header className={s.postHead}>
        <button className={s.avatarButton} onClick={() => openPerson(who.id)} aria-label={`${who.character.name}的主页`}><img src={who.character.cover} alt="" /></button>
        <button className={s.nameBlock} onClick={() => openPerson(who.id)}><strong>{who.character.name}<Verified /></strong><small>@{who.handle}</small></button>
        <span className={s.postTime}>{post.ago}</span>
        <div className={s.menuWrap}>
          <button className={s.iconButton} aria-label="更多操作" aria-expanded={menuPost === post.id} onClick={() => setMenuPost(menuPost === post.id ? null : post.id)}>{I.more(20)}</button>
          {menuPost === post.id && <div className={s.menu} role="menu">
            <button role="menuitem" onClick={() => copyLink(post)}>复制链接</button>
            <button role="menuitem" onClick={() => { toggle("saved", post.id); setMenuPost(null); }}>{saved ? "取消收藏" : "收藏"}</button>
            <button role="menuitem" onClick={() => { toggle("hidden", post.id); setMenuPost(null); setNotice("这条不会再出现在你的首页。"); }}>不再显示</button>
          </div>}
        </div>
      </header>
      <p className={open ? s.postText : s.postTextMuted}>{open ? post.text : post.text.split(/[。\n]/)[0] + "……"}</p>
      {open && post.shots && <div className={post.shots.length > 1 ? s.mediaGrid2 : s.mediaOne}>{post.shots.map((shot, index) => <div key={index} className={s.mediaCell}><Photo shot={shot} alt={`${who.character.name}的照片`} /></div>)}</div>}
      {!open && lockedMedia(post)}
      <div className={s.postActions}>
        <button aria-pressed={liked} aria-label="喜欢" disabled={!open} onClick={() => toggle("liked", post.id)} className={liked ? s.liked : ""}>{I.heart(22)}</button>
        <button aria-label="评论" aria-expanded={openComments === post.id} disabled={!open} onClick={() => { setOpenComments(openComments === post.id ? null : post.id); setCommentError(""); }}>{I.comment(22)}</button>
        <button className={s.tipButton} disabled={!open} onClick={() => setModal({ kind: "tip", creatorId: post.creatorId, postId: post.id, amount: 18, note: "" })}>{I.coin(22)}送心意</button>
        <button aria-pressed={saved} aria-label="收藏" className={`${s.bookmark} ${saved ? s.liked : ""}`} onClick={() => toggle("saved", post.id)}>{I.bookmark(22)}</button>
      </div>
      <p className={s.postStats}>{formatCount(post.likes + (liked ? 1 : 0))} 个赞{comments.length ? ` · ${comments.length} 条评论` : ""}</p>
      {open && openComments === post.id && <div className={s.comments}>
        {comments.map(comment => <div key={comment.id} className={s.comment}><span className={s.meAvatar}>{Array.from(nickname)[0]}</span><p><strong>{nickname}</strong>{comment.text}</p></div>)}
        <form onSubmit={event => { event.preventDefault(); sendComment(post.id); }}>
          <input aria-label={`评论${who.character.name}的动态`} value={draft} maxLength={280} placeholder="写评论…" onChange={event => setDraft(event.target.value)} />
          <button type="submit" disabled={!draft.trim()}>{I.send(18)}</button>
        </form>
        {commentError && <p className={s.error} role="alert">{commentError}</p>}
      </div>}
    </article>;
  }

  function pageHead(title: string, extra?: ReactNode, back?: () => void) {
    return <header className={s.pageHead}>{back && <button className={s.iconButton} aria-label="返回" onClick={back}>{I.back(22)}</button>}<h1>{title}</h1>{extra}</header>;
  }

  function tabs<T extends string>(items: [T, string][], value: T, set: (next: T) => void, label: string) {
    return <div className={s.tabs} role="tablist" aria-label={label}>{items.map(([id, text]) => <button key={id} role="tab" aria-selected={value === id} onClick={() => set(id)}>{text}</button>)}</div>;
  }

  const feed = POSTS.filter(post => !store.subs.length || isSub(post.creatorId) || !post.locked)
    .filter(post => !needle || `${creator(post.creatorId)?.character.name} ${creator(post.creatorId)?.handle} ${post.text}`.toLowerCase().includes(needle));

  function renderHome() {
    return <>
      {pageHead("首页", <button className={s.iconButton} aria-label="切换主题" onClick={p.onToggleTheme}>{I.moon(20)}</button>)}
      <div className={s.stories} aria-label="快拍">{STORIES.map((story, index) => {
        const who = creator(story.creatorId);
        if (!who) return null;
        return <button key={story.creatorId} className={store.seenStories.includes(story.creatorId) ? s.storySeen : s.story} onClick={() => setModal({ kind: "story", index })}><span><img src={who.character.cover} alt="" /></span><small>{who.character.name}</small></button>;
      })}</div>
      {!store.subs.length && <div className={s.intro}><strong>先看他们愿意公开的。</strong><span>订阅之后，锁住的那一页才会打开。亲近可以，亲吻之后停笔。</span></div>}
      {feed.map(renderPost)}
      {!feed.length && <div className={s.empty}><h2>没有匹配的动态</h2><button onClick={() => setQuery("")}>清除搜索</button></div>}
    </>;
  }

  function renderAlerts() {
    const dynamic: Alert[] = [
      ...store.subs.map(item => ({ id: `s-${item.id}`, tab: "sub" as const, creatorId: item.id as CreatorId, text: "你订阅了他。新的动态会出现在首页。", ago: new Date(item.at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) })),
      ...store.tips.slice().reverse().map(item => ({ id: item.id, tab: "tip" as const, creatorId: item.creatorId as CreatorId, text: `你送出了 ¥${item.amount} 的心意（未扣费）。`, ago: new Date(item.at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) })),
      ...Object.entries(store.comments).flatMap(([postId, list]) => list.map(comment => ({ id: comment.id, tab: "comment" as const, creatorId: (POSTS.find(post => post.id === postId)?.creatorId ?? "qy-shiyu") as CreatorId, text: `你评论了他的动态：“${comment.text}”`, ago: new Date(comment.at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) }))),
    ];
    const all = [...dynamic, ...STATIC_ALERTS].filter(item => alertTab === "all" || item.tab === alertTab);
    return <>
      {pageHead("通知")}
      {tabs([["all", "全部"], ["comment", "评论"], ["mention", "提及"], ["sub", "订阅"], ["tip", "心意"], ["promo", "活动"]], alertTab, setAlertTab, "通知类型")}
      <ul className={s.rows}>{all.map(item => {
        const who = creator(item.creatorId);
        if (!who) return null;
        return <li key={item.id}><button onClick={() => openPerson(who.id)}><img src={who.character.cover} alt="" /><span><strong>{who.character.name}<Verified /></strong><em>{item.text}</em></span><small>{item.ago}</small></button></li>;
      })}</ul>
      {!all.length && <div className={s.empty}><h2>这里还没有通知</h2></div>}
    </>;
  }

  function renderMail() {
    const list = people.filter(who => mailFilter === "all" || (mailFilter === "unread" ? isSub(who.id) && !store.read.includes(who.id) : LETTERS[who.id].some(letter => store.unlocked.includes(letter.id))))
      .filter(who => !needle || who.character.name.includes(query.trim()));
    const current = mailId ? creator(mailId) : undefined;
    return <div className={s.mail}>
      <section className={current ? s.mailListHidden : s.mailList}>
        {pageHead("私信", <button className={s.iconButton} aria-label="写私信" onClick={() => current ? p.onStart(current.character) : setNotice("先选一个人。")}>{I.plus(20)}</button>)}
        <label className={s.searchInline}>{I.search(18)}<input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索" aria-label="搜索私信" /></label>
        {tabs([["all", "全部"], ["unread", "未读"], ["paid", "已解锁"]], mailFilter, setMailFilter, "私信筛选")}
        <ul className={s.threadList}>{list.map(who => {
          const last = LETTERS[who.id].at(-1)!;
          const unread = isSub(who.id) && !store.read.includes(who.id);
          return <li key={who.id}><button aria-current={mailId === who.id} onClick={() => openMail(who.id)}>
            <span className={s.avatarDot}><img src={who.character.cover} alt="" />{who.online === "现在在线" && <i />}</span>
            <span className={s.threadText}><strong>{who.character.name}<Verified /></strong><em>{isSub(who.id) ? last.text : "订阅后才能和他私信"}</em></span>
            <span className={s.threadMeta}><small>{last.time.split(" ")[0]}</small>{unread && <b>{LETTERS[who.id].length}</b>}</span>
          </button></li>;
        })}</ul>
      </section>
      <section className={current ? s.thread : s.threadEmpty}>
        {!current ? <div className={s.empty}><h2>选一段对话</h2><p>订阅之后，他会先给你写信。</p></div> : <>
          <header className={s.threadHead}>
            <button className={`${s.iconButton} ${s.threadBack}`} aria-label="返回私信列表" onClick={() => setMailId(null)}>{I.back(22)}</button>
            <button className={s.threadWho} onClick={() => openPerson(current.id)}><span className={s.avatarDot}><img src={current.character.cover} alt="" />{current.online === "现在在线" && <i />}</span><span><strong>{current.character.name}<Verified /></strong><small>@{current.handle} · {current.online}</small></span></button>
            <button className={s.iconButton} aria-label="送心意" onClick={() => setModal({ kind: "tip", creatorId: current.id, amount: 18, note: "" })}>{I.coin(22)}</button>
          </header>
          <div className={s.bubbles}>
            {isSub(current.id) ? LETTERS[current.id].map(letter => {
              const paid = letter.price && !store.unlocked.includes(letter.id);
              return <div key={letter.id} className={s.bubbleRow}>
                <img src={current.character.cover} alt="" />
                <div>
                  {letter.shots && (paid
                    ? <div className={s.bubbleLocked}><Photo shot={letter.shots[0]} className={s.lockedBlur} /><div className={s.lockedCenter}>{I.lock(28)}</div><button onClick={() => setModal({ kind: "unlock", itemId: letter.id, creatorId: current.id, price: letter.price!, count: letter.shots!.length })}>解锁 ¥{letter.price}</button></div>
                    : <div className={s.bubbleMedia}><Photo shot={letter.shots[0]} alt="私信照片" /></div>)}
                  <p className={s.bubble}>{letter.text}</p>
                  <small>{letter.time}{letter.price ? ` · ${paid ? "未解锁" : "已解锁"}` : ""}</small>
                </div>
              </div>;
            }) : <div className={s.mailGate}>{I.lock(30)}<p>订阅{current.character.name}之后才能私信他。</p>{subscribeButton(current.id)}</div>}
          </div>
          {isSub(current.id) && <button className={s.composer} onClick={() => p.onStart(current.character)}><span>写给{current.character.name}…</span>{I.send(20)}</button>}
        </>}
      </section>
    </div>;
  }

  function renderSaved() {
    const posts = POSTS.filter(post => store.saved.includes(post.id));
    return <>
      {pageHead("收藏")}
      {tabs([["posts", "收藏的动态"], ["lists", "用户列表"]], savedTab, setSavedTab, "收藏类型")}
      {savedTab === "posts" ? <>{posts.map(renderPost)}{!posts.length && <div className={s.empty}><h2>还没有收藏</h2><p>点动态右下角的书签就会存到这里。</p></div>}</>
        : <ul className={s.rows}>{[
          ["已订阅", store.subs.length],
          ["喜欢过的", new Set(POSTS.filter(post => store.liked.includes(post.id)).map(post => post.creatorId)).size],
          ["收藏过的", new Set(posts.map(post => post.creatorId)).size],
        ].map(([name, count]) => <li key={name}><button onClick={() => go(name === "已订阅" ? "subs" : "saved")}><span className={s.listIcon}>{I.star(20)}</span><span><strong>{name}</strong><em>{count} 人</em></span></button></li>)}</ul>}
    </>;
  }

  function creatorCard(who: (typeof people)[number], footer?: ReactNode) {
    return <div className={s.card} key={who.id}>
      <button className={s.cardBanner} onClick={() => openPerson(who.id)} aria-label={`${who.character.name}的主页`}>
        <Photo shot={{ src: who.character.cover, pos: who.banner }} />
        <span className={s.cardBadge}>¥{who.price}/月</span>
        <span className={s.cardAvatar}><img src={who.character.cover} alt="" /></span>
        <span className={s.cardName}><strong>{who.character.name}<Verified /></strong><small>@{who.handle}</small></span>
      </button>
      {footer}
    </div>;
  }

  function renderSubs() {
    const list = subsTab === "expired" ? [] : people.filter(who => isSub(who.id));
    return <>
      {pageHead("订阅")}
      {tabs([["active", `生效中 ${store.subs.length}`], ["expired", "已过期"], ["all", "全部"]], subsTab, setSubsTab, "订阅状态")}
      <div className={s.cards}>{list.map(who => {
        const record = sub(who.id)!;
        return creatorCard(who, <div className={s.cardFoot}>
          <span>已订阅 · ¥{bundlePrice(who.price, record.months)} / {record.months === 1 ? "月" : `${record.months}个月`} · 未扣费</span>
          <label className={s.switch}><input type="checkbox" checked={record.renew} onChange={() => update(previous => ({ ...previous, subs: previous.subs.map(item => item.id === who.id ? { ...item, renew: !item.renew } : item) }))} /><span>自动续订</span></label>
          <button className={s.textButton} onClick={() => setModal({ kind: "cancel", creatorId: who.id })}>取消订阅</button>
        </div>);
      })}</div>
      {!list.length && <div className={s.empty}><h2>{subsTab === "expired" ? "没有过期的订阅" : "还没有订阅"}</h2><p>右边的推荐里挑一个。</p></div>}
    </>;
  }

  function renderPerson() {
    const who = creator(personId);
    if (!who) return null;
    const posts = POSTS.filter(post => post.creatorId === who.id);
    const media = posts.flatMap(post => (post.shots ?? []).map((shot, index) => ({ post, shot, key: `${post.id}-${index}` })));
    const likes = posts.reduce((sum, post) => sum + post.likes, 0);
    const record = sub(who.id);
    return <article className={s.profile}>
      <div className={s.banner}>
        <Photo shot={{ src: who.character.cover, pos: who.banner }} />
        <div className={s.bannerBar}>
          <button className={s.iconButton} aria-label="返回" onClick={() => go("home")}>{I.back(24)}</button>
          <div><strong>{who.character.name}<Verified /></strong><small>{posts.length} 帖子 · {media.length} 照片 · {formatCount(likes)} 喜欢</small></div>
        </div>
      </div>
      <div className={s.profileTop}>
        <span className={s.bigAvatar}><img src={who.character.cover} alt={who.character.name} />{who.online === "现在在线" && <i />}</span>
        <div className={s.profileTools}>
          <button className={s.roundButton} aria-label="送心意" onClick={() => setModal({ kind: "tip", creatorId: who.id, amount: 18, note: "" })}>{I.coin(22)}</button>
          <button className={s.roundButton} aria-label={p.favorites.includes(who.id) ? "取消收藏" : "加入收藏"} aria-pressed={p.favorites.includes(who.id)} onClick={() => p.onFavorite(who.id)}>{I.star(22)}</button>
          <button className={s.roundButton} aria-label="分享" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/#characters`); setNotice("主页链接已复制。"); }}>{I.share(22)}</button>
        </div>
      </div>
      <h1 className={s.profileName}>{who.character.name}<Verified /></h1>
      <p className={s.handle}>@{who.handle} · <span className={who.online === "现在在线" ? s.onlineText : ""}>{who.online}</span></p>
      <p className={s.bio}>{who.bio}</p>
      {showMore && <p className={s.bioMore}>{who.more}<br />{who.place}</p>}
      <button className={s.textButton} onClick={() => setShowMore(!showMore)}>{showMore ? "收起" : "更多信息"}</button>

      <section className={s.subscribeBox} aria-labelledby="sub-title">
        <h2 id="sub-title">订阅</h2>
        {record ? <>
          <button className={s.subscribedPill} onClick={() => setModal({ kind: "cancel", creatorId: who.id })}><span>已订阅</span><span>¥{bundlePrice(who.price, record.months)} / {record.months === 1 ? "月" : `${record.months}个月`}</span></button>
          <p className={s.subNote}>自动续订{record.renew ? "已开启" : "已关闭"}。扣费未开放，订阅没有收款。</p>
          <button className={s.ghostWide} onClick={() => { setMailId(who.id); openMail(who.id); go("mail"); }}>{I.mail(18)}私信</button>
        </> : <>
          {subscribeButton(who.id)}
          <h3>订阅套餐</h3>
          {BUNDLES.slice(1).map(bundle => <button key={bundle.months} className={s.bundle} onClick={() => setModal({ kind: "subscribe", creatorId: who.id, months: bundle.months })}><span>{bundle.months}个月（省 {bundle.off}%）</span><span>¥{bundlePrice(who.price, bundle.months)} 合计</span></button>)}
        </>}
      </section>

      {tabs([["posts", `${posts.length} 帖子`], ["media", `${media.length} 媒体`]], profileTab, setProfileTab, "主页内容")}
      {profileTab === "posts" ? posts.map(renderPost) : <div className={s.mediaWall}>{media.map(({ post, shot, key }) => {
        const open = visible(post);
        return <button key={key} className={s.wallTile} onClick={() => open ? setProfileTab("posts") : setModal(isSub(post.creatorId) && post.price ? { kind: "unlock", itemId: post.id, creatorId: post.creatorId, price: post.price, count: post.shots?.length ?? 1 } : { kind: "subscribe", creatorId: post.creatorId, months: 1 })}>
          <Photo shot={shot} className={open ? undefined : s.lockedBlur} alt={open ? "照片" : "未解锁照片"} />
          {!open && <span>{I.lock(22)}{post.price ? `¥${post.price}` : "订阅可见"}</span>}
        </button>;
      })}</div>}
      <button className={s.ghostWide} onClick={() => p.onCharacter(who.character)}>看他的完整人物卡</button>
    </article>;
  }

  const suggestions = people.filter(who => !needle || `${who.character.name} ${who.handle} ${who.role}`.toLowerCase().includes(needle));
  const page = Array.from({ length: Math.min(3, suggestions.length) }, (_, index) => suggestions[(suggestOffset + index) % suggestions.length]);

  function renderModal() {
    if (!modal) return null;
    if (modal.kind === "story") {
      const story = STORIES[modal.index];
      const who = creator(story.creatorId);
      if (!who) return null;
      const next = () => {
        update(previous => previous.seenStories.includes(story.creatorId) ? previous : { ...previous, seenStories: [...previous.seenStories, story.creatorId] });
        setModal(modal.index + 1 < STORIES.length ? { kind: "story", index: modal.index + 1 } : null);
      };
      return <div className={s.storyViewer} role="dialog" aria-modal="true" aria-label={`${who.character.name}的快拍`}>
        <div className={s.storyFrame}>
          <div className={s.storyProgress}>{STORIES.map((item, index) => <span key={item.creatorId}><i key={`${modal.index}-${index}`} className={index < modal.index ? s.done : index === modal.index ? s.running : ""} onAnimationEnd={index === modal.index ? next : undefined} /></span>)}</div>
          <header><img src={who.character.cover} alt="" /><strong>{who.character.name}</strong><small>刚刚</small><button className={s.iconButton} aria-label="关闭快拍" onClick={() => setModal(null)}>{I.close(24)}</button></header>
          <Photo shot={story.shot} alt={story.caption} />
          <p>{story.caption}</p>
          <button className={s.storyPrev} aria-label="上一条" onClick={() => setModal({ kind: "story", index: Math.max(0, modal.index - 1) })} />
          <button className={s.storyNext} aria-label="下一条" onClick={next} />
        </div>
      </div>;
    }
    const who = creator(modal.creatorId);
    if (!who) return null;
    let title = "", body: ReactNode = null, action = "";
    if (modal.kind === "subscribe") {
      title = `订阅 ${who.character.name}`;
      action = `订阅 ¥${bundlePrice(who.price, modal.months)}`;
      body = <>
        <p className={s.modalLead}>订阅后可以：</p>
        <ul className={s.benefits}><li>看到他全部的订阅动态</li><li>和他私信</li><li>随时取消订阅</li></ul>
        <div className={s.bundlePick}>{BUNDLES.map(bundle => <button key={bundle.months} aria-pressed={modal.months === bundle.months} onClick={() => setModal({ ...modal, months: bundle.months })}><strong>{bundle.months === 1 ? "1个月" : `${bundle.months}个月`}</strong><span>¥{bundlePrice(who.price, bundle.months)}{bundle.off ? ` · 省${bundle.off}%` : ""}</span></button>)}</div>
        <p className={s.modalNote}>扣费还没开放。点订阅只做记录，不会收款。</p>
      </>;
    } else if (modal.kind === "unlock") {
      title = "解锁这条内容";
      action = `解锁 ¥${modal.price}`;
      body = <><p className={s.modalLead}>{modal.count > 0 ? `${modal.count} 张照片，` : ""}解锁后可以一直查看。</p><p className={s.modalNote}>扣费还没开放。解锁只做记录，不会收款。</p></>;
    } else if (modal.kind === "tip") {
      title = `给 ${who.character.name} 送心意`;
      action = `送出 ¥${modal.amount}`;
      body = <>
        <div className={s.amounts}>{TIP_AMOUNTS.map(amount => <button key={amount} aria-pressed={modal.amount === amount} onClick={() => setModal({ ...modal, amount })}>¥{amount}</button>)}</div>
        <label className={s.field}><span>附言（可选）</span><input value={modal.note} maxLength={120} onChange={event => setModal({ ...modal, note: event.target.value })} placeholder="留一句话给他" /></label>
        <p className={s.modalNote}>扣费还没开放。心意只做记录，不会收款。</p>
      </>;
    } else {
      title = `取消订阅 ${who.character.name}？`;
      action = "取消订阅";
      body = <p className={s.modalLead}>取消后，锁住的动态和私信会重新上锁。已解锁的单条内容仍然保留。</p>;
    }
    return <div className={s.overlay} role="presentation" onClick={() => setModal(null)}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={event => event.stopPropagation()}>
        <div className={s.dialogBanner}><Photo shot={{ src: who.character.cover, pos: who.banner }} /><span className={s.cardAvatar}><img src={who.character.cover} alt="" /></span></div>
        <h2 id="dialog-title">{title}</h2>
        {body}
        <div className={s.dialogActions}><button className={s.textButton} onClick={() => setModal(null)}>{modal.kind === "cancel" ? "保留订阅" : "取消"}</button><button className={modal.kind === "cancel" ? s.dangerPill : s.pillSmall} onClick={confirmModal}>{action}</button></div>
      </div>
    </div>;
  }

  const unreadMail = people.filter(who => isSub(who.id) && !store.read.includes(who.id)).length;
  const navItems: [Screen, string, ReactNode, number?][] = [
    ["home", "首页", I.home(), undefined],
    ["alerts", "通知", I.bell(), undefined],
    ["mail", "私信", I.mail(), unreadMail || undefined],
    ["saved", "收藏", I.bookmark(), undefined],
    ["subs", "订阅", I.subs(), store.subs.length || undefined],
  ];

  return <div className={s.lounge} data-lounge data-screen={screen}>
    <nav className={s.rail} aria-label="订阅导航">
      <a className={s.brand} href="#characters" onClick={event => { event.preventDefault(); go("home"); }}><img src="/assets/qingyu/brand/qingyu-mark.svg" alt="" width="34" height="34" /><span>晴屿</span></a>
      <button className={s.me} onClick={() => p.onNavigate("profile")}><span className={s.meAvatar}>{Array.from(nickname)[0]}</span><span><strong>{nickname}</strong><small>我的主页</small></span></button>
      {navItems.map(([id, label, icon, badge]) => <button key={id} className={`${s.navItem} ${id === "saved" || id === "subs" ? s.deskOnly : ""}`} data-nav={id} aria-label={label} aria-current={screen === id || (id === "home" && screen === "person") ? "page" : undefined} onClick={() => { if (id === "mail") setMailId(null); go(id); }}>{icon}<span>{label}</span>{badge ? <b>{badge}</b> : null}</button>)}
      <button className={`${s.navItem} ${s.deskOnly}`} onClick={() => p.onNavigate("profile")}>{I.user()}<span>我的</span></button>
      <div className={s.menuWrap} data-nav="more">
        <button className={s.navItem} aria-label="更多" aria-expanded={railMenu} onClick={() => setRailMenu(!railMenu)}>{I.more()}<span>更多</span></button>
        {railMenu && <div className={`${s.menu} ${s.railMenu}`} role="menu">
          <button role="menuitem" className={s.mobileOnly} onClick={() => go("saved")}>收藏</button>
          <button role="menuitem" className={s.mobileOnly} onClick={() => go("subs")}>订阅{store.subs.length ? ` · ${store.subs.length}` : ""}</button>
          <button role="menuitem" className={s.mobileOnly} onClick={() => p.onNavigate("profile")}>我的</button>
          <button role="menuitem" onClick={() => { setRailMenu(false); p.onToggleTheme?.(); }}>{p.dark ? "浅色模式" : "深色模式"}</button>
          <button role="menuitem" onClick={() => p.onNavigate("settings")}>账号设置</button>
          <button role="menuitem" onClick={() => p.onNavigate("forum")}>小岛社区</button>
          <button role="menuitem" onClick={() => { setRailMenu(false); p.onImport(); }}>导入角色卡</button>
          <a role="menuitem" href="/community-guidelines">社区公约</a>
        </div>}
      </div>
      <button className={s.newPost} data-nav="new" aria-label="写故事" onClick={() => p.onNavigate("studio")}>{I.plus(20)}<span>写故事</span></button>
    </nav>

    <main className={s.center} aria-label="订阅内容">
      {screen === "home" && renderHome()}
      {screen === "alerts" && renderAlerts()}
      {screen === "mail" && renderMail()}
      {screen === "saved" && renderSaved()}
      {screen === "subs" && renderSubs()}
      {screen === "person" && renderPerson()}
    </main>

    {screen !== "mail" && <aside className={s.aside} aria-label="推荐订阅">
      <label className={s.searchBox}>{I.search(18)}<input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索动态和人" aria-label="搜索动态和人" /></label>
      <div className={s.asideHead}><h2>推荐</h2><div>
        <button className={s.iconButton} aria-label="换一批" onClick={() => setSuggestOffset(value => value + 1)}>{I.refresh(18)}</button>
        <button className={s.iconButton} aria-label="上一个" onClick={() => setSuggestOffset(value => value + suggestions.length - 1)}>{I.back(18)}</button>
        <button className={s.iconButton} aria-label="下一个" onClick={() => setSuggestOffset(value => value + 1)}>{I.next(18)}</button>
      </div></div>
      <div className={s.suggestList}>{suggestions.length ? page.map(who => creatorCard(who)) : <p className={s.muted}>没有找到这个人。</p>}</div>
      <p className={s.asideFoot}><a href="/community-guidelines">社区公约</a> · 四位都是成年原创角色 · 亲近可以，亲吻之后停笔 · 扣费未开放</p>
    </aside>}

    {renderModal()}
    <p className={notice ? s.toast : s.toastHidden} role="status">{notice}</p>
  </div>;
}
