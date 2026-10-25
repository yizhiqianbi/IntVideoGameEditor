"use client";

/*
 * Qingyu creator community surface.
 *
 * This component deliberately owns presentation and interaction affordances only.
 * The host (tavern-app) owns authentication, storage, moderation and navigation,
 * so the first release can expose the community shell without inventing payment
 * or media API results.
 */
import { useMemo, useState } from "react";
import type { Character } from "@/lib/dzmm-characters";
import type { DzmmAuthor } from "@/lib/dzmm-discovery";
import Icon, { type IconName } from "./icons";
import s from "./qingyu-creator-community.module.css";

export type CreatorCommunityTab = "discover" | "feed" | "chat" | "live" | "video" | "creator" | "profile";

export type CreatorCommunityMedia = {
  id: string;
  kind: "image" | "video";
  url?: string;
  alt?: string;
  locked?: boolean;
};

export type CreatorCommunityPost = {
  id: string;
  creatorId: string;
  characterId?: string;
  body: string;
  createdAt: string | number;
  media?: CreatorCommunityMedia[];
  locked?: boolean;
  pinned?: boolean;
  likes?: number;
  comments?: number;
  liked?: boolean;
};

export type CreatorCommunityProps = {
  authors: readonly DzmmAuthor[];
  characters: readonly Character[];
  posts?: readonly CreatorCommunityPost[];
  followingCreatorIds?: readonly string[];
  subscriptionIntentIds?: readonly string[];
  activeTab?: CreatorCommunityTab;
  selectedCreatorId?: string;
  onTabChange?: (tab: CreatorCommunityTab) => void;
  onCharacter?: (character: Character) => void;
  onAuthor?: (author: DzmmAuthor) => void;
  onStartAdventure?: (character: Character) => void;
  onFollow?: (author: DzmmAuthor) => void;
  onSubscribeInterest?: (author: DzmmAuthor) => void;
  onMessageCreator?: (author: DzmmAuthor) => void;
  onCreatorCenter?: () => void;
  onLikePost?: (post: CreatorCommunityPost) => void;
  onCommentPost?: (post: CreatorCommunityPost) => void;
  onOpenLive?: () => void;
  onOpenVideo?: () => void;
};

type NavItem = { id: CreatorCommunityTab; label: string; icon: IconName };
const NAV_ITEMS: readonly NavItem[] = [
  { id: "discover", label: "发现", icon: "compass" },
  { id: "feed", label: "订阅动态", icon: "sparkles" },
  { id: "chat", label: "聊天", icon: "chat" },
  { id: "live", label: "直播", icon: "phone" },
  { id: "video", label: "视频", icon: "video" },
  { id: "creator", label: "创作者中心", icon: "edit" },
  { id: "profile", label: "我的", icon: "user" },
];

const formatDate = (value: string | number) => {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) return "刚刚";
  return new Date(parsed).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

const isoDate = (value: string | number) => {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
};

function initials(name: string) {
  return Array.from(name.trim())[0] ?? "晴";
}

function CreatorAvatar({ author, size = "normal" }: { author: DzmmAuthor; size?: "normal" | "large" }) {
  return <span className={`${s.avatar} ${size === "large" ? s.avatarLarge : ""}`} aria-hidden="true">{initials(author.name)}</span>;
}

function CreatorBadge({ author }: { author: DzmmAuthor }) {
  return <span className={s.creatorName}><CreatorAvatar author={author} /><span>{author.name}</span>{author.identityVerified !== false && <span className={s.verified} aria-label="已验证创作者">✓</span>}</span>;
}

function LockedPreview({ post }: { post: CreatorCommunityPost }) {
  return <div className={s.lockedPreview} role="note"><Icon name="crown" size={18} /><div><strong>订阅内容预览</strong><span>{post.body.slice(0, 35)}{post.body.length > 35 ? "…" : ""}</span></div><small>订阅即将开放</small></div>;
}

