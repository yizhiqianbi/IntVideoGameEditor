"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { AssetCard } from "@/lib/drama-assets";
import type { Shot } from "@/lib/drama";
import {
  addDirectorImage,
  addDirectorSegment,
  audioFromMedia,
  clipFromMedia,
  directorClipLanes,
  directorOf,
  directorOutputSeconds,
  DIRECTOR_CLIP_GAP,
  DIRECTOR_CLIP_HEIGHT,
  DIRECTOR_CLIP_TOP,
  directorTrackHeight,
  editDirectorWindow,
  emptyDirector,
  H3_FPS,
  mergeDirectorReferences,
  moveDirectorClip,
  removeDirectorClip,
  removeDirectorImage,
  removeDirectorSegment,
  seedDirectorPrompt,
  setDirectorDuration,
  type TimelineDirectorState,
  type TimelineReferenceMode,
  type TimelineVideoClip,
} from "@/lib/drama-timeline";
import {
  uploadReferenceMedia,
  type ReferenceMedia,
} from "@/lib/drama-reference-media";
import { directorMentionSlots } from "@/lib/drama-mentions";
import { hostDramaImage } from "@/lib/drama-stills";
import { needsTranscode, transcodeVideo, MAX_INPUT_BYTES } from "@/lib/video-transcode";
import { FilmScrubber, formatClock } from "./film-scrubber";
import { MentionField } from "./mention-field";
import styles from "./studio.module.css";

const PX = 24;
const VIDEO_EXTS = /\.(mp4|mov|avi|mkv|webm|flv|wmv|ts|m4v|3gp|hevc|mts|m2ts)$/i;
const AUDIO_EXTS = /\.(wav|mp3|aac|m4a|ogg|flac)$/i;
const MODE_LABEL: Record<TimelineReferenceMode, string> = {
  guide: "固定 Guide",
  edit: "可编辑参考",
  boundary: "仅固定边界",
};

function previewableImage(url: string) {
  return (
    url.startsWith("data:image/") ||
    url.startsWith("blob:") ||
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("/")
  );
}

