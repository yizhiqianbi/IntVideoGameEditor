"use client";

import { useEffect, useRef, useState } from "react";
import { isDzmmCoverVideoUrl } from "@/lib/dzmm-cover-media";

/** Image covers stay on img. A video cover loops silently and never exposes playback controls. */
export function CoverVisual({
  src,
  alt,
  className,
  play = true,
  poster,
  loading,
  decoding,
  onImageError,
}: {
  src: string;
  alt: string;
  className?: string;
  play?: boolean;
  poster?: string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
  onImageError?: (image: HTMLImageElement) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const motion = play && isDzmmCoverVideoUrl(src) && !videoFailed;
  useEffect(() => { setVideoFailed(false); }, [src]);
  useEffect(() => {
    const node = video.current;
    if (!node || !motion) return;
    node.muted = true;
    let stopped = false;
    const visible = () => {
      const rect = node.getBoundingClientRect();
      const view = window.innerHeight || document.documentElement.clientHeight;
      return rect.width > 0 && rect.bottom > 24 && rect.top < view - 24;
    };
    const start = () => {
      if (stopped || document.visibilityState === "hidden" || !visible()) return;
      void node.play().catch(() => undefined);
    };
    start();
    node.addEventListener("loadeddata", start);
    const onScroll = () => { if (node.paused) start(); };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const timer = window.setInterval(() => { if (node.paused) start(); }, 1200);
    return () => {
      stopped = true;
      node.removeEventListener("loadeddata", start);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.clearInterval(timer);
    };
  }, [motion, src]);
  if (isDzmmCoverVideoUrl(src) && !videoFailed) {
    return (
      <video
        ref={video}
        className={className}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        autoPlay={motion}
        preload="metadata"
        disablePictureInPicture
        aria-hidden={alt ? undefined : true}
        aria-label={alt || undefined}
        onError={() => setVideoFailed(true)}
      />
    );
  }
  if (videoFailed && poster) {
    return <img className={className} src={poster} alt={alt} loading={loading} decoding={decoding} />;
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      onError={onImageError ? (event) => onImageError(event.currentTarget) : undefined}
    />
  );
}
