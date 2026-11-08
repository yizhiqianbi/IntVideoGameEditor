"use client";

/* eslint-disable @next/next/no-img-element -- Local reference covers and user-imported role images. */
import { useEffect, useId, useRef, useState } from "react";
import type { Character } from "@/lib/dzmm-characters";
import { isXumengPinnedCard, loadXumengCardProvenance, readXumengCardProvenance, type XumengCardProvenance } from "@/lib/xumeng-card-shelf";
import { getDzmmCharacterCreatorNotes } from "@/lib/dzmm-character-presentation";
import { getDzmmOpeningMessages } from "@/lib/dzmm-character-context";
import { characterShareLocation } from "@/lib/xumeng-acquisition";
import { XUMENG_CALLS_ENABLED, XUMENG_CALLS_LOCKED_MESSAGE } from "@/lib/xumeng-feature-availability";
import { recommendationReasonText, type RecommendationReason } from "@/lib/xumeng-recommendations";
import { coverShelfTags, visibleShelfTags } from "@/lib/xumeng-shelf-tags";
import { xumengCardCoverUrl, xumengCoverMissUrl, XUMENG_FALLBACK_COVER } from "@/lib/xumeng-routes";
import { groupRelationshipAlbum, parseRelationshipAlbum, relationshipAlbumAssetUrl, type RelationshipAlbumItem } from "@/lib/relationship-album";
import Icon from "./icons";
import CharacterIntroduction from "./character-introduction";
import s from "./character-detail.module.css";

export type CharacterDetailProps = {
  character: Character;
  favorites: boolean;
  liked?: boolean;
  likeCount?: string;
  related: Character[];
  relatedReasons?: Readonly<Record<string, RecommendationReason>>;
  inviteCode?: string | null;
  onBack: () => void;
  onStart: (openingIndex?: number, fresh?: boolean) => void;
  onLive?: () => void;
  onVoice?: () => void;
  onFavorite: () => void;
  onLike?: () => void;
  onExport: () => void;
  onEdit: () => void;
  onSelect: (character: Character) => void;
  onNotice: (message: string) => void;
  shareRequiresAccount?: boolean;
  onRequireAccount?: () => void;
  onTag?: (tag: string) => void;
  onAuthor?: () => void;
  onFollow?: () => void;
  onHide?: () => void;
  following?: boolean;
  galleryPaths?: string[];
  openingOrigin?: "public-rendered";
  userName?: string;
};

function RoleImage({
  character,
  className,
  src,
}: {
  character: Character;
  className: string;
  src?: string;
}) {
  return (
    <img
      className={className}
      src={xumengCardCoverUrl(src || character.cover || XUMENG_FALLBACK_COVER)}
      alt={character.name}
      onError={(event) => {
        const image = event.currentTarget;
        const next = xumengCoverMissUrl(image.currentSrc || image.src, src || character.cover || XUMENG_FALLBACK_COVER);
        image.onerror = () => { image.onerror = null; image.src = XUMENG_FALLBACK_COVER; };
        if (next === XUMENG_FALLBACK_COVER) image.onerror = null;
        image.src = next;
      }}
    />
  );
}

function AlbumPiece({ item }: { item: RelationshipAlbumItem }) {
  const src = relationshipAlbumAssetUrl(item.id);
  switch (item.kind) {
    case "image":
      return <img src={src} alt="对话相册图片" />;
    case "video":
      return <video src={src} controls playsInline preload="metadata" aria-label="对话相册视频" />;
    default: {
      const unexpected: never = item.kind;
      return unexpected;
    }
  }
}

function displayDate(createdAt: string) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
}