function PostCard({ post, author, character, onAuthor, onCharacter, onSubscribe, onLike, onComment }: {
  post: CreatorCommunityPost;
  author: DzmmAuthor;
  character?: Character;
  onAuthor?: (author: DzmmAuthor) => void;
  onCharacter?: (character: Character) => void;
  onSubscribe?: (author: DzmmAuthor) => void;
  onLike?: (post: CreatorCommunityPost) => void;
  onComment?: (post: CreatorCommunityPost) => void;
}) {
  return <article className={s.postCard}>
    <header className={s.postHeader}>
      <button className={s.creatorButton} onClick={() => onAuthor?.(author)} aria-label={`查看创作者 ${author.name}`}><CreatorBadge author={author} /></button>
      <time dateTime={isoDate(post.createdAt)}>{formatDate(post.createdAt)}</time>
      {post.pinned && <span className={s.pinned}>置顶</span>}
    </header>
    {character && <button className={s.postCharacter} onClick={() => onCharacter?.(character)}><span>角色动态</span><strong>{character.name}</strong><Icon name="chevron" size={13} /></button>}
    {post.locked ? <LockedPreview post={post} /> : <p className={s.postBody}>{post.body}</p>}
    {post.media?.length ? <div className={s.postMedia} aria-label="动态媒体">{post.media.map(media => media.locked || post.locked ? <LockedPreview key={media.id} post={post} /> : media.kind === "image" && media.url ? <img key={media.id} src={media.url} alt={media.alt ?? "创作者分享的图片"} loading="lazy" /> : <div className={s.mediaPlaceholder} key={media.id}><Icon name="video" size={22} /><span>视频入口即将开放</span></div>)}</div> : null}
    <footer className={s.postActions}>
      <button type="button" className={post.liked ? s.postLiked : ""} aria-label={post.liked ? "取消点赞" : "点赞"} aria-pressed={post.liked ?? false} onClick={() => onLike?.(post)}><Icon name="heart" size={16} />{post.likes ?? 0}</button>
      <button type="button" aria-label="评论" onClick={() => onComment?.(post)}><Icon name="chat" size={16} />{post.comments ?? 0}</button>
      <button type="button" className={s.postSubscribe} onClick={() => onSubscribe?.(author)}><Icon name="crown" size={15} />订阅提醒</button>
    </footer>
  </article>;
}

function EmptyFeed() {
  return <div className={s.empty}><Icon name="sparkles" size={26} /><strong>关注创作者后，这里会出现新动态</strong><span>角色日常、探险后记和视频预告都会集中在这里。</span></div>;
}

function MediaLanding({ type, onOpen }: { type: "live" | "video"; onOpen?: () => void }) {
  const live = type === "live";
  return <section className={s.mediaLanding} aria-labelledby={`${type}-title`}>
    <div className={s.mediaOrb}><Icon name={live ? "phone" : "video"} size={30} /></div>
    <p className={s.eyebrow}>{live ? "LIVE ROOMS" : "VIDEO NOTES"}</p>
    <h1 id={`${type}-title`}>{live ? "直播间即将开放" : "视频空间即将开放"}</h1>
    <p>{live ? "等视频与电话 API 接入后，角色直播、预约和回放会从这里开始。" : "等视频 API 接入后，创作者可以发布角色日常、探险后记和预告。"}</p>
    <button className={s.outlineButton} onClick={onOpen}>{live ? "提醒我开放" : "关注视频更新"}<Icon name="chevron" size={15} /></button>
    <small>当前仅展示入口，不会伪造直播或播放结果。</small>
  </section>;
}

