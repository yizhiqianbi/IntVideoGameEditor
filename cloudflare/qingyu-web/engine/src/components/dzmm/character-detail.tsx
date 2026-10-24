"use client";

/* eslint-disable @next/next/no-img-element -- Local reference covers and user-imported role images. */
import { useEffect, useId, useRef, useState } from "react";
import type { Character } from "@/lib/dzmm-characters";
import { getXumengExportedCardMetadata } from "@/lib/xumeng-exported-cards";
import { getDzmmCharacterCreatorNotes } from "@/lib/dzmm-character-presentation";
import { characterSharePath } from "@/lib/xumeng-character-link";
import { xumengImageUrl, XUMENG_FALLBACK_COVER } from "@/lib/xumeng-routes";
import Icon from "./icons";
import CharacterIntroduction from "./character-introduction";
import s from "./character-detail.module.css";

export type CharacterDetailProps = {
  character: Character;
  favorites: boolean;
  liked?: boolean;
  likeCount?: string;
  related: Character[];
  onBack: () => void;
  onStart: () => void;
  onLive?: () => void;
  onVoice?: () => void;
  onFavorite: () => void;
  onLike?: () => void;
  onExport: () => void;
  onEdit: () => void;
  onSelect: (character: Character) => void;
  onNotice: (message: string) => void;
  onAuthor?: () => void;
  onFollow?: () => void;
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
      src={xumengImageUrl(src || character.cover || XUMENG_FALLBACK_COVER)}
      alt={character.name}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = XUMENG_FALLBACK_COVER;
      }}
    />
  );
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
  onAuthor,
  onFollow,
  following = false,
  galleryPaths = [],
  userName,
}: CharacterDetailProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [picture, setPicture] = useState({ characterId: character.id, index: 0 });
  const menuOpen = menuFor === character.id;
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const gallery = [...new Set((galleryPaths.length ? galleryPaths : character.gallery ?? []).filter(Boolean))];
  const pictures = gallery.length ? gallery : [character.cover || XUMENG_FALLBACK_COVER];
  const pictureIndex = picture.characterId === character.id ? Math.min(picture.index, pictures.length - 1) : 0;
  const isPublicSample = character.sourceKind === "public-summary";
  const exportedCard = getXumengExportedCardMetadata(character);
  function onExport() {
    if (!exportedCard) { onExportCompatible(); return; }
    const link = document.createElement("a");
    link.href = exportedCard.downloadUrl;
    link.download = "";
    link.click();
  }
  const contextMissing = character.catalogReadiness === "metadata-only";
  const date = displayDate(character.createdAt);
  const recommendations = related
    .filter((role) => role.id !== character.id)
    .slice(0, 5);

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
    if (character.authoringDraft) { onNotice("这张角色还有未完成的世界书，请先完善草稿再分享角色卡。"); return; }
    if (!isPublicSample && !character.publication) {
      onExport();
      onNotice("私人角色卡已导出，可以分享这个 JSON 文件。");
      return;
    }
    const sharePath = characterSharePath(character.id);
    const url = sharePath ? `${location.origin}${sharePath}` : `${location.origin}/#character/${encodeURIComponent(character.id)}`;
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
            <span className={s.heat}><Icon name="flame" size={16} />{character.heat}</span>
            {pictures.length > 1 && <><button className={`${s.galleryArrow} ${s.galleryPrevious}`} type="button" aria-label="上一张封面" onClick={() => selectPicture(pictureIndex - 1)}><Icon name="chevron" size={18} /></button><button className={`${s.galleryArrow} ${s.galleryNext}`} type="button" aria-label="下一张封面" onClick={() => selectPicture(pictureIndex + 1)}><Icon name="chevron" size={18} /></button><span className={s.pictureCount} aria-live="polite">{pictureIndex + 1} / {pictures.length}</span></>}
          </div>
          {pictures.length > 1 && <div className={s.thumbnails} aria-label="选择角色图片">{pictures.map((path, index) => <button type="button" className={index === pictureIndex ? s.selectedThumbnail : ""} key={path} aria-label={`查看第 ${index + 1} 张图片`} aria-pressed={index === pictureIndex} onClick={() => selectPicture(index)}><img src={xumengImageUrl(path)} alt="" /></button>)}</div>}
        </div>

        <div className={s.info}>
          <div className={s.titleRow}>
            <h1 id="character-detail-title">{character.name}</h1>
            <div className={s.moreContainer} ref={menuRef}><button ref={menuButton} className={s.more} type="button" onClick={() => setMenuFor(menuOpen ? null : character.id)} aria-label="角色更多操作" title="更多操作" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}><Icon name="more" size={20} /></button>{menuOpen && <div className={s.moreMenu} role="menu" id={menuId} aria-label="角色操作"><button role="menuitem" type="button" onClick={() => { setMenuFor(null); onExport(); }}><Icon name="download" size={15} />{character.authoringDraft ? "导出私人草稿" : "导出角色卡"}</button><button role="menuitem" type="button" onClick={() => { setMenuFor(null); onEdit(); }}><Icon name="edit" size={15} />定制角色</button></div>}</div>
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
                <small>{isPublicSample || character.publication ? "公开角色作者" : "我的角色"}</small>
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
              title={exportedCard ? "晴屿用户点赞" : isPublicSample ? "收录时点赞数 + 晴屿新增点赞" : "点赞角色"}
            >
              <Icon name="heart" size={17} />
              {likeCount ?? character.likes}
            </button> : <span
              className={s.likeCount}
              title={exportedCard ? "晴屿用户点赞" : isPublicSample ? "收录时点赞数 + 晴屿新增点赞" : "自定义角色"}
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

          <div className={s.tags} aria-label="角色标签">
            {character.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>

          <div className={s.primaryActions}>
            <button className={s.start} type="button" onClick={contextMissing ? onEdit : onStart}>
              <Icon name="chat" size={18} />
              {character.authoringDraft ? "完善草稿" : contextMissing ? "补充角色设定" : "开始探险"}
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
          {!contextMissing && <div className={s.performanceActions}>{onLive && <button className={s.outline} onClick={onLive}><Icon name="video" size={16} />给角色打电话</button>}{onVoice && <button className={s.outline} onClick={onVoice}><Icon name="volume" size={16} />生成角色语音</button>}</div>}
        </div>
      </div>

      <section
        className={s.introduction}
        aria-labelledby="character-intro-title"
      >
        <h2 id="character-intro-title">一句话</h2>
        <CharacterIntroduction text={character.introduction || character.description || ""}
          additionalNotes={getDzmmCharacterCreatorNotes(character)} bodyClassName={s.description}
          characterName={character.name} userName={userName}
          fallback={contextMissing ? "这个角色的故事设定尚未补齐。你可以导入完整角色卡，或通过定制补充人物背景和开场。" : "还没有填写角色介绍。可以定制这个角色，补充它的故事。"} />
        {character.firstMessage && <details className={s.promptDetails}>
          <summary>查看开场 <Icon name="chevron" size={14} /></summary>
          <div className={s.promptContent}><CharacterIntroduction text={character.firstMessage} characterName={character.name} userName={userName} /></div>
        </details>}
        {(character.personality || character.scenario) && (
          <details className={s.promptDetails}>
            <summary>
              查看角色设定
              <Icon name="chevron" size={14} />
            </summary>
            <div className={s.promptContent}>
              {character.introduction && character.description && character.description !== character.introduction && (
                <div>
                  <h3>人物经历与生活</h3>
                  <CharacterIntroduction text={character.description} characterName={character.name} userName={userName} />
                </div>
              )}
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
            </div>
          </details>
        )}
        {exportedCard && <div className={`${s.source} ${s.exportSource}`}>
          <span>完整原卡 · {character.characterBook?.entries.length ?? 0} 条世界书 · {(character.alternateGreetings?.length ?? 0) + 1} 个开场</span>
          <span>作者：{exportedCard.author} · <a href={exportedCard.sourceUrl} target="_blank" rel="noopener noreferrer">作者发布页</a> · <a href={exportedCard.licenseUrl} target="_blank" rel="noopener noreferrer">{exportedCard.licenseName}</a></span>
          <span>原文件完整保留；页面采用晴屿排版，卡内数值和指令按故事设定演绎。</span>
          <a href={exportedCard.downloadUrl} download>下载完整原卡 JSON</a>
        </div>}
        {character.catalogReadiness === "public-context" && <p className={s.source}>当前对话使用已补齐的故事背景{character.firstMessage ? "与开场" : ""}；完整角色卡和世界书尚未补齐。</p>}

      </section>

      {recommendations.length > 0 && (
        <section
          className={s.related}
          aria-labelledby="character-related-title"
        >
          <h2 id="character-related-title">你可能也喜欢</h2>
          <div className={s.relatedGrid}>
            {recommendations.map((role) => (
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
              </button>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
