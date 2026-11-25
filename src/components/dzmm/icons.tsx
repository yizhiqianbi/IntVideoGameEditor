import { useId } from "react";
import type { CSSProperties } from "react";

export type IconName =
  | "users"
  | "chat"
  | "compass"
  | "user"
  | "search"
  | "sun"
  | "moon"
  | "heart"
  | "flame"
  | "shuffle"
  | "plus"
  | "sliders"
  | "chevron"
  | "chevronUp"
  | "close"
  | "send"
  | "back"
  | "download"
  | "fileText"
  | "braces"
  | "trash"
  | "upload"
  | "edit"
  | "refresh"
  | "book"
  | "trophy"
  | "grid"
  | "check"
  | "sparkles"
  | "more"
  | "stop"
  | "wallet"
  | "copy"
  | "volume"
  | "play"
  | "pause"
  | "quote"
  | "image"
  | "game"
  | "phone"
  | "video"
  | "lock"
  | "crown"
  | "bookmark"
  | "thumbUp"
  | "thumbDown"
  | "flag"
  | "undo"
  | "eye"
  | "eyeOff"
  | "help"
  | "mic"
  | "shield"
  | "zap"
  | "gift"
  | "star"
  | "gem";

const DUOTONE_FILL = { fill: "currentColor", fillOpacity: 0.16 } as const;
const DUOTONE_RICH = { fill: "currentColor", fillOpacity: 0.22 } as const;

