"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { newAsset, shotContext, type AssetCard } from "@/lib/drama-assets";
import { newShot, type Shot } from "@/lib/drama";
import {
  attachAssets,
  bindProjectAssets,
  composeShotPrompt,
  planFromShot,
  type GpuHint,
} from "@/lib/drama-prompt";
import { parseShotDuration } from "@/lib/drama-models";
import {
  DEFAULT_SCRIPT_MODEL,
  DEFAULT_SCRIPT_PROVIDER,
  DEFAULT_SCRIPT_TONE,
  TONE_OPTIONS,
  normalizeTone,
  type ScriptTone,
} from "@/lib/drama-script";
import {
  TOONFLOW_LOOKS,
  TOONFLOW_SAMPLE,
  TOONFLOW_STEPS,
  nextToonflowStep,
  toonflowAssetPrompt,
  toonflowPromptSettings,
  type ToonflowLook,
  type ToonflowStep,
} from "@/lib/toonflow";
import { readApiJson, translateDramaNetworkError } from "@/lib/drama-api";
import { hostDramaImage, hostDramaImages } from "@/lib/drama-stills";
import styles from "./toonflow.module.css";

const STORE = "pencil.toonflow.v2";

type GpuState = GpuHint & {
  connected: boolean;
  ready: boolean;
  error?: string;
};

function isBusy(status?: string) {
  return ["IN_QUEUE", "IN_PROGRESS", "SUBMITTING"].includes(status || "");
}

async function post(path: string, body: unknown, timeoutMs = 120000) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(translateDramaNetworkError(error, "video"));
  }
  const data = await readApiJson(response);
  if (!response.ok) throw new Error(data.error || data.message || "请求失败");
  return data;
}