export default function CharacterDetail({
  character,
  favorites,
  liked = false,
  likeCount,
  related,
  relatedReasons,
  inviteCode = null,
  onBack,
  onStart,
  onLive,
  onVoice,
  onFavorite,
  onLike,
  onExport: onExportCompatible,
  onEdit,
  onSelect,
  onNotice,
  shareRequiresAccount = false,
  onRequireAccount,
  onTag,
  onAuthor,
  onFollow,
  onHide,
  following = false,
  galleryPaths = [],
  userName,
}: CharacterDetailProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [album, setAlbum] = useState<{ characterId: string; items: RelationshipAlbumItem[] } | null>(null);
  const [picture, setPicture] = useState({ characterId: character.id, index: 0 });
  const [openingSelection, setOpeningSelection] = useState({ characterId: character.id, index: 0, touched: false });
  const menuOpen = menuFor === character.id;
  useEffect(() => {
    const roleId = character.id;
    let live = true;
    setAlbum(current => current?.characterId === roleId ? current : null);
    void fetch(`/api/backend/v1/relationship-album?characterId=${encodeURIComponent(roleId)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("album");
        return parseRelationshipAlbum(await response.json());
      })
      .then(items => { if (live) setAlbum({ characterId: roleId, items }); })
      .catch(() => { if (live) setAlbum({ characterId: roleId, items: [] }); });
    return () => { live = false; };
  }, [character.id]);
  const albumItems = album?.characterId === character.id ? album.items : null;
  const albumGroups = albumItems ? groupRelationshipAlbum(albumItems) : [];
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const gallery = [...new Set((galleryPaths.length ? galleryPaths : character.gallery ?? []).filter(Boolean))];
  const pictures = gallery.length ? gallery : [character.cover || XUMENG_FALLBACK_COVER];
  const pictureIndex = picture.characterId === character.id ? Math.min(picture.index, pictures.length - 1) : 0;
  const isPublicSample = character.sourceKind === "public-summary";
  const pinnedCard = isXumengPinnedCard(character);
  const [exportedCard, setExportedCard] = useState<XumengCardProvenance | null>(null);
  useEffect(() => {
    if (!pinnedCard) { setExportedCard(null); return; }
    let cancelled = false;
    void loadXumengCardProvenance().then(() => {
      if (!cancelled) setExportedCard(readXumengCardProvenance(character) ?? null);
    }).catch(() => { if (!cancelled) setExportedCard(null); });
    return () => { cancelled = true; };
  }, [character, pinnedCard]);
  const primaryPresent = getDzmmOpeningMessages({ ...character, alternateGreetings: [] }).length > 0;
  const openingLabel = (text: string, fallback: string) => {
    const line = text.split("\n")[0]?.trim() ?? "";
    return line && line.length <= 40 ? line : fallback;
  };
  const openings = [
    ...(primaryPresent ? [{ index: 0, label: openingLabel(character.firstMessage, "开场 1") }] : []),
    ...(character.alternateGreetings ?? []).map((greeting, index) => ({ index: index + 1, label: openingLabel(greeting, `开场 ${index + 2}`) })),
  ];
  const selectedOpening = openingSelection.characterId === character.id && openings.some(item => item.index === openingSelection.index)
    ? openingSelection.index : openings[0]?.index ?? 0;
  const openingTouched = openingSelection.characterId === character.id && openingSelection.touched;
  const selectedOpeningText = openings.length ? getDzmmOpeningMessages(character, selectedOpening).map(message => message.content).join("\n\n") : "";
  function onExport() {
    if (!exportedCard) { onExportCompatible(); return; }
    const link = document.createElement("a");
    link.href = exportedCard.downloadUrl;
    link.download = "";
    link.click();
  }
  const contextMissing = character.catalogReadiness === "metadata-only";
  const date = displayDate(character.createdAt);
  const pageTags = visibleShelfTags(character.tags, 12);
  const paintedTags = coverShelfTags(character.tags, 4);
  const recommendations = related
    .filter((role) => role.id !== character.id)
    .slice(0, 8);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuFor(null);
    }
    function closeAfterFocusLeaves(event: FocusEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuFor(null);
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setMenuFor(null); menuButton.current?.focus(); }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (!items.length || !menuRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      const selected = items.indexOf(document.activeElement as HTMLElement);
      items[(selected + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", closeAfterFocusLeaves);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", keydown); document.removeEventListener("focusin", closeAfterFocusLeaves); };
  }, [menuOpen]);

  function selectPicture(index: number) {
    setPicture({ characterId: character.id, index: (index + pictures.length) % pictures.length });
  }

  async function share() {
    if (shareRequiresAccount) { onRequireAccount?.(); onNotice("请先注册或登录，再分享角色。"); return; }
    if (character.authoringDraft) { onNotice("这张角色还有未完成的世界书，请先完善草稿再分享角色卡。"); return; }
    if (!isPublicSample && !character.publication) {
      onExport();
      onNotice("私人角色卡已导出，可以分享这个 JSON 文件。");
      return;
    }
    const sharePath = characterShareLocation(character.id, inviteCode);
    const url = `${location.origin}${sharePath}`;
    try {
      await navigator.clipboard.writeText(url);
      onNotice("角色链接已复制。");
    } catch {
      onNotice(`角色链接：${url}`);
    }
  }

  return (
    <section className={s.detail} aria-labelledby="character-detail-title">
      <button
        className={s.back}
        type="button"
        onClick={onBack}
        aria-label="返回角色广场"
        title="返回角色广场"
      >
        <Icon name="back" size={20} />
      </button>

      <div className={s.hero}>
        <div className={s.gallery}>
          <div className={s.coverFrame} role="group" aria-roledescription={pictures.length > 1 ? "轮播图" : undefined} aria-label={`${character.name} 封面`} tabIndex={pictures.length > 1 ? 0 : undefined} onKeyDown={(event) => { if (pictures.length < 2) return; if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); selectPicture(pictureIndex + (event.key === "ArrowLeft" ? -1 : 1)); } }}>
            <RoleImage character={character} className={s.cover} src={pictures[pictureIndex]} />
            {paintedTags.length > 0 && <div className={s.coverTags}>{paintedTags.map((tag) => <button key={tag} type="button" onClick={() => onTag?.(tag)} aria-label={`只看${tag}`}>{tag}</button>)}</div>}
            <span className={s.heat}><Icon name="flame" size={16} />{character.heat}</span>
            {pictures.length > 1 && <><button className={`${s.galleryArrow} ${s.galleryPrevious}`} type="button" aria-label="上一张封面" onClick={() => selectPicture(pictureIndex - 1)}><Icon name="chevron" size={18} /></button><button className={`${s.galleryArrow} ${s.galleryNext}`} type="button" aria-label="下一张封面" onClick={() => selectPicture(pictureIndex + 1)}><Icon name="chevron" size={18} /></button><span className={s.pictureCount} aria-live="polite">{pictureIndex + 1} / {pictures.length}</span></>}
          </div>
          {pictures.length > 1 && <div className={s.thumbnails} aria-label="选择角色图片">{pictures.map((path, index) => <button type="button" className={index === pictureIndex ? s.selectedThumbnail : ""} key={path} aria-label={`查看第 ${index + 1} 张图片`} aria-pressed={index === pictureIndex} onClick={() => selectPicture(index)}><img src={xumengCardCoverUrl(path)} alt="" /></button>)}</div>}
        </div>

        <div className={s.info}>
          <div className={s.titleRow}>
            <h1 id="character-detail-title">{character.name}</h1>
            <div className={s.moreContainer} ref={menuRef}><button ref={menuButton} className={s.more} type="button" onClick={() => setMenuFor(menuOpen ? null : character.id)} aria-label="角色更多操作" title="更多操作" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}><Icon name="more" size={20} /></button>{menuOpen && <div className={s.moreMenu} role="menu" id={menuId} aria-label="角色操作"><button role="menuitem" type="button" onClick={() => { setMenuFor(null); onExport(); }}><Icon name="download" size={15} />{character.authoringDraft ? "导出私人草稿" : "导出角色卡"}</button><button role="menuitem" type="button" onClick={() => { setMenuFor(null); onEdit(); }}><Icon name="edit" size={15} />定制角色</button>{onHide && <button role="menuitem" type="button" onClick={() => { setMenuFor(null); onHide(); }}><Icon name="close" size={15} />不感兴趣</button>}</div>}</div>
          </div>
          <p className={s.metadata}>
            <span>#{character.id}</span>
            {date && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {isPublicSample ? "收录" : "创建"}于 {date}
                </span>
              </>
            )}
          </p>

          <div className={s.authorRow}>
            {onAuthor ? <button className={`${s.author} ${s.authorButton}`} type="button" onClick={onAuthor} aria-label={`查看作者 ${character.author}`}>
              <span className={s.avatar} aria-hidden="true">{Array.from(character.author)[0] ?? "创"}</span><span className={s.authorText}><span className={s.authorName}>{character.author}</span><small>{isPublicSample || character.publication ? "公开角色作者" : "我的角色"}</small></span>
            </button> : <div className={s.author}>
              <span className={s.avatar} aria-hidden="true">
                {Array.from(character.author)[0] ?? "创"}
              </span>
              <div>
                <span className={s.authorName}>{character.author}</span>
                <small>{isPublicSample || character.publication ? "暂无作者主页" : "我的角色"}</small>
              </div>
            </div>}
            <div className={s.authorActions}>
              {(isPublicSample || character.publication) && onFollow && <button
                type="button"
                className={`${s.outline} ${following ? s.following : ""}`}
                onClick={onFollow}
                aria-pressed={following}
              >
                <Icon name={following ? "check" : "plus"} size={15} />
                {following ? "已关注" : "关注"}
              </button>}
            </div>
          </div>

          <div className={s.metrics}>
            {onLike ? <button
              className={`${s.likeCount} ${liked ? s.likeActive : ""}`}
              type="button"
              onClick={onLike}
              aria-label={`${liked ? "取消点赞" : "点赞"} ${character.name}`}
              aria-pressed={liked}
              title={exportedCard ? "叙梦用户点赞" : isPublicSample ? "收录时点赞数 + 叙梦新增点赞" : "点赞角色"}
            >
              <Icon name="heart" size={17} />
              {likeCount ?? character.likes}
            </button> : <span
              className={s.likeCount}
              title={exportedCard ? "叙梦用户点赞" : isPublicSample ? "收录时点赞数 + 叙梦新增点赞" : "自定义角色"}
            >
              <Icon name="heart" size={17} />
              {likeCount ?? character.likes}
            </span>}
            <button
              className={favorites ? s.favoriteActive : ""}
              type="button"
              onClick={onFavorite}
              aria-pressed={favorites}
            >
              <Icon name={favorites ? "check" : "book"} size={17} />
              {favorites ? "已收藏" : "收藏"}
            </button>
            <button type="button" onClick={() => void share()}>
              <Icon name="send" size={16} />
              分享
            </button>
            {exportedCard ? <a href={exportedCard.downloadUrl} download>
              <Icon name="download" size={16} />导出原卡
            </a> : <button type="button" onClick={onExport}>
              <Icon name="download" size={16} />
              {character.authoringDraft ? "导出私人草稿" : "导出"}
            </button>}
          </div>

          <div className={s.primaryActions}>
            <button className={s.start} type="button" onClick={contextMissing ? onEdit : () => onStart(selectedOpening, openingTouched)}>
              <Icon name="chat" size={18} />
              {character.authoringDraft ? "完善草稿" : contextMissing ? "补充角色设定" : "开始对话"}
            </button>
            <button
              className={`${s.outline} ${s.customize}`}
              type="button"
              onClick={onEdit}
            >
              <Icon name="edit" size={17} />
              定制
            </button>
          </div>
          {!contextMissing && <div className={s.performanceActions}>{onLive && <button className={s.outline} onClick={onLive} title={XUMENG_CALLS_ENABLED ? "语音通话和视频通话" : XUMENG_CALLS_LOCKED_MESSAGE}><Icon name={XUMENG_CALLS_ENABLED ? "video" : "lock"} size={16} />{XUMENG_CALLS_ENABLED ? "给角色打电话" : "通话已锁"}</button>}{onVoice && <button className={s.outline} onClick={onVoice}><Icon name="volume" size={16} />生成角色语音</button>}</div>}
        </div>
      </div>

      <section
        className={s.introduction}
        aria-labelledby="character-intro-title"
      >
        {pageTags.length > 0 && <div className={s.pageTags} aria-label="角色标签">{pageTags.map((tag) => <button key={tag} type="button" onClick={() => onTag?.(tag)} aria-label={`只看${tag}`}>{tag}</button>)}</div>}
        <h2 id="character-intro-title">角色介绍</h2>
        <CharacterIntroduction text={character.introduction || character.description || ""}
          additionalNotes={getDzmmCharacterCreatorNotes(character)} bodyClassName={s.description}
          characterName={character.name} userName={userName}
          fallback={contextMissing ? "这个角色的故事设定尚未补齐。你可以导入完整角色卡，或通过定制补充人物背景和开场。" : "还没有填写角色介绍。可以定制这个角色，补充它的故事。"} />
        {selectedOpeningText && (
          <div className={s.opening}>
            <h3>开场白</h3>
            {openings.length > 1 && <div className={s.openingPicker}><label>选择开场<select aria-label="选择开场" value={String(selectedOpening)} onChange={(event) => setOpeningSelection({ characterId: character.id, index: Number(event.target.value), touched: true })}>{openings.map(item => <option key={item.index} value={String(item.index)}>{item.label}</option>)}</select></label><button type="button" onClick={() => onStart(selectedOpening, true)}>用此开场新建聊天</button></div>}
            <CharacterIntroduction key={selectedOpening} text={selectedOpeningText} characterName={character.name} userName={userName} />
          </div>
        )}
        {(character.personality || character.scenario || character.appearance || character.interactionSettings) && (
          <details className={s.promptDetails} open>
            <summary>
              查看角色设定
              <Icon name="chevron" size={14} />
            </summary>
            <div className={s.promptContent}>
              {character.personality && (
                <div>
                  <h3>性格与回应方式</h3>
                  <CharacterIntroduction text={character.personality} characterName={character.name} userName={userName} />
                </div>
              )}
              {character.scenario && (
                <div>
                  <h3>故事场景</h3>
                  <CharacterIntroduction text={character.scenario} characterName={character.name} userName={userName} />
                </div>
              )}
              {character.appearance && (
                <div>
                  <h3>外貌</h3>
                  <CharacterIntroduction text={character.appearance} characterName={character.name} userName={userName} />
                </div>
              )}
              {character.interactionSettings && (
                <div>
                  <h3>互动设置</h3>
                  <CharacterIntroduction text={character.interactionSettings} characterName={character.name} userName={userName} />
                </div>
              )}
            </div>
          </details>
        )}
        {exportedCard && <div className={`${s.source} ${s.exportSource}`}>
          <span>完整原卡 · {character.characterBook?.entries.length ?? 0} 条世界书 · {openings.length} 个开场</span>
          {openings.length === 1 && <div className={s.openingPicker}><button type="button" onClick={() => onStart(selectedOpening, true)}>用此开场新建聊天</button></div>}
          <span>作者：{exportedCard.author}{exportedCard.provenanceKind === "user-provided" ? " · 用户提供 · 许可未核验" : <> · <a href={exportedCard.sourceUrl} target="_blank" rel="noopener noreferrer">作者发布页</a> · <a href={exportedCard.licenseUrl} target="_blank" rel="noopener noreferrer">{exportedCard.licenseName}</a></>}</span>
          <span>原文件完整保留；页面采用叙梦排版，卡内数值和指令按故事设定演绎。</span>
          {exportedCard.compatibilityNotes?.map((note, index) => <span key={index}>{note}</span>)}
          <a href={exportedCard.downloadUrl} download>下载完整原卡 JSON</a>
          {exportedCard.pngDownloadUrl && <a href={exportedCard.pngDownloadUrl} download>下载完整原卡 PNG</a>}
        </div>}
        {character.catalogReadiness === "public-context" && <p className={s.source}>当前对话使用已补齐的故事背景{character.firstMessage ? "与开场" : ""}；完整角色卡和世界书尚未补齐。</p>}

      </section>

      <section className={s.album} aria-labelledby="character-album-title">
        <h2 id="character-album-title">对话相册</h2>
        <p className={s.albumNote}>按北京时间的日期收着你和这位角色一起生成的图片和视频。删掉聊天后，这里还在。</p>
        {albumItems === null ? <p className={s.albumNote}>正在整理相册…</p> : albumGroups.length === 0 ? (
          <div className={s.albumEmpty}>
            <p>还没有一起生成的画面。</p>
            <button type="button" className={s.outline} onClick={contextMissing ? onEdit : () => onStart(selectedOpening, openingTouched)}>去聊聊看</button>
          </div>
        ) : albumGroups.map(group => (
          <div key={group.day} className={s.albumDay}>
            <h3>{group.label}</h3>
            <div className={s.albumGrid}>{group.items.map(item => <AlbumPiece key={item.id} item={item} />)}</div>
          </div>
        ))}
      </section>

      {recommendations.length > 0 && (
        <section
          className={s.related}
          aria-labelledby="character-related-title"
        >
          <h2 id="character-related-title">你可能也喜欢</h2>
          <div className={s.relatedGrid}>
            {recommendations.map((role) => {
              const reasonLabel = recommendationReasonText(relatedReasons?.[role.id]);
              return (
              <button
                key={role.id}
                type="button"
                className={s.relatedCard}
                onClick={() => onSelect(role)}
              >
                <div className={s.relatedCover}>
                  <RoleImage character={role} className={s.relatedImage} />
                  <span className={s.heat}>
                    <Icon name="flame" size={13} />
                    {role.heat}
                  </span>
                </div>
                <strong>{role.name}</strong>
                <span className={s.relatedAuthor}>{role.author}</span>
                {reasonLabel && <span className={s.reason}>{reasonLabel}</span>}
              </button>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