export function TimelineDirectorDock({
  shot,
  assets,
  seedPrompt = "",
  disabled,
  generateBusy,
  generateLabel,
  canStop,
  onChange,
  onBusy,
  onError,
  onGenerate,
  onStop,
}: {
  shot: Shot;
  assets: AssetCard[];
  seedPrompt?: string;
  disabled?: boolean;
  generateBusy?: boolean;
  generateLabel?: string;
  canStop?: boolean;
  onChange: (
    director: TimelineDirectorState,
    duration?: number,
    extras?: { referenceBindings?: Record<string, string> },
  ) => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onGenerate?: () => void;
  onStop?: () => void;
}) {
  const source = directorOf(shot.timelineDirector, shot.duration);
  const [draft, setDraft] = useState<TimelineDirectorState | null>(null);
  const gesture = useRef(false);
  const live = useRef(source);
  const fileRef = useRef<HTMLInputElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [activeClip, setActiveClip] = useState<string>("");
  if (!gesture.current) live.current = source;
  const director = draft ?? source;
  const seconds = directorOutputSeconds(director);
  const width = Math.max(640, (seconds + 4) * PX);
  const boundCards = (shot.assetIds || [])
    .map((id) => assets.find((item) => item.id === id))
    .filter((item): item is AssetCard => !!item?.imageUrl);
  const shotMedia = shot.referenceMedia || [];
  const mentionSlots = directorMentionSlots(shot, assets, director);
  const mentionBindings = shot.referenceBindings || {};
  const mentionEmpty =
    "先勾选带图片的参考卡，或在导演台上传图、视频、音频。";

  function patchPrompt(
    next: TimelineDirectorState,
    referenceBindings?: Record<string, string>,
  ) {
    patch(
      next,
      referenceBindings ? { referenceBindings } : undefined,
    );
  }

  function commit(
    next: TimelineDirectorState,
    extras?: { referenceBindings?: Record<string, string> },
  ) {
    live.current = next;
    gesture.current = false;
    setDraft(null);
    onChange(next, directorOutputSeconds(next), extras);
  }

  function preview(next: TimelineDirectorState) {
    live.current = next;
    setDraft(next);
  }

  function patch(
    next: TimelineDirectorState,
    extras?: { referenceBindings?: Record<string, string> },
  ) {
    if (gesture.current) preview(next);
    else commit(next, extras);
  }

  function frameAt(clientX: number) {
    const node = rulerRef.current;
    if (!node) return 0;
    const x = clientX - node.getBoundingClientRect().left + node.scrollLeft;
    return Math.max(0, Math.round((x / PX) * H3_FPS));
  }

  function paintClip(id: string, start: number) {
    const node = rulerRef.current?.querySelector(`[data-clip-id="${id}"]`);
    if (node instanceof HTMLElement) node.style.left = `${start * PX}px`;
  }

  function paintWindows(segments: TimelineDirectorState["segments"]) {
    segments.forEach((segment, index) => {
      const node = rulerRef.current?.querySelector(`[data-gen-index="${index}"]`);
      if (!(node instanceof HTMLElement)) return;
      node.style.left = `${(segment.startFrame / H3_FPS) * PX}px`;
      node.style.width = `${Math.max(
        48,
        ((segment.endFrame - segment.startFrame) / H3_FPS) * PX,
      )}px`;
      const label = node.querySelector("[data-gen-label]");
      if (label) {
        label.textContent = `GEN ${index + 1} · ${formatClock(segment.startFrame / H3_FPS)}–${formatClock(segment.endFrame / H3_FPS)}`;
      }
    });
    segments.slice(1).forEach((segment, index) => {
      const prev = segments[index];
      const overlap = prev.endFrame - segment.startFrame;
      const node = rulerRef.current?.querySelector(
        `[data-overlap-index="${index}"]`,
      );
      if (!(node instanceof HTMLElement)) return;
      if (overlap <= 0) {
        node.hidden = true;
        return;
      }
      node.hidden = false;
      node.style.left = `${(segment.startFrame / H3_FPS) * PX}px`;
      node.style.width = `${Math.max(2, (overlap / H3_FPS) * PX)}px`;
    });
  }

  function trackPointer(
    event: ReactPointerEvent,
    onMove: (next: PointerEvent) => void,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    gesture.current = true;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      next.preventDefault();
      onMove(next);
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      commit(live.current);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function dragWindow(
    index: number,
    mode: "move" | "left" | "right",
    event: ReactPointerEvent,
  ) {
    if (disabled) return;
    const origin = frameAt(event.clientX);
    const segment = live.current.segments[index];
    if (!segment) return;
    const start0 = segment.startFrame;
    const end0 = segment.endFrame;
    trackPointer(event, (next) => {
      const delta = frameAt(next.clientX) - origin;
      const current = {
        ...live.current,
        segments: editDirectorWindow(
          live.current.segments,
          index,
          mode,
          mode === "right" ? end0 + delta : start0 + delta,
        ),
      };
      live.current = current;
      paintWindows(current.segments);
    });
  }

  function dragClip(clip: TimelineVideoClip, event: ReactPointerEvent) {
    if (disabled) return;
    const origin = event.clientX;
    const start = clip.start;
    trackPointer(event, (next) => {
      const moved = moveDirectorClip(clip, start + (next.clientX - origin) / PX);
      live.current = {
        ...live.current,
        videoClips: live.current.videoClips.map((item) =>
          item.id === clip.id ? moved : item,
        ),
      };
      paintClip(clip.id, moved.start);
    });
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    onBusy(true);
    try {
      let next = { ...director, enabled: true };
      for (const file of files) {
        const kind = file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("audio/") || AUDIO_EXTS.test(file.name)
            ? "audio"
            : file.type.startsWith("video/") || VIDEO_EXTS.test(file.name)
              ? "video"
              : "";
        if (!kind) throw new Error("请上传视频、音频或图片");
        if (kind === "image") {
          const local = URL.createObjectURL(file);
          try {
            const hosted = await hostDramaImage(local);
            next = addDirectorImage(next, {
              id: crypto.randomUUID(),
              name: file.name,
              url: hosted,
              ...(hosted.startsWith("comfy-input:")
                ? { file: hosted.slice("comfy-input:".length) }
                : {}),
            });
          } finally {
            URL.revokeObjectURL(local);
          }
          continue;
        }
        let uploadFile: Blob = file;
        let uploadName = file.name;
        if (kind === "video") {
          if (file.size > MAX_INPUT_BYTES)
            throw new Error(
              `视频文件过大（${(file.size / 1024 / 1024).toFixed(0)} MB），上限 500 MB`,
            );
          if (needsTranscode(file)) {
            const result = await transcodeVideo(
              file,
              (msg) => onError(`导演台转码 ${file.name}：${msg}`),
              { maxDuration: 180 },
            );
            uploadFile = result.file;
            uploadName = result.file.name;
          }
        }
        const media = await uploadReferenceMedia(
          uploadFile,
          uploadName,
          kind,
          (n) => onError(`导演台上传 ${uploadName} · ${n}%`),
          { timeline: true },
        );
        if (kind === "video") {
          const start = next.videoClips.reduce(
            (max, clip) => Math.max(max, clip.start + clip.duration),
            0,
          );
          next = { ...next, videoClips: [...next.videoClips, clipFromMedia(media, start)] };
        } else {
          next = { ...next, audios: [...next.audios, audioFromMedia(media)] };
        }
      }
      onChange(next, directorOutputSeconds(next));
      onError("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "导演台素材上传失败");
    } finally {
      onBusy(false);
    }
  }

  function addLibraryMedia(media: ReferenceMedia) {
    const current = live.current;
    if (media.kind === "video") {
      if (current.videoClips.some((clip) => clip.mediaId === media.id)) return;
      const start = current.videoClips.reduce(
        (max, clip) => Math.max(max, clip.start + clip.duration),
        0,
      );
      const added = clipFromMedia(media, start);
      setActiveClip(added.id);
      patch({
        ...current,
        videoClips: [...current.videoClips, added],
      });
      return;
    }
    if (current.audios.some((audio) => audio.mediaId === media.id)) return;
    patch({
      ...current,
      audios: [...current.audios, audioFromMedia(media)],
    });
  }

  async function addShotVideo(url: string, name: string) {
    onBusy(true);
    try {
      const blob = await (await fetch(url)).blob();
      if (!blob.size) throw new Error("成片还不能作为导演台参考，请稍后再试");
      const media = await uploadReferenceMedia(
        blob,
        name,
        "video",
        (n) => onError(`导演台上传 ${name} · ${n}%`),
        { timeline: true },
      );
      addLibraryMedia(media);
      onError("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "成片加入导演台失败");
    } finally {
      onBusy(false);
    }
  }

  async function addAssetImage(asset: AssetCard) {
    onBusy(true);
    try {
      const hosted = await hostDramaImage(asset.imageUrl);
      patch(
        addDirectorImage(live.current, {
          id: asset.id,
          name: asset.title,
          url: asset.imageUrl,
          ...(hosted.startsWith("comfy-input:")
            ? { file: hosted.slice("comfy-input:".length) }
            : {}),
        }),
      );
      onError("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "参考图上传失败");
    } finally {
      onBusy(false);
    }
  }

  const ticks = Array.from({ length: Math.floor(seconds / 5) + 2 }, (_, i) => i * 5);
  const selected = director.videoClips.find((clip) => clip.id === activeClip);
  const clipLanes = directorClipLanes(director.videoClips);
  const trackHeight = directorTrackHeight(director.videoClips);
  const canGenerate =
    !!director.globalPrompt.trim() ||
    director.segments.some((item) => item.prompt.trim()) ||
    !!seedPrompt.trim();

  function generateBar() {
    if (!director.enabled || !onGenerate) return null;
    return (
      <div className={styles.directorGenerate}>
        <button
          type="button"
          className={styles.primary}
          disabled={generateBusy || canStop || !canGenerate}
          onClick={onGenerate}
        >
          {generateLabel || `导演生成 ${seconds}s ↗`}
        </button>
        {canStop && onStop && (
          <button type="button" className={styles.stop} onClick={onStop}>
            终止生成
          </button>
        )}
      </div>
    );
  }

  return (
    <section className={styles.director} data-enabled={director.enabled}>
      <header className={styles.directorHead}>
        <label className={styles.directorToggle}>
          <input
            type="checkbox"
            checked={director.enabled}
            disabled={disabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              const next = enabled
                ? mergeDirectorReferences(
                    seedDirectorPrompt({ ...director, enabled: true }, seedPrompt),
                    shot,
                    assets,
                  )
                : { ...director, enabled: false };
              if (enabled && !next.segments.length) {
                Object.assign(
                  next,
                  mergeDirectorReferences(
                    seedDirectorPrompt(
                      { ...emptyDirector(shot.duration || 15), enabled: true },
                      seedPrompt,
                    ),
                    shot,
                    assets,
                  ),
                );
              }
              patch(next);
            }}
          />
          时间线导演台
        </label>
        <div className={styles.directorActions}>
          <button
            type="button"
            disabled={disabled || !director.enabled}
            onClick={() => fileRef.current?.click()}
          >
            + 素材
          </button>
          <button
            type="button"
            disabled={disabled || !director.enabled}
            onClick={() => {
              try {
                patch(addDirectorSegment(director));
              } catch (error) {
                onError(error instanceof Error ? error.message : "无法增加分段");
              }
            }}
          >
            + GEN 段
          </button>
          {director.enabled && onGenerate && (
            <>
              <button
                type="button"
                className={styles.primary}
                disabled={generateBusy || canStop || !canGenerate}
                onClick={onGenerate}
              >
                {generateLabel || `导演生成 ${seconds}s ↗`}
              </button>
              {canStop && onStop && (
                <button type="button" className={styles.stop} onClick={onStop}>
                  终止
                </button>
              )}
            </>
          )}
        </div>
        {director.enabled && (
          <FilmScrubber
            min={3}
            max={60}
            value={seconds}
            disabled={disabled}
            ariaLabel="导演台总时长"
            marks={director.segments.map((segment) =>
              Math.round(segment.startFrame / H3_FPS),
            )}
            onScrub={(value) => {
              gesture.current = true;
              preview(setDirectorDuration(live.current, value));
            }}
            onChange={(value) => {
              commit(setDirectorDuration(live.current, value));
            }}
          />
        )}
      </header>
      {director.enabled && (
        <>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="video/mp4,video/quicktime,audio/mpeg,audio/wav,image/png,image/jpeg,image/webp"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <div
            ref={rulerRef}
            className={styles.directorRuler}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              void addFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <div
              className={styles.directorTrack}
              style={{ width, height: trackHeight }}
            >
              <div className={styles.directorTicks} aria-hidden>
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    data-major
                    data-first={tick === 0 || undefined}
                    style={{ left: tick * PX }}
                  >
                    {formatClock(tick)}
                  </span>
                ))}
              </div>
              {director.segments.slice(1).map((segment, index) => {
                const prev = director.segments[index];
                const overlap = prev.endFrame - segment.startFrame;
                return (
                  <div
                    key={`overlap-${index}`}
                    data-overlap-index={index}
                    className={styles.directorOverlap}
                    hidden={overlap <= 0}
                    style={{
                      left: (segment.startFrame / H3_FPS) * PX,
                      width: Math.max(2, (overlap / H3_FPS) * PX),
                    }}
                    title={`续写重叠 ${formatClock(Math.max(0, overlap) / H3_FPS)}`}
                  />
                );
              })}
              {director.segments.map((segment, index) => (
                <div
                  key={`gen-${index}`}
                  data-gen-index={index}
                  className={styles.directorGen}
                  style={{
                    left: (segment.startFrame / H3_FPS) * PX,
                    width: Math.max(
                      48,
                      ((segment.endFrame - segment.startFrame) / H3_FPS) * PX,
                    ),
                  }}
                  onPointerDown={(event) => dragWindow(index, "move", event)}
                >
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    className={styles.directorHandle}
                    aria-label={`第 ${index + 1} 段起点`}
                    onPointerDown={(event) => dragWindow(index, "left", event)}
                  />
                  <span data-gen-label>
                    GEN {index + 1} · {formatClock(segment.startFrame / H3_FPS)}–
                    {formatClock(segment.endFrame / H3_FPS)}
                  </span>
                  {director.segments.length > 1 && (
                    <button
                      type="button"
                      className={styles.directorGenClose}
                      disabled={disabled}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        patch(removeDirectorSegment(director, index));
                      }}
                    >
                      ×
                    </button>
                  )}
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    className={styles.directorHandle}
                    aria-label={`第 ${index + 1} 段终点`}
                    onPointerDown={(event) => dragWindow(index, "right", event)}
                  />
                </div>
              ))}
              {director.videoClips.map((clip) => (
                <div
                  key={clip.id}
                  data-clip-id={clip.id}
                  className={styles.directorClip}
                  data-active={clip.id === activeClip || undefined}
                  style={{
                    left: clip.start * PX,
                    top:
                      DIRECTOR_CLIP_TOP +
                      (clipLanes.lanes.get(clip.id) || 0) *
                        (DIRECTOR_CLIP_HEIGHT + DIRECTOR_CLIP_GAP),
                    width: Math.max(72, clip.duration * PX),
                  }}
                  onPointerDown={(event) => {
                    dragClip(clip, event);
                    setActiveClip(clip.id);
                  }}
                >
                  <span>{clip.name}</span>
                  <small>{MODE_LABEL[clip.referenceMode]}</small>
                  <button
                    type="button"
                    className={styles.directorClipClose}
                    disabled={disabled}
                    aria-label={`移出 ${clip.name}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      patch(removeDirectorClip(director, clip.id));
                      if (activeClip === clip.id) setActiveClip("");
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
          {director.segments.length > 1 && (
            <p className={styles.directorHint}>
              金色重叠是下一段的续写接头，大约 1.6 秒。拖第二段左缘可以加大或收回；拖中间只平移，不会把重叠一下子清掉。
            </p>
          )}
          <div className={styles.directorBins}>
            {selected && (
              <div className={styles.directorModes} role="group" aria-label="参考用途">
                {Object.entries(MODE_LABEL).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    data-on={selected.referenceMode === value || undefined}
                    disabled={disabled}
                    onClick={() =>
                      patch({
                        ...director,
                        videoClips: director.videoClips.map((item) =>
                          item.id === selected.id
                            ? { ...item, referenceMode: value as TimelineReferenceMode }
                            : item,
                        ),
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    patch(removeDirectorClip(director, selected.id));
                    setActiveClip("");
                  }}
                >
                  移出时间线
                </button>
              </div>
            )}
            <label>
              从镜头参考加入
              <select
                disabled={disabled || (!shotMedia.length && !shot.videoUrl)}
                value=""
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "shot-video" && shot.videoUrl) {
                    void addShotVideo(shot.videoUrl, `${shot.title || "本镜"}.mp4`);
                    return;
                  }
                  const media = shotMedia.find((item) => item.id === value);
                  if (!media) return;
                  addLibraryMedia(media);
                }}
              >
                <option value="">已有音视频…</option>
                {shot.videoUrl && (
                  <option value="shot-video">本镜成片 · {shot.title}</option>
                )}
                {shotMedia.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.kind === "video" ? "视频" : "音频"} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              加入参考图
              <select
                disabled={disabled}
                value=""
                onChange={(e) => {
                  const asset = assets.find((item) => item.id === e.target.value);
                  if (!asset?.imageUrl) return;
                  void addAssetImage(asset);
                }}
              >
                <option value="">角色/场景卡…</option>
                {assets
                  .filter(
                    (item) =>
                      item.imageUrl &&
                      !director.images.some((image) => image.id === item.id),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                      {boundCards.some((card) => card.id === item.id)
                        ? " · 已关联"
                        : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.directorCheck}>
              <input
                type="checkbox"
                checked={director.videoAudioEnabled}
                disabled={disabled}
                onChange={(e) =>
                  patch({ ...director, videoAudioEnabled: e.target.checked })
                }
              />
              使用视频原声
            </label>
            {director.audios.map((audio) => (
              <label key={audio.id} className={styles.directorCheck}>
                <input
                  type="checkbox"
                  checked={audio.audioMode === "locked"}
                  disabled={disabled}
                  onChange={(e) =>
                    patch({
                      ...director,
                      audios: director.audios.map((item) =>
                        item.id === audio.id
                          ? {
                              ...item,
                              audioMode: e.target.checked ? "locked" : "reference",
                            }
                          : item,
                      ),
                    })
                  }
                />
                锁定 {audio.name}
              </label>
            ))}
          </div>
          <p className={styles.directorHint}>
            {director.images.length || boundCards.length
              ? `参考图会写进每一段 GEN；镜头已关联的角色/场景卡在生成时也会自动带上。`
              : "加入角色卡、本镜成片或音视频参考后，才会按参考素材生成；空时间线只是加长文生视频。"}
          </p>
          {(director.images.length > 0 || boundCards.length > 0) && (
            <ul className={styles.directorImages}>
              {director.images.map((image) => (
                <li key={image.id}>
                  {previewableImage(image.url) ? (
                    <img src={image.url} alt="" />
                  ) : (
                    <span className={styles.directorImageFallback} />
                  )}
                  <span>{image.name}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`移出 ${image.name}`}
                    onClick={() => patch(removeDirectorImage(director, image.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
              {boundCards
                .filter((card) => !director.images.some((image) => image.id === card.id))
                .map((card) => (
                  <li key={`bound-${card.id}`} data-pending="">
                    {previewableImage(card.imageUrl) ? (
                      <img src={card.imageUrl} alt="" />
                    ) : (
                      <span className={styles.directorImageFallback} />
                    )}
                    <span>{card.title} · 已关联</span>
                  </li>
                ))}
            </ul>
          )}
          <div className={styles.directorPromptHead}>
            <label
              className={styles.directorPrompt}
              htmlFor="director-global-prompt"
            >
              导演台提示词
              <small>输入 @ 引用参考图、视频或音频</small>
            </label>
            <MentionField
              id="director-global-prompt"
              listId="director-global-choices"
              value={director.globalPrompt}
              disabled={disabled}
              placeholder="打开导演台时会从右侧镜头带过来。输入 @ 引用素材。多段 GEN 若写了分段提示词，则以分段为准。"
              slots={mentionSlots}
              bindings={mentionBindings}
              showChips
              compactChips
              emptyHint={mentionEmpty}
              onChange={(globalPrompt, referenceBindings) =>
                patchPrompt(
                  { ...director, globalPrompt },
                  referenceBindings,
                )
              }
            />
            <button
              type="button"
              disabled={disabled || !seedPrompt.trim()}
              onClick={() =>
                patch({
                  ...director,
                  globalPrompt: seedPrompt,
                })
              }
            >
              从镜头填入
            </button>
          </div>
          {director.segments.length > 1 &&
            director.segments.map((segment, index) => (
              <label
                key={`${segment.startFrame}-prompt`}
                className={styles.directorPrompt}
                htmlFor={`director-segment-prompt-${index}`}
              >
                第 {index + 1} 段提示词
                <MentionField
                  id={`director-segment-prompt-${index}`}
                  listId={`director-segment-choices-${index}`}
                  value={segment.prompt}
                  disabled={disabled}
                  placeholder="留空则共用上面的导演台提示词；写了任意一段就必须写全。输入 @ 引用素材。"
                  slots={mentionSlots}
                  bindings={mentionBindings}
                  emptyHint={mentionEmpty}
                  onChange={(prompt, referenceBindings) =>
                    patchPrompt(
                      {
                        ...director,
                        segments: director.segments.map((item, i) =>
                          i === index ? { ...item, prompt } : item,
                        ),
                      },
                      referenceBindings,
                    )
                  }
                />
              </label>
            ))}
          {generateBar()}
        </>
      )}
    </section>
  );
}

export function enableDirector(
  shot: Shot,
  assets: AssetCard[] = [],
  seedPrompt = "",
): TimelineDirectorState {
  return mergeDirectorReferences(
    seedDirectorPrompt(
      setDirectorDuration(
        { ...directorOf(shot.timelineDirector, shot.duration), enabled: true },
        shot.duration || 15,
      ),
      seedPrompt,
    ),
    shot,
    assets,
  );
}