export default function ToonflowPage() {
  const [step, setStep] = useState<ToonflowStep>("story");
  const [story, setStory] = useState(TOONFLOW_SAMPLE);
  const [title, setTitle] = useState("未命名悬疑短剧");
  const [look, setLook] = useState<ToonflowLook>("cinematic");
  const [tone, setTone] = useState<ScriptTone>(DEFAULT_SCRIPT_TONE);
  const [ratio, setRatio] = useState("9:16");
  const [assets, setAssets] = useState<AssetCard[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [gpu, setGpu] = useState<GpuState>({ connected: false, ready: false });
  const [notice, setNotice] = useState("");
  const [writing, setWriting] = useState(false);
  const [drawing, setDrawing] = useState("");
  const [shooting, setShooting] = useState("");
  const shotsRef = useRef<Shot[]>([]);
  const polling = useRef(false);
  shotsRef.current = shots;

  const counts = useMemo(
    () => ({
      shots: shots.length,
      assets: assets.length,
      images: assets.filter((a) => a.imageUrl).length,
      videos: shots.filter((s) => s.videoUrl).length,
    }),
    [assets, shots],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        step?: ToonflowStep;
        story?: string;
        title?: string;
        look?: ToonflowLook;
        tone?: string;
        ratio?: string;
        assets?: AssetCard[];
        shots?: Shot[];
      };
      if (saved.story) setStory(saved.story);
      if (saved.title) setTitle(saved.title);
      if (saved.look === "cinematic" || saved.look === "toon") setLook(saved.look);
      if (saved.tone) setTone(normalizeTone(saved.tone));
      if (saved.ratio) setRatio(saved.ratio);
      if (Array.isArray(saved.assets)) setAssets(saved.assets);
      if (Array.isArray(saved.shots)) setShots(saved.shots);
      if (saved.step) setStep(saved.step);
    } catch {
      /* ignore broken drafts */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORE,
      JSON.stringify({ step, story, title, look, tone, ratio, assets, shots }),
    );
  }, [step, story, title, look, tone, ratio, assets, shots]);

  useEffect(() => {
    let live = true;
    const check = () =>
      fetch("/api/drama/health")
        .then((r) => r.json())
        .then((d) => {
          if (live) setGpu(d);
        })
        .catch(() => {
          if (live) setGpu({ connected: false, ready: false });
        });
    check();
    const timer = setInterval(check, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!shots.some((s) => isBusy(s.status) && s.taskId)) return;
    let cancelled = false;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        for (const shot of shotsRef.current.filter((s) => s.taskId && isBusy(s.status))) {
          try {
            const data = await post("/api/drama/video", {
              action: "status",
              provider: "comfy",
              mode: shot.taskMode || shot.mode,
              taskId: shot.taskId,
              videoModel: shot.taskVideoModel ?? "h3",
            });
            if (cancelled) return;
            setShots((all) =>
              all.map((s) =>
                s.id === shot.id
                  ? {
                      ...s,
                      status: data.status,
                      videoUrl: data.videoUrl || s.videoUrl,
                      error: data.error,
                      queuePosition: data.queuePosition,
                    }
                  : s,
              ),
            );
          } catch (error) {
            if (!cancelled)
              setShots((all) =>
                all.map((s) =>
                  s.id === shot.id
                    ? {
                        ...s,
                        status: "CHECK_FAILED",
                        error: error instanceof Error ? error.message : "查询失败",
                      }
                    : s,
                ),
              );
          }
        }
      } finally {
        polling.current = false;
      }
    };
    const timer = setInterval(tick, 6000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [shots]);

  async function writeScript() {
    setWriting(true);
    setNotice("");
    try {
      const data = await post(
        "/api/drama/script",
        {
          story,
          tone,
          scriptProvider: DEFAULT_SCRIPT_PROVIDER,
          scriptModel: DEFAULT_SCRIPT_MODEL,
        },
        180000,
      );
      const nextAssets: AssetCard[] = (data.assets || []).map(
        (asset: { kind: AssetCard["kind"]; title: string; description: string }, i: number) => ({
          ...newAsset(asset.kind, i),
          title: asset.title,
          description: asset.description,
        }),
      );
      const nextShots: Shot[] = (data.shots || []).map(
        (
          shot: {
            title: string;
            prompt: string;
            promptFields?: Shot["promptFields"];
            duration?: number;
          },
          i: number,
        ) =>
          bindProjectAssets(
            {
              ...newShot(i, shot.title, shot.prompt),
              promptFields: shot.promptFields,
              duration: parseShotDuration(shot.duration),
            },
            nextAssets,
          ),
      );
      setTitle(typeof data.title === "string" ? data.title : title);
      setAssets(nextAssets);
      setShots(nextShots);
      setStep(nextToonflowStep("story", { ...counts, shots: nextShots.length, assets: nextAssets.length }));
      setNotice(`已拆成 ${nextShots.length} 镜、${nextAssets.length} 张设定卡。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "编剧失败");
    } finally {
      setWriting(false);
    }
  }

  async function drawAsset(card: AssetCard) {
    setDrawing(card.id);
    setNotice("");
    try {
      const data = await post("/api/image/generate", {
        model: "x-ai/grok-imagine-image-2.0",
        prompt: toonflowAssetPrompt(card, look),
        size: "1K",
      });
      if (!data.b64Json) throw new Error("生图未返回图片");
      const imageUrl = `data:${data.mimeType || "image/png"};base64,${data.b64Json}`;
      const next = assets.map((item) => (item.id === card.id ? { ...item, imageUrl } : item));
      setAssets(next);
      setShots((all) => all.map((shot) => attachAssets(shot, next)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "角色图失败");
    } finally {
      setDrawing("");
    }
  }

  async function shootShot(shot: Shot) {
    if (isBusy(shot.status)) return;
    setShooting(shot.id);
    setNotice("");
    try {
      const planned = { ...shot, ...planFromShot(shot, assets, tone, gpu) };
      const context = shotContext(planned, assets, tone, toonflowPromptSettings(look));
      setShots((all) =>
        all.map((item) =>
          item.id === shot.id
            ? { ...item, ...planned, status: "SUBMITTING", error: undefined }
            : item,
        ),
      );
      const data = await post("/api/drama/video", {
        action: "create",
        provider: "comfy",
        videoModel: planned.videoModel,
        mode: context.mode,
        prompt: context.prompt,
        duration: planned.duration,
        firstFrame:
          context.mode === "i2v" ? await hostDramaImage(planned.firstFrame) : "",
        lastFrame:
          context.mode === "i2v" ? await hostDramaImage(planned.lastFrame) : "",
        references: await hostDramaImages(context.references),
        aspectRatio: ratio,
      });
      setShots((all) =>
        all.map((item) =>
          item.id === shot.id
            ? {
                ...item,
                ...planned,
                taskId: data.taskId,
                taskMode: context.mode,
                taskProvider: "comfy",
                taskVideoModel: data.videoModel ?? "h3",
                status: data.status,
                videoUrl: undefined,
              }
            : item,
        ),
      );
      setStep("shoot");
    } catch (error) {
      setShots((all) =>
        all.map((item) =>
          item.id === shot.id
            ? {
                ...item,
                status: "FAILED",
                error: error instanceof Error ? error.message : "出片失败",
              }
            : item,
        ),
      );
      setNotice(error instanceof Error ? error.message : "出片失败");
    } finally {
      setShooting("");
    }
  }

  async function shootAll() {
    for (const shot of shotsRef.current) {
      if (shot.videoUrl && shot.status === "COMPLETED") continue;
      await shootShot(shot);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <kbd>Toonflow · 短剧制作</kbd>
          <h1>{title}</h1>
          <p>从故事梗概到角色、场景与连续分镜，逐步生成视频镜头。</p>
        </div>
        <div className={styles.meta}>
          <div className={styles.gpu}>
            <i className={`${styles.dot} ${gpu.ready ? styles.dotOn : ""}`} />
            {gpu.ready ? "H3 就绪" : gpu.connected ? "GPU 已连，权重未齐" : "GPU 未连接"}
          </div>
          <Link className={styles.back} href="/video-studio">
            回短剧导演台
          </Link>
        </div>
      </header>

      <nav className={styles.steps}>
        {TOONFLOW_STEPS.map((item) => (
          <button
            key={item.id}
            className={`${styles.step} ${step === item.id ? styles.stepOn : ""}`}
            onClick={() => setStep(item.id)}
            type="button"
          >
            <strong>{item.label}</strong>
            <span>{item.hint}</span>
          </button>
        ))}
      </nav>

      <div className={styles.main}>
        <section className={styles.panel}>
          {step === "story" && (
            <>
              <div className={styles.row}>
                <label>
                  画面风格
                  <select value={look} onChange={(e) => setLook(e.target.value as ToonflowLook)}>
                    {TOONFLOW_LOOKS.map((item) => (
                      <option key={item} value={item}>
                        {item === "toon" ? "二维动画" : "写实电影"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  剧情风格
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as ScriptTone)}
                  >
                    {TONE_OPTIONS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                原著 / 故事
                <textarea value={story} onChange={(e) => setStory(e.target.value)} />
              </label>
              <div className={styles.actions}>
                <button className={styles.primary} disabled={writing || !story.trim()} onClick={writeScript} type="button">
                  {writing ? "编剧拆镜中…" : "生成剧本分镜"}
                </button>
                <button onClick={() => setStory(TOONFLOW_SAMPLE)} type="button">
                  载入样例
                </button>
              </div>
            </>
          )}

          {step === "script" && (
            <div className={styles.list}>
              {shots.length === 0 && <p className={styles.notice}>还没有分镜，先回原著生成剧本。</p>}
              {shots.map((shot, index) => (
                <article className={styles.shot} key={shot.id}>
                  <div className={styles.empty}>镜 {index + 1}</div>
                  <div>
                    <h3>{shot.title}</h3>
                    <p>{composeShotPrompt(shot, toonflowPromptSettings(look))}</p>
                  </div>
                  <small>{parseShotDuration(shot.duration)}s</small>
                </article>
              ))}
              <div className={styles.actions}>
                <button className={styles.primary} disabled={!shots.length} onClick={() => setStep("cast")} type="button">
                  去画角色
                </button>
              </div>
            </div>
          )}

          {step === "cast" && (
            <div className={styles.list}>
              {assets.length === 0 && <p className={styles.notice}>剧本里还没有角色或场景卡。</p>}
              {assets.map((card) => (
                <article className={styles.card} key={card.id}>
                  {card.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={card.title} className={styles.thumb} src={card.imageUrl} />
                  ) : (
                    <div className={styles.empty}>{card.kind === "scene" ? "场景" : "角色"}</div>
                  )}
                  <div>
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                  </div>
                  <button disabled={drawing === card.id} onClick={() => drawAsset(card)} type="button">
                    {drawing === card.id ? "绘制中" : card.imageUrl ? "重画" : "出设定图"}
                  </button>
                </article>
              ))}
              <div className={styles.actions}>
                <button className={styles.primary} disabled={!counts.images} onClick={() => setStep("shoot")} type="button">
                  去出片
                </button>
              </div>
            </div>
          )}

          {step === "shoot" && (
            <div className={styles.list}>
              <div className={styles.row}>
                <label>
                  画幅
                  <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                    <option value="9:16">9:16</option>
                    <option value="16:9">16:9</option>
                    <option value="1:1">1:1</option>
                  </select>
                </label>
              </div>
              {shots.map((shot, index) => (
                <article className={styles.shot} key={shot.id}>
                  {shot.videoUrl ? (
                    <video controls src={shot.videoUrl} />
                  ) : (
                    <div className={styles.empty}>镜 {index + 1}</div>
                  )}
                  <div>
                    <h3>{shot.title}</h3>
                    <p>{shot.prompt}</p>
                    <div className={styles.status}>
                      {shot.error || shot.status || "待生成"}
                      {shot.queuePosition ? ` · 排队 ${shot.queuePosition}` : ""}
                    </div>
                  </div>
                  <button
                    disabled={!gpu.ready || shooting === shot.id || isBusy(shot.status)}
                    onClick={() => shootShot(shot)}
                    type="button"
                  >
                    {shooting === shot.id || isBusy(shot.status) ? "生成中" : "生成"}
                  </button>
                </article>
              ))}
              <div className={styles.actions}>
                <button className={styles.primary} disabled={!gpu.ready || !shots.length || !!shooting} onClick={shootAll} type="button">
                  按序出片
                </button>
              </div>
            </div>
          )}
          <p className={styles.notice}>{notice}</p>
        </section>

        <aside className={styles.side}>
          <h2>这条线怎么走</h2>
          <ol>
            <li>按人物目标与情节变化，把故事拆成连续单镜头。</li>
            <li>设定图写清外观、服装和场景，再锁进分镜。</li>
            <li>有参考图走 H3 RI2V，没有就走 T2V。</li>
            <li>和短剧导演台共用 GPU，不要两边同时提交任务。</li>
          </ol>
          <p>
            对照桌面端：
            <a href="https://github.com/HBAI-Ltd/Toonflow-app" rel="noreferrer" target="_blank">
              Toonflow-app
            </a>
          </p>
        </aside>
      </div>
    </div>
  );
}