function CreatorProfile({ author, characters, posts, following, subscribed, onAuthor, onCharacter, onStart, onFollow, onSubscribe, onMessage }: {
  author: DzmmAuthor;
  characters: readonly Character[];
  posts: readonly CreatorCommunityPost[];
  following: boolean;
  subscribed: boolean;
  onAuthor?: (author: DzmmAuthor) => void;
  onCharacter?: (character: Character) => void;
  onStart?: (character: Character) => void;
  onFollow?: (author: DzmmAuthor) => void;
  onSubscribe?: (author: DzmmAuthor) => void;
  onMessage?: (author: DzmmAuthor) => void;
  onLike?: (post: CreatorCommunityPost) => void;
  onComment?: (post: CreatorCommunityPost) => void;
}) {
  const works = characters.filter(character => author.characterIds.includes(character.id));
  return <section className={s.creatorProfile} aria-labelledby="creator-profile-title">
    <button className={s.backLink} onClick={() => onAuthor?.(author)}><Icon name="back" size={15} />创作者主页</button>
    <header className={s.profileHero}>
      <CreatorAvatar author={author} size="large" />
      <div className={s.profileIdentity}><p className={s.eyebrow}>CREATOR PROFILE</p><h1 id="creator-profile-title">{author.name}</h1><span>{author.identityVerified === false ? "角色作者" : "已验证创作者"} · {works.length} 个角色</span></div>
      <div className={s.profileActions}><button className={following ? s.outlineButton : s.primaryButton} onClick={() => onFollow?.(author)} aria-pressed={following}>{following ? "已关注" : "关注"}</button><button className={s.outlineButton} onClick={() => onSubscribe?.(author)} aria-pressed={subscribed}><Icon name="crown" size={15} />{subscribed ? "已登记提醒" : "订阅即将开放"}</button><button className={s.iconButton} onClick={() => onMessage?.(author)} aria-label={`给 ${author.name} 发消息`}><Icon name="chat" size={17} /></button></div>
    </header>
    <div className={s.profileGrid}><div><section className={s.profileSection}><h2>角色</h2>{works.length ? <div className={s.profileCharacters}>{works.map(character => <article className={s.profileCharacter} key={character.id}><button className={s.profileCharacterCover} onClick={() => onCharacter?.(character)}><img src={character.cover} alt={character.name} /></button><div><button className={s.profileCharacterName} onClick={() => onCharacter?.(character)}>{character.name}<Icon name="chevron" size={13} /></button><span>{character.tags.slice(0, 3).join(" · ")}</span><button className={s.smallAdventure} onClick={() => onStart?.(character)}>开始探险</button></div></article>)}</div> : <p className={s.muted}>还没有公开角色。</p>}</section></div><aside className={s.profileAside}><div className={s.infoBox}><h2>订阅权益</h2><p>关注后第一时间收到角色动态和新故事提醒。</p><ul><li>免费浏览公开动态</li><li>角色探险与聊天历史</li><li>订阅内容即将开放</li></ul><button className={s.primaryButton} onClick={() => onSubscribe?.(author)}>{subscribed ? "已登记订阅提醒" : "订阅即将开放"}</button></div><div className={s.infoBox}><h2>内容边界</h2><p>晴屿允许暧昧与恋爱表达，拒绝具体性行为描写和交易式亲密。</p></div></aside></div>
    {posts.length > 0 && <section className={s.profilePosts}><div className={s.sectionHeading}><h2>最新动态</h2><span>公开内容</span></div>{posts.slice(0, 3).map(post => <PostCard key={post.id} post={post} author={author} character={characters.find(c => c.id === post.characterId)} onAuthor={onAuthor} onCharacter={onCharacter} onSubscribe={onSubscribe} onLike={onLike} onComment={onComment} />)}</section>}
  </section>;
}