const paths: Record<IconName, React.ReactNode> = {
  eye: (
    <>
      <path d="M2 12s3.6-6.8 10-6.8S22 12 22 12s-3.6 6.8-10 6.8S2 12 2 12Z" {...DUOTONE_FILL} />
      <circle cx="12" cy="12" r="3" {...DUOTONE_RICH} />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9.25" {...DUOTONE_FILL} />
      <path d="M9.4 9.3a2.7 2.7 0 0 1 5.1 1c0 1.8-2.5 2.2-2.5 3.6" />
      <circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  game: (
    <>
      <path d="M7.2 7h9.6a4 4 0 0 1 3.85 2.9l1.1 6.7a2.5 2.5 0 0 1-4.18 2.24L15 16.2H9l-2.57 2.64a2.5 2.5 0 0 1-4.18-2.24l1.1-6.7A4 4 0 0 1 7.2 7Z" {...DUOTONE_FILL} />
      <path d="M6.8 10.6v3.6M5 12.4h3.6" />
      <circle cx="16.4" cy="11.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="18.6" cy="13.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  phone: (
    <path
      d="M21.6 16.9v2.8a2 2 0 0 1-2.2 2 19.6 19.6 0 0 1-8.5-3 19.2 19.2 0 0 1-5.9-5.9 19.6 19.6 0 0 1-3-8.5 2 2 0 0 1 2-2.2h2.8a2 2 0 0 1 2 1.7c.12.95.36 1.88.72 2.76a2 2 0 0 1-.45 2.1L7.9 9.8a15.8 15.8 0 0 0 6.3 6.3l1.15-1.15a2 2 0 0 1 2.1-.45c.88.36 1.81.6 2.76.72a2 2 0 0 1 1.39 1.68Z"
      {...DUOTONE_FILL}
    />
  ),
  lock: (
    <>
      <rect x="5" y="10.8" width="14" height="10.2" rx="2.6" {...DUOTONE_FILL} />
      <path d="M8.2 10.8V7.4a3.8 3.8 0 0 1 7.6 0v3.4" />
      <circle cx="12" cy="15.8" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  video: (
    <>
      <rect x="2.8" y="5.2" width="12.6" height="13.6" rx="3.2" {...DUOTONE_FILL} />
      <path d="m15.4 10 5.8-3.6v11.2L15.4 14Z" {...DUOTONE_RICH} />
    </>
  ),
  volume: (
    <>
      <path d="m11 5.2-5.6 4H2.4v5.6h3l5.6 4V5.2Z" {...DUOTONE_FILL} />
      <path d="M15.2 8.4a5.4 5.4 0 0 1 0 7.2M18.3 5.5a9.4 9.4 0 0 1 0 13" />
    </>
  ),
  play: <path d="m7.5 4.4 12.2 7.6-12.2 7.6V4.4Z" {...DUOTONE_RICH} />,
  pause: (
    <>
      <rect x="6.2" y="4.4" width="3.8" height="15.2" rx="1.2" {...DUOTONE_RICH} />
      <rect x="14" y="4.4" width="3.8" height="15.2" rx="1.2" {...DUOTONE_RICH} />
    </>
  ),
  quote: (
    <>
      <path d="M5.5 3.2h13v17.6l-3.25-2-3.25 2-3.25-2-3.25 2V3.2Z" {...DUOTONE_FILL} />
      <path d="M9 8.5h6M9 12.5h4.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3.2" width="18" height="17.6" rx="3.4" {...DUOTONE_FILL} />
      <circle cx="8.6" cy="8.8" r="1.6" {...DUOTONE_RICH} />
      <path d="m20.8 15.6-4.8-4.8a1.4 1.4 0 0 0-2 0L5.2 19.6" />
    </>
  ),
  crown: (
    <>
      <path d="m3.2 7.2 4.2 4.3L12 4.6l4.6 6.9 4.2-4.3-1.8 10.6H5L3.2 7.2Z" {...DUOTONE_RICH} />
      <path d="M6 20.6h12" />
      <circle cx="12" cy="13.8" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  bookmark: <path d="M6 3.2h12a1.2 1.2 0 0 1 1.2 1.2v16.8L12 16.4l-7.2 4.8V4.4A1.2 1.2 0 0 1 6 3.2Z" {...DUOTONE_FILL} />,
  wallet: (
    <>
      <path d="M19.5 7.5V5.4a2 2 0 0 0-2-2H6a2.8 2.8 0 0 0 0 5.6h14a1.2 1.2 0 0 1 1.2 1.2v8.4a2.2 2.2 0 0 1-2.2 2.2H6.2A3.2 3.2 0 0 1 3 17.6V6.2" {...DUOTONE_FILL} />
      <rect x="15.2" y="12.2" width="6" height="4.8" rx="1.4" {...DUOTONE_RICH} />
      <circle cx="17.6" cy="14.6" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  users: (
    <>
      <circle cx="9.2" cy="7.4" r="3.6" {...DUOTONE_FILL} />
      <path d="M15.8 20.4v-1.6a4.2 4.2 0 0 0-4.2-4.2H6.8a4.2 4.2 0 0 0-4.2 4.2v1.6" {...DUOTONE_FILL} />
      <path d="M21.4 20.4v-1.5a3.8 3.8 0 0 0-2.8-3.65M15.8 3.9a3.6 3.6 0 0 1 0 7" />
    </>
  ),
  chat: (
    <>
      <path d="M7.9 19.8A8.8 8.8 0 1 0 4.2 16L2.4 21.4l5.5-1.6Z" {...DUOTONE_FILL} />
      <circle cx="8.6" cy="11.8" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11.8" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="11.8" r="0.95" fill="currentColor" stroke="none" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9.4" {...DUOTONE_FILL} />
      <path d="m16.1 7.9-2.15 6.05-6.05 2.15 2.15-6.05 6.05-2.15Z" {...DUOTONE_RICH} />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" {...DUOTONE_FILL} />
      <path d="M19.8 20.6a7.8 7.8 0 0 0-15.6 0" {...DUOTONE_FILL} />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="7.4" {...DUOTONE_FILL} />
      <path d="m20.8 20.8-4.4-4.4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" {...DUOTONE_RICH} />
      <path d="M12 2.4v2.1M12 19.5v2.1M2.4 12h2.1M19.5 12h2.1M5.2 5.2l1.5 1.5M17.3 17.3l1.5 1.5M5.2 18.8l1.5-1.5M17.3 6.7l1.5-1.5" />
    </>
  ),
  moon: <path d="M20.6 13.1A8.8 8.8 0 0 1 10.9 3.4a8.8 8.8 0 1 0 9.7 9.7Z" {...DUOTONE_RICH} />,
  heart: (
    <path
      d="M19.2 14.1c1.48-1.45 2.8-3.12 2.8-5.35a5.35 5.35 0 0 0-5.35-5.35c-1.8 0-3.15.68-4.65 2.2-1.5-1.52-2.85-2.2-4.65-2.2A5.35 5.35 0 0 0 2 8.75c0 2.23 1.32 3.9 2.8 5.35L12 21l7.2-6.9Z"
      {...DUOTONE_RICH}
    />
  ),
  flame: (
    <path
      d="M8.8 14.7a2.4 2.4 0 0 0 2.4-2.4c0-1.3-.45-1.95-.95-2.9-.98-2-.18-3.85 1.95-5.8.45 2.35 1.9 4.7 3.85 6.25 1.9 1.52 2.95 3.35 2.95 5.35a7 7 0 1 1-14 0c0-1.15.45-2.25 1.05-2.95a2.45 2.45 0 0 0 2.75 2.45Z"
      {...DUOTONE_RICH}
    />
  ),
  shuffle: (
    <>
      <path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h2.5c6 0 6-12 12-12H22M2 6h2.5c2.7 0 4.2 2.4 5.5 5M14 15c.7 1.4 1.5 3 3 3h5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sliders: (
    <>
      <path d="M4.5 21v-7M4.5 9.5V3M12 21v-9M12 7.5V3M19.5 21v-5M19.5 11.5V3" />
      <circle cx="4.5" cy="11.8" r="2.2" {...DUOTONE_RICH} />
      <circle cx="12" cy="9.8" r="2.2" {...DUOTONE_RICH} />
      <circle cx="19.5" cy="13.8" r="2.2" {...DUOTONE_RICH} />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  close: <path d="m18 6-12 12M6 6l12 12" />,
  send: (
    <>
      <path d="m21.6 2.4-6.9 19.2-3.9-8.5-8.4-3.8 19.2-6.9Z" {...DUOTONE_FILL} />
      <path d="M21.6 2.4 10.8 13.1" />
    </>
  ),
  back: <path d="m11.5 18.5-6.5-6.5 6.5-6.5M5.5 12h13.5" />,
  download: (
    <>
      <path d="M20.5 15.2v3.6a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2v-3.6" />
      <path d="M12 3.2v11.6m-4.8-4.6L12 15l4.8-4.8" />
    </>
  ),
  fileText: (
    <>
      <path d="M14 3.2H7.2a2.2 2.2 0 0 0-2.2 2.2v13.2a2.2 2.2 0 0 0 2.2 2.2h9.6a2.2 2.2 0 0 0 2.2-2.2V8.2L14 3.2Z" {...DUOTONE_FILL} />
      <path d="M14 3.2v5h5" />
      <path d="M8.5 13h7M8.5 16.6h4.6" />
    </>
  ),
  braces: (
    <>
      <path d="M8 4H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1" />
      <path d="M16 20h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V6a2 2 0 0 0-2-2h-1" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
      <path d="M6.8 7l1 13.2a1.4 1.4 0 0 0 1.4 1.3h5.6a1.4 1.4 0 0 0 1.4-1.3L17.2 7" {...DUOTONE_FILL} />
      <path d="M10.2 11v5.8M13.8 11v5.8" />
    </>
  ),
  upload: (
    <>
      <path d="M20.5 15.2v3.6a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2v-3.6" />
      <path d="M12 15.6V3.6m-4.8 4.8L12 3.6l4.8 4.8" />
    </>
  ),
  edit: (
    <>
      <path d="m16.2 3.2 4.6 4.6-11.6 11.6-5.4 1.1 1.1-5.4L16.2 3.2Z" {...DUOTONE_FILL} />
      <path d="m14 5.4 4.6 4.6" />
    </>
  ),
  refresh: (
    <>
      <path d="M3.2 12a8.8 8.8 0 0 1 15.1-6.1L20.8 8.2M20.8 3.4v4.8H16M20.8 12a8.8 8.8 0 0 1-15.1 6.1L3.2 15.8M3.2 20.6v-4.8H8" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.8v14.2M3.2 3.6h4.2a4.6 4.6 0 0 1 4.6 3.6 4.6 4.6 0 0 1 4.6-3.6h4.2v15.6h-4.2a4.8 4.8 0 0 0-4.6 2 4.8 4.8 0 0 0-4.6-2H3.2V3.6Z" {...DUOTONE_FILL} />
    </>
  ),
  trophy: (
    <>
      <path d="M6.2 9H4.4a2.2 2.2 0 0 1 0-4.4h1.8M17.8 9h1.8a2.2 2.2 0 0 0 0-4.4h-1.8" />
      <path d="M6.2 2.8h11.6v6.4a5.8 5.8 0 0 1-11.6 0V2.8Z" {...DUOTONE_RICH} />
      <path d="M12 15v5.6M8.2 21.2h7.6" />
    </>
  ),
  grid: (
    <>
      <rect x="3.2" y="3.2" width="7.2" height="7.2" rx="2.1" {...DUOTONE_RICH} />
      <rect x="13.6" y="3.2" width="7.2" height="7.2" rx="2.1" {...DUOTONE_FILL} />
      <rect x="3.2" y="13.6" width="7.2" height="7.2" rx="2.1" {...DUOTONE_FILL} />
      <rect x="13.6" y="13.6" width="7.2" height="7.2" rx="2.1" {...DUOTONE_RICH} />
    </>
  ),
  check: <path d="m5 12.4 4.2 4.2L19.2 6.4" />,
  sparkles: (
    <>
      <path d="m11.5 2.8 2.3 6.2 6.2 2.3-6.2 2.3-2.3 6.2-2.3-6.2L3 11.3l6.2-2.3 2.3-6.2Z" {...DUOTONE_RICH} />
      <path d="M19.5 2.5v3.8M17.6 4.4h3.8" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="8.2" y="8.2" width="12.6" height="12.6" rx="2.4" {...DUOTONE_FILL} />
      <path d="M15.8 8.2V4.6a1.4 1.4 0 0 0-1.4-1.4H4.6a1.4 1.4 0 0 0-1.4 1.4v9.8a1.4 1.4 0 0 0 1.4 1.4h3.6" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.4" {...DUOTONE_RICH} />,
  thumbUp: (
    <>
      <path d="M7 10v11.5" />
      <path d="M15 5.9 14 10h5.7a2 2 0 0 1 1.9 2.55l-2.25 7.6A2 2 0 0 1 17.4 21.5H4.2a2 2 0 0 1-2-2v-7.5a2 2 0 0 1 2-2h2.7a2 2 0 0 0 1.78-1.1L12 2.2a3.1 3.1 0 0 1 3 3.7Z" {...DUOTONE_FILL} />
    </>
  ),
  thumbDown: (
    <>
      <path d="M17 14V2.5" />
      <path d="M9 18.1 10 14H4.3a2 2 0 0 1-1.9-2.55l2.25-7.6A2 2 0 0 1 6.6 2.5h13.2a2 2 0 0 1 2 2V12a2 2 0 0 1-2 2h-2.7a2 2 0 0 0-1.78 1.1L12 21.8a3.1 3.1 0 0 1-3-3.7Z" {...DUOTONE_FILL} />
    </>
  ),
  flag: (
    <>
      <path d="M4.5 14.8s1.2-1 4-1 4.8 1.8 7.8 1.8 3.7-1 3.7-1V3.6s-1.2 1-3.7 1-5-1.8-7.8-1.8-4 1-4 1v11Z" {...DUOTONE_FILL} />
      <path d="M4.5 21.5v-6.7" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4.2 9.2 9 4.4" />
      <path d="M4.6 9.2h10a5.4 5.4 0 0 1 5.4 5.4 5.4 5.4 0 0 1-5.4 5.4H11" />
    </>
  ),
  mic: (
    <>
      <rect x="8.8" y="2.8" width="6.4" height="10.4" rx="3.2" {...DUOTONE_FILL} />
      <path d="M18.8 11.2a6.8 6.8 0 0 1-13.6 0M12 18v3.2M8.4 21.2h7.2" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="m2.4 2.4 19.2 19.2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.8 4.4 5.8v5.8c0 4.9 3.25 8.8 7.6 10 4.35-1.2 7.6-5.1 7.6-10V5.8L12 2.8Z" {...DUOTONE_FILL} />
      <path d="m9 12.1 2.1 2.1 4.2-4.4" />
    </>
  ),
  zap: (
    <path d="M13.2 2.6 4.4 13.2h6.4l-1.6 8.2 9.4-10.8h-6.4l1-8Z" {...DUOTONE_RICH} />
  ),
  gift: (
    <>
      <rect x="3.2" y="8.4" width="17.6" height="4.2" rx="1.2" {...DUOTONE_RICH} />
      <path d="M5 12.6h14v7a1.8 1.8 0 0 1-1.8 1.8H6.8A1.8 1.8 0 0 1 5 19.6v-7Z" {...DUOTONE_FILL} />
      <path d="M12 8.4v13M12 8.4H8.6a2.3 2.3 0 1 1 0-4.6C10.8 3.8 12 8.4 12 8.4Zm0 0h3.4a2.3 2.3 0 1 0 0-4.6C13.2 3.8 12 8.4 12 8.4Z" />
    </>
  ),
  star: (
    <path
      d="m12 3 2.75 5.55 6.12.9-4.43 4.32 1.04 6.1L12 17l-5.48 2.87 1.04-6.1L3.13 9.45l6.12-.9L12 3Z"
      {...DUOTONE_RICH}
    />
  ),
  gem: (
    <>
      <path d="M6.4 3.6h11.2L21.4 9 12 20.6 2.6 9l3.8-5.4Z" {...DUOTONE_FILL} />
      <path d="M2.6 9h18.8M8.8 3.6 7.4 9 12 20.6 16.6 9l-1.4-5.4" />
    </>
  ),
};

/** Glossy 3D gold dollar coin used wherever Coins are shown. */
export function CoinIcon({ size = 16, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  const raw = useId();
  const id = raw.replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} style={style} aria-hidden="true" data-icon="coin-3d">
      <defs>
        <radialGradient id={`coin-face-${id}`} cx="34%" cy="24%" r="82%">
          <stop offset="0%" stopColor="#fff8da" />
          <stop offset="26%" stopColor="#ffe079" />
          <stop offset="56%" stopColor="#f8b62f" />
          <stop offset="82%" stopColor="#d8860f" />
          <stop offset="100%" stopColor="#a95f05" />
        </radialGradient>
        <linearGradient id={`coin-rim-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffeaa8" />
          <stop offset="48%" stopColor="#d5951d" />
          <stop offset="100%" stopColor="#7d4b03" />
        </linearGradient>
        <linearGradient id={`coin-dollar-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8a5205" />
          <stop offset="55%" stopColor="#b9720c" />
          <stop offset="100%" stopColor="#e0a327" />
        </linearGradient>
        <linearGradient id={`coin-gloss-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity=".9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="33" r="30" fill={`url(#coin-rim-${id})`} />
      <circle cx="32" cy="30" r="27.5" fill={`url(#coin-face-${id})`} />
      <circle cx="32" cy="30" r="23.4" fill="none" stroke="#a86405" strokeOpacity=".5" strokeWidth="2.1" />
      <circle cx="32" cy="30" r="21.6" fill="none" stroke="#fff4c8" strokeOpacity=".45" strokeWidth="1.2" />
      <ellipse cx="24" cy="15.5" rx="15" ry="6.4" fill={`url(#coin-gloss-${id})`} opacity=".7" transform="rotate(-16 24 15.5)" />
      <text x="32" y="31.5" textAnchor="middle" dominantBaseline="central" fontSize="27" fontWeight="800"
        fontFamily="Georgia, 'Times New Roman', 'Songti SC', serif" fill={`url(#coin-dollar-${id})`}
        stroke="#7d4a04" strokeWidth=".5" paintOrder="stroke">$</text>
      <path d="M32 8.8v5.4" stroke="#fff8da" strokeOpacity=".75" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export default function Icon({
  name,
  size = 18,
  style,
  className,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      aria-hidden="true"
      data-icon={name}
      style={style}
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
