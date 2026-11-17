"use client";

import { useEffect, useRef } from "react";
import { isDzmmCoverVideoUrl } from "@/lib/dzmm-cover-media";

/** Image covers stay on img. A video cover loops silently and never exposes playback controls. */
export function CoverVisual({
  src,
  alt,
  className,
  play = true,
  loading,
  decoding,
  onImageError,
}: {
  src: string;
  alt: string;
  className?: string;
  play?: boolean;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
  onImageError?: (image: HTMLImageElement) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const motion = play && isDzmmCoverVideoUrl(src);
  useEffect(() => {
    const node = video.current;
    if (!node || !motion) return;
    node.muted = true;
    const start = () => { void node.play().catch(() => undefined); };
    if (node.readyState >= 2) start();
    else node.addEventListener("loadeddata", start, { once: true });
    return () => node.removeEventListener("loadeddata", start);
  }, [motion, src]);
  if (isDzmmCoverVideoUrl(src)) {
    return (
      <video
        ref={video}
        className={className}
        src={src}
        muted
        loop
        playsInline
        autoPlay={motion}
        preload="metadata"
        disablePictureInPicture
        aria-hidden={alt ? undefined : true}
        aria-label={alt || undefined}
      />
    );
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