export default function QingyuCreatorCommunity({ authors, characters, posts = [], followingCreatorIds = [], subscriptionIntentIds = [], activeTab: controlledTab, selectedCreatorId, onTabChange, onCharacter, onAuthor, onStartAdventure, onFollow, onSubscribeInterest, onMessageCreator, onCreatorCenter, onLikePost, onCommentPost, onOpenLive, onOpenVideo }: CreatorCommunityProps) {
  const [localTab, setLocalTab] = useState<CreatorCommunityTab>("discover");
  const [localCreator, setLocalCreator] = useState(selectedCreatorId ?? authors[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [localFollowing, setLocalFollowing] = useState<string[]>([...followingCreatorIds]);
  const [localSubscribed, setLocalSubscribed] = useState<string[]>([...subscriptionIntentIds]);
  const tab = controlledTab ?? localTab;
  const creatorId = selectedCreatorId ?? localCreator;
  const creator = authors.find(author => author.id === creatorId) ?? authors[0];
  const filteredAuthors = useMemo(() => authors.filter(author => !search.trim() || author.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [authors, search]);
  const visiblePosts = useMemo(() => posts.filter(post => !search.trim() || post.body.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [posts, search]);
  const creatorPosts = creator ? visiblePosts.filter(post => post.creatorId === creator.id) : [];
  const setTab = (next: CreatorCommunityTab) => { setLocalTab(next); onTabChange?.(next); };
  const follow = (author: DzmmAuthor) => { setLocalFollowing(previous => previous.includes(author.id) ? previous.filter(id => id !== author.id) : [...previous, author.id]); onFollow?.(author); };
  const subscribe = (author: DzmmAuthor) => { setLocalSubscribed(previous => previous.includes(author.id) ? previous.filter(id => id !== author.id) : [...previous, author.id]); onSubscribeInterest?.(author); };
  const openCreator = (author: DzmmAuthor) => { setLocalCreator(author.id); onAuthor?.(author); setTab("creator"); };
  const renderPosts = (items: readonly CreatorCommunityPost[]) => items.length ? <div className={s.feed}>{items.map(post => { const author = authors.find(item => item.id === post.creatorId); if (!author) return null; return <PostCard key={post.id} post={post} author={author} character={characters.find(character => character.id === post.characterId)} onAuthor={openCreator} onCharacter={onCharacter} onSubscribe={subscribe} onLike={onLikePost} onComment={onCommentPost} />; })}</div> : <EmptyFeed />;
  return <section className={s.shell} aria-label="晴屿乙女角色订阅社区">
    <header className={s.header}><a className={s.brand} href="#characters" aria-label="回到晴屿角色广场"><span className={s.brandMark}>晴</span><span><strong>晴屿</strong><small>QINGYU CREATOR COMMUNITY</small></span></a><label className={s.search}><Icon name="search" size={16} /><input aria-label="搜索创作者或动态" placeholder="搜索创作者或动态" value={search} onChange={event => setSearch(event.target.value)} /><span className={s.srOnly}>搜索</span></label><button className={s.headerAction} onClick={() => setTab("profile")}><Icon name="user" size={17} /><span>我的</span></button></header>
    <nav className={s.nav} aria-label="订阅社区导航" role="tablist">{NAV_ITEMS.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? s.navActive : ""} onClick={() => setTab(item.id)}><Icon name={item.icon} size={16} /><span>{item.label}</span></button>)}</nav>
    {tab === "discover" && <main className={s.page}><header className={s.pageHeading}><div><p className={s.eyebrow}>DISCOVER CREATORS</p><h1>找到会让你心动的角色</h1></div><span>关注后，动态和新故事会在这里出现</span></header><section className={s.creatorStrip} aria-label="热门创作者">{filteredAuthors.slice(0, 5).map(author => <button className={s.creatorTile} key={author.id} onClick={() => openCreator(author)}><CreatorAvatar author={author} size="large" /><strong>{author.name}</strong><small>{author.characterIds.length} 个角色</small><span className={localFollowing.includes(author.id) ? s.followingDot : ""}>{localFollowing.includes(author.id) ? "已关注" : "查看主页"}</span></button>)}</section><div className={s.discoverColumns}><section><div className={s.sectionHeading}><h2>热门角色</h2><span>开始你的下一场探险</span></div><div className={s.roleList}>{characters.slice(0, 8).map((character, index) => { const author = authors.find(item => item.characterIds.includes(character.id)); return <article className={s.roleRow} key={character.id}><span className={s.rank}>{String(index + 1).padStart(2, "0")}</span><button className={s.roleCover} onClick={() => onCharacter?.(character)}><img src={character.cover} alt={character.name} /></button><div className={s.roleCopy}><button onClick={() => onCharacter?.(character)}><strong>{character.name}</strong><span>{character.tags.slice(0, 2).join(" · ")}</span></button>{author && <button className={s.authorInline} onClick={() => openCreator(author)}><CreatorAvatar author={author} />{author.name}</button>}</div><button className={s.adventureButton} onClick={() => onStartAdventure?.(character)}>开始探险</button></article>; })}</div></section><aside className={s.discoverAside}><div className={s.infoBox}><h2>创作者入驻</h2><p>创建角色、发布动态，审核通过后公开。</p><button className={s.outlineButton} onClick={() => onCreatorCenter ? onCreatorCenter() : setTab("creator")}>进入创作者中心<Icon name="chevron" size={15} /></button></div><div className={s.infoBox}><h2>订阅提醒</h2><p>当前免费体验，不创建订单、不扣款。真实订阅开放后再通知你。</p><button className={s.outlineButton} onClick={() => setTab("profile")}>查看我的关注<Icon name="chevron" size={15} /></button></div></aside></div></main>}
    {tab === "feed" && <main className={s.page}><header className={s.pageHeading}><div><p className={s.eyebrow}>SUBSCRIPTION FEED</p><h1>订阅动态</h1></div><span>公开内容和订阅预告</span></header>{renderPosts(visiblePosts)}</main>}
    {tab === "creator" && creator && <main className={s.page}><CreatorProfile author={creator} characters={characters} posts={creatorPosts} following={localFollowing.includes(creator.id)} subscribed={localSubscribed.includes(creator.id)} onAuthor={() => setTab("discover")} onCharacter={onCharacter} onStart={onStartAdventure} onFollow={follow} onSubscribe={subscribe} onMessage={onMessageCreator} onLike={onLikePost} onComment={onCommentPost} /></main>}
    {tab === "creator" && !creator && <main className={s.page}><EmptyFeed /></main>}
    {tab === "chat" && <main className={s.page}><section className={s.chatLanding}><div className={s.chatIcon}><Icon name="chat" size={30} /></div><p className={s.eyebrow}>DIRECT MESSAGES</p><h1>和主角继续聊天</h1><p>探险完成后的聊天会继续沿用那段历史。创作者私信入口先保留，免费体验开放。</p><div className={s.quickRoles}>{characters.slice(0, 4).map(character => <button key={character.id} onClick={() => onCharacter?.(character)}><img src={character.cover} alt="" /><span>{character.name}</span><Icon name="chevron" size={13} /></button>)}</div></section></main>}
    {tab === "live" && <main className={s.page}><MediaLanding type="live" onOpen={onOpenLive} /></main>}
    {tab === "video" && <main className={s.page}><MediaLanding type="video" onOpen={onOpenVideo} /></main>}
    {tab === "profile" && <main className={s.page}><section className={s.profileLanding}><header className={s.pageHeading}><div><p className={s.eyebrow}>YOUR ISLAND</p><h1>我的订阅社区</h1></div><span>免费体验 · 订阅即将开放</span></header><div className={s.profileStats}><div><strong>{localFollowing.length}</strong><span>已关注</span></div><div><strong>{localSubscribed.length}</strong><span>提醒中</span></div><div><strong>{posts.length}</strong><span>可见动态</span></div></div><div className={s.followingGrid}>{filteredAuthors.filter(author => localFollowing.includes(author.id)).map(author => <button className={s.followingCard} key={author.id} onClick={() => openCreator(author)}><CreatorAvatar author={author} size="large" /><span><strong>{author.name}</strong><small>查看最新动态</small></span><Icon name="chevron" size={15} /></button>)}</div>{localFollowing.length === 0 && <EmptyFeed />}</section></main>}
  </section>;
}

