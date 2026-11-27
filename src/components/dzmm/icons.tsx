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

export type BrandIconName =
  | "coin"
  | "vipCrown"
  | "createRole"
  | "templateSquare"
  | "novelBook"
  | "companionHeart"
  | "scenarioStage"
  | "videoReel"
  | "chatBubble"
  | "discoverCompass"
  | "taskTrophy"
  | "checkinSun"
  | "inviteGift"
  | "walletCard";

const DUOTONE_FILL = { fill: "currentColor", fillOpacity: 0.14 } as const;
const DUOTONE_RICH = { fill: "currentColor", fillOpacity: 0.24 } as const;

const paths: Record<IconName, React.ReactNode> = {
  eye: (
    <>
      <path d="M2.2 12s3.5-6.6 9.8-6.6S21.8 12 21.8 12s-3.5 6.6-9.8 6.6S2.2 12 2.2 12Z" {...DUOTONE_FILL} />
      <circle cx="12" cy="12" r="3.1" {...DUOTONE_RICH} />
      <circle cx="13" cy="11" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9.3" {...DUOTONE_FILL} />
      <path d="M9.4 9.3a2.7 2.7 0 0 1 5.1 1c0 1.8-2.5 2.2-2.5 3.6" />
      <circle cx="12" cy="17.2" r="0.85" fill="currentColor" stroke="none" />
    </>
  ),
  game: (
    <>
      <path d="M7.2 6.8h9.6a4.1 4.1 0 0 1 3.9 3l1.05 6.6a2.5 2.5 0 0 1-4.18 2.24L15 16.2H9l-2.57 2.44a2.5 2.5 0 0 1-4.18-2.24L3.3 9.8a4.1 4.1 0 0 1 3.9-3Z" {...DUOTONE_FILL} />
      <path d="M7 10.4v3.6M5.2 12.2h3.6" />
      <circle cx="16.2" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="18.6" cy="13.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  phone: (
    <path
      d="M21.4 16.9v2.7a2 2 0 0 1-2.18 2 19.4 19.4 0 0 1-8.42-3 19 19 0 0 1-5.8-5.8 19.4 19.4 0 0 1-3-8.42 2 2 0 0 1 2-2.18h2.7a2 2 0 0 1 1.98 1.7c.13.94.37 1.86.72 2.74a2 2 0 0 1-.45 2.1L7.85 9.85a15.6 15.6 0 0 0 6.3 6.3l1.1-1.1a2 2 0 0 1 2.1-.45c.88.35 1.8.59 2.74.72a2 2 0 0 1 1.31 1.58Z"
      {...DUOTONE_FILL}
    />
  ),
  lock: (
    <>
      <rect x="4.8" y="10.6" width="14.4" height="10.4" rx="3" {...DUOTONE_FILL} />
      <path d="M8.2 10.6V7.5a3.8 3.8 0 0 1 7.6 0v3.1" />
      <circle cx="12" cy="15.3" r="1.25" fill="currentColor" stroke="none" />
      <path d="M12 16.5v1.6" />
    </>
  ),
  video: (
    <>
      <rect x="2.6" y="4.8" width="13.2" height="14.4" rx="3.4" {...DUOTONE_FILL} />
      <path d="m15.8 9.6 5.4-3.1a.9.9 0 0 1 1.35.78v9.44a.9.9 0 0 1-1.35.78l-5.4-3.1V9.6Z" {...DUOTONE_RICH} />
      <path d="m7.8 9.6 3.8 2.4-3.8 2.4V9.6Z" fill="currentColor" stroke="none" />
    </>
  ),
  volume: (
    <>
      <path d="m11 5.2-5.4 4H2.6v5.6h3l5.4 4V5.2Z" {...DUOTONE_FILL} />
      <path d="M15.2 8.4a5.4 5.4 0 0 1 0 7.2M18.3 5.5a9.4 9.4 0 0 1 0 13" />
    </>
  ),
  play: <path d="M7.6 5.2a1.1 1.1 0 0 1 1.68-.94l10.2 6.8a1.1 1.1 0 0 1 0 1.88l-10.2 6.8a1.1 1.1 0 0 1-1.68-.94V5.2Z" {...DUOTONE_RICH} />,
  pause: (
    <>
      <rect x="6" y="4.4" width="4.2" height="15.2" rx="1.6" {...DUOTONE_RICH} />
      <rect x="13.8" y="4.4" width="4.2" height="15.2" rx="1.6" {...DUOTONE_RICH} />
    </>
  ),
  quote: (
    <>
      <path d="M5.4 3.2h13.2v17.6l-3.3-2-3.3 2-3.3-2-3.3 2V3.2Z" {...DUOTONE_FILL} />
      <path d="M8.8 8.4h6.4M8.8 12.4h4.4" />
    </>
  ),
  image: (
    <>
      <rect x="2.8" y="3.2" width="18.4" height="17.6" rx="3.8" {...DUOTONE_FILL} />
      <circle cx="8.6" cy="8.8" r="1.8" {...DUOTONE_RICH} />
      <path d="m21 15.8-4.7-4.7a1.5 1.5 0 0 0-2.1 0L5.2 20" />
    </>
  ),
  crown: (
    <>
      <path d="m2.8 7.8 4.4 4.1L12 4.2l4.8 7.7 4.4-4.1-1.9 10.2a1.6 1.6 0 0 1-1.57 1.3H6.27a1.6 1.6 0 0 1-1.57-1.3L2.8 7.8Z" {...DUOTONE_RICH} />
      <path d="M5.8 21h12.4" />
      <circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  bookmark: <path d="M6 3.2h12a1.6 1.6 0 0 1 1.6 1.6v16.4L12 16.4l-7.6 4.8V4.8A1.6 1.6 0 0 1 6 3.2Z" {...DUOTONE_FILL} />,
  wallet: (
    <>
      <path d="M19.4 7.4V5.6a2 2 0 0 0-2-2H6a2.8 2.8 0 0 0 0 5.6h13.8a1.6 1.6 0 0 1 1.6 1.6v7.8a2.4 2.4 0 0 1-2.4 2.4H6.2A3.2 3.2 0 0 1 3 17.8V6.4" {...DUOTONE_FILL} />
      <rect x="14.8" y="12.2" width="6.6" height="4.8" rx="1.6" {...DUOTONE_RICH} />
      <circle cx="17.6" cy="14.6" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  users: (
    <>
      <circle cx="9.2" cy="7.4" r="3.6" {...DUOTONE_RICH} />
      <path d="M15.8 20.4v-1.5a4.3 4.3 0 0 0-4.3-4.3H6.9a4.3 4.3 0 0 0-4.3 4.3v1.5" {...DUOTONE_FILL} />
      <circle cx="16.4" cy="8.4" r="2.7" />
      <path d="M21.4 20.4v-1.2a3.6 3.6 0 0 0-2.6-3.45" />
    </>
  ),
  chat: (
    <>
      <path d="M7.8 19.6A8.8 8.8 0 1 0 4.2 15.8L2.5 21.3l5.3-1.7Z" {...DUOTONE_FILL} />
      <path d="M8.5 11.4h7M8.5 14.4h4.2" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9.4" {...DUOTONE_FILL} />
      <path d="m16.2 7.8-2.2 6.2-6.2 2.2 2.2-6.2 6.2-2.2Z" {...DUOTONE_RICH} />
      <circle cx="12" cy="12" r="0.95" fill="currentColor" stroke="none" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.9" {...DUOTONE_RICH} />
      <path d="M19.8 20.6a7.8 7.8 0 0 0-15.6 0" {...DUOTONE_FILL} />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="7.4" {...DUOTONE_FILL} />
      <path d="m20.8 20.8-4.5-4.5" />
      <path d="M8.2 8.2a3.8 3.8 0 0 1 4.6-.6" strokeOpacity="0.55" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.3" {...DUOTONE_RICH} />
      <path d="M12 2.4v2.1M12 19.5v2.1M2.4 12h2.1M19.5 12h2.1M5.2 5.2l1.5 1.5M17.3 17.3l1.5 1.5M5.2 18.8l1.5-1.5M17.3 6.7l1.5-1.5" />
    </>
  ),
  moon: (
    <>
      <path d="M20.6 13.1A8.8 8.8 0 0 1 10.9 3.4a8.8 8.8 0 1 0 9.7 9.7Z" {...DUOTONE_RICH} />
      <path d="M17.5 4.2v2.4M16.3 5.4h2.4" />
    </>
  ),
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
    <path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h2.5c6 0 6-12 12-12H22M2 6h2.5c2.7 0 4.2 2.4 5.5 5M14 15c.7 1.4 1.5 3 3 3h5" />
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
      <path d="m21.4 2.6-6.7 18.8-3.8-8.3-8.3-3.8 18.8-6.7Z" {...DUOTONE_RICH} />
      <path d="M21.4 2.6 10.9 13.1" />
    </>
  ),
  back: <path d="m11.5 18.5-6.5-6.5 6.5-6.5M5.5 12h13.5" />,
  download: (
    <>
      <path d="M20.4 15.2v3.4a2.4 2.4 0 0 1-2.4 2.4H6a2.4 2.4 0 0 1-2.4-2.4v-3.4" />
      <path d="M12 3.2v11.6m-4.6-4.4L12 15l4.6-4.6" />
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
      <path d="M20.4 15.2v3.4a2.4 2.4 0 0 1-2.4 2.4H6a2.4 2.4 0 0 1-2.4-2.4v-3.4" />
      <path d="M12 15.6V3.6m-4.6 4.6L12 3.6l4.6 4.6" />
    </>
  ),
  edit: (
    <>
      <path d="m15.8 3.2 5 5-11.8 11.8-5.4 1.1 1.1-5.4L15.8 3.2Z" {...DUOTONE_FILL} />
      <path d="m13.6 5.4 5 5" />
      <path d="M19.2 16.5v3.4M17.5 18.2h3.4" />
    </>
  ),
  refresh: (
    <path d="M3.2 12a8.8 8.8 0 0 1 15.1-6.1L20.8 8.2M20.8 3.4v4.8H16M20.8 12a8.8 8.8 0 0 1-15.1 6.1L3.2 15.8M3.2 20.6v-4.8H8" />
  ),
  book: (
    <>
      <path d="M12 6.8v14.2M3.2 3.8h4.2a4.6 4.6 0 0 1 4.6 3.5 4.6 4.6 0 0 1 4.6-3.5h4.2v15.4h-4.2a4.8 4.8 0 0 0-4.6 2 4.8 4.8 0 0 0-4.6-2H3.2V3.8Z" {...DUOTONE_FILL} />
      <path d="M6.2 8.2h2.6M15.2 8.2h2.6" strokeOpacity="0.65" />
    </>
  ),
  trophy: (
    <>
      <path d="M6.2 9H4.4a2.2 2.2 0 0 1 0-4.4h1.8M17.8 9h1.8a2.2 2.2 0 0 0 0-4.4h-1.8" />
      <path d="M6.2 2.8h11.6v6.4a5.8 5.8 0 0 1-11.6 0V2.8Z" {...DUOTONE_RICH} />
      <path d="M12 15v5.6M8.2 21.2h7.6" />
      <circle cx="12" cy="8.2" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  grid: (
    <>
      <rect x="3.2" y="3.2" width="7.2" height="7.2" rx="2.3" {...DUOTONE_RICH} />
      <rect x="13.6" y="3.2" width="7.2" height="7.2" rx="2.3" {...DUOTONE_FILL} />
      <rect x="3.2" y="13.6" width="7.2" height="7.2" rx="2.3" {...DUOTONE_FILL} />
      <rect x="13.6" y="13.6" width="7.2" height="7.2" rx="2.3" {...DUOTONE_RICH} />
    </>
  ),
  check: <path d="m5 12.4 4.2 4.2L19.2 6.4" />,
  sparkles: (
    <>
      <path d="m11.2 2.6 2.25 6.15 6.15 2.25-6.15 2.25-2.25 6.15-2.25-6.15L2.8 11l6.15-2.25L11.2 2.6Z" {...DUOTONE_RICH} />
      <path d="M19.2 2.6v3.8M17.3 4.5h3.8M19.4 16.8v2.8M18 18.2h2.8" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="8.2" y="8.2" width="12.6" height="12.6" rx="2.4" {...DUOTONE_FILL} />
      <path d="M15.8 8.2V4.6a1.4 1.4 0 0 0-1.4-1.4H4.6a1.4 1.4 0 0 0-1.4 1.4v9.8a1.4 1.4 0 0 0 1.4 1.4h3.6" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.6" {...DUOTONE_RICH} />,
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
      <rect x="8.8" y="2.8" width="6.4" height="10.4" rx="3.2" {...DUOTONE_RICH} />
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
  zap: <path d="M13.2 2.6 4.4 13.2h6.4l-1.6 8.2 9.4-10.8h-6.4l1-8Z" {...DUOTONE_RICH} />,
  gift: (
    <>
      <rect x="3.2" y="8.4" width="17.6" height="4.2" rx="1.4" {...DUOTONE_RICH} />
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
      <path d="M6.4 3.6h11.2L21.4 9 12 20.6 2.6 9l3.8-5.4Z" {...DUOTONE_RICH} />
      <path d="M2.6 9h18.8M8.8 3.6 7.4 9 12 20.6 16.6 9l-1.4-5.4" />
    </>
  ),
};

/** Sculpted 3D Xumeng Gold Coin (金币) with milled bezel and radiant 4-point star emblem. */
export function CoinIcon({ size = 16, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  const raw = useId();
  const id = raw.replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} style={style} aria-hidden="true" data-icon="coin-3d">
      <defs>
        <radialGradient id={`coin-face-${id}`} cx="32%" cy="24%" r="82%">
          <stop offset="0%" stopColor="#fffbe4" />
          <stop offset="28%" stopColor="#ffe484" />
          <stop offset="58%" stopColor="#f5b433" />
          <stop offset="84%" stopColor="#d68112" />
          <stop offset="100%" stopColor="#9c5504" />
        </radialGradient>
        <linearGradient id={`coin-rim-${id}`} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#fff0b8" />
          <stop offset="48%" stopColor="#d9941d" />
          <stop offset="100%" stopColor="#774203" />
        </linearGradient>
        <linearGradient id={`coin-star-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c4704" />
          <stop offset="55%" stopColor="#b86c08" />
          <stop offset="100%" stopColor="#ebb13a" />
        </linearGradient>
        <linearGradient id={`coin-gloss-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity=".88" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="33.5" r="29.5" fill={`url(#coin-rim-${id})`} />
      <circle cx="32" cy="30" r="27.2" fill={`url(#coin-face-${id})`} />
      <circle cx="32" cy="30" r="22.8" fill="none" stroke="#9e5a04" strokeOpacity=".52" strokeWidth="2.2" />
      <circle cx="32" cy="30" r="20.6" fill="none" stroke="#fff6cf" strokeOpacity=".55" strokeWidth="1.2" strokeDasharray="3.2 3.2" />
      <ellipse cx="24" cy="15.5" rx="15" ry="6.2" fill={`url(#coin-gloss-${id})`} opacity=".72" transform="rotate(-16 24 15.5)" />
      {/* Sculpted 4-point starlight emblem + inner diamond highlight */}
      <path
        d="M32 14.5 36.1 25.9 47.5 30 36.1 34.1 32 45.5 27.9 34.1 16.5 30 27.9 25.9Z"
        fill={`url(#coin-star-${id})`}
        stroke="#784203"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M32 21.8 34.2 27.8 40.2 30 34.2 32.2 32 38.2 29.8 32.2 23.8 30 29.8 27.8Z"
        fill="#fff6d0"
        fillOpacity=".75"
      />
    </svg>
  );
}

/**
 * Bespoke multi-stop gradient SVG brand icons for Xumeng hero surfaces,
 * Creator Studio cards, VIP badges, and featured navigation accents.
 */
export function BrandIcon({
  name,
  size = 24,
  className,
  style,
}: {
  name: BrandIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const raw = useId();
  const id = raw.replace(/[^a-zA-Z0-9_-]/g, "");
  if (name === "coin") return <CoinIcon size={size} className={className} style={style} />;

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style} aria-hidden="true" data-brand-icon={name}>
      <defs>
        <linearGradient id={`bg-rose-${id}`} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff88b1" />
          <stop offset="52%" stopColor="#e44b7d" />
          <stop offset="100%" stopColor="#9d2050" />
        </linearGradient>
        <linearGradient id={`bg-gold-${id}`} x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff4c4" />
          <stop offset="45%" stopColor="#f5c458" />
          <stop offset="100%" stopColor="#b86b11" />
        </linearGradient>
        <linearGradient id={`bg-violet-${id}`} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#d4b5ff" />
          <stop offset="52%" stopColor="#9461f2" />
          <stop offset="100%" stopColor="#5628b0" />
        </linearGradient>
        <linearGradient id={`bg-teal-${id}`} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8ff2e8" />
          <stop offset="52%" stopColor="#2ab8b8" />
          <stop offset="100%" stopColor="#146478" />
        </linearGradient>
        <linearGradient id={`bg-glass-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.62" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.06" />
        </linearGradient>
      </defs>

      {name === "vipCrown" && (
        <>
          <path d="M7 17.5 15.2 24 24 10.5 32.8 24 41 17.5 37.6 35.5a3 3 0 0 1-2.95 2.5H13.35a3 3 0 0 1-2.95-2.5L7 17.5Z" fill={`url(#bg-gold-${id})`} />
          <path d="M12.5 38h23a2 2 0 0 1 0 4h-23a2 2 0 0 1 0-4Z" fill={`url(#bg-gold-${id})`} opacity=".88" />
          <path d="M24 10.5 29.8 22.8 24 26.5 18.2 22.8 24 10.5Z" fill={`url(#bg-glass-${id})`} />
          <path d="M24 24.5 27.6 29.5 24 34.2 20.4 29.5 24 24.5Z" fill={`url(#bg-rose-${id})`} />
          <circle cx="24" cy="9.5" r="2.6" fill="#fff7d6" />
          <circle cx="7" cy="16.5" r="2.2" fill="#ffe699" />
          <circle cx="41" cy="16.5" r="2.2" fill="#ffe699" />
        </>
      )}

      {name === "createRole" && (
        <>
          <rect x="6" y="6" width="36" height="36" rx="12" fill={`url(#bg-gold-${id})`} fillOpacity=".18" stroke={`url(#bg-gold-${id})`} strokeWidth="2" />
          <circle cx="22.5" cy="19.5" r="6.8" fill={`url(#bg-gold-${id})`} />
          <path d="M11.8 36.2c1.2-5.6 5.4-8.8 10.7-8.8 5.3 0 9.5 3.2 10.7 8.8" fill={`url(#bg-gold-${id})`} fillOpacity=".82" />
          <path d="M35.5 10.5 37.4 15.6 42.5 17.5 37.4 19.4 35.5 24.5 33.6 19.4 28.5 17.5 33.6 15.6Z" fill={`url(#bg-rose-${id})`} />
          <circle cx="20.2" cy="17.2" r="2" fill="#ffffff" fillOpacity=".45" />
        </>
      )}

      {name === "templateSquare" && (
        <>
          <rect x="7" y="7" width="15" height="15" rx="4.5" fill={`url(#bg-rose-${id})`} />
          <rect x="26" y="7" width="15" height="15" rx="4.5" fill={`url(#bg-violet-${id})`} />
          <rect x="7" y="26" width="15" height="15" rx="4.5" fill={`url(#bg-violet-${id})`} fillOpacity=".72" />
          <rect x="26" y="26" width="15" height="15" rx="4.5" fill={`url(#bg-gold-${id})`} />
          <path d="M24 14 26.7 21.3 34 24 26.7 26.7 24 34 21.3 26.7 14 24 21.3 21.3Z" fill="#ffffff" />
        </>
      )}

      {name === "novelBook" && (
        <>
          <path d="M24 13.5c-3.6-3.2-9-4.5-15.5-4.5a2 2 0 0 0-2 2v23.5a2 2 0 0 0 2 2c6.2 0 11.4 1.3 15.5 4.2 4.1-2.9 9.3-4.2 15.5-4.2a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2c-6.5 0-11.9 1.3-15.5 4.5Z" fill={`url(#bg-violet-${id})`} />
          <path d="M24 13.5v27.2" stroke="#ffffff" strokeOpacity=".42" strokeWidth="2" />
          <path d="M12 18h7.5M12 23.5h6.5M28.5 18H36M28.5 23.5H35" stroke="#ffffff" strokeOpacity=".78" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M35.5 6.5 37 10.5 41 12 37 13.5 35.5 17.5 34 13.5 30 12 34 10.5Z" fill={`url(#bg-gold-${id})`} />
        </>
      )}

      {name === "companionHeart" && (
        <>
          <path d="M24 41.2 9.8 27.6C6.4 24.3 5 20.8 5 17.1 5 11.6 9.3 7.5 14.7 7.5c3.4 0 6.5 1.7 9.3 4.8 2.8-3.1 5.9-4.8 9.3-4.8 5.4 0 9.7 4.1 9.7 9.6 0 3.7-1.4 7.2-4.8 10.5L24 41.2Z" fill={`url(#bg-rose-${id})`} />
          <path d="M14.2 12.2c-2.5.4-4.6 2.5-5 5.1" stroke="#ffffff" strokeOpacity=".68" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M31.5 18.2 33 22 36.8 23.5 33 25 31.5 28.8 30 25 26.2 23.5 30 22Z" fill="#fff3d1" />
        </>
      )}

      {name === "scenarioStage" && (
        <>
          <circle cx="24" cy="24" r="18" fill={`url(#bg-teal-${id})`} fillOpacity=".2" stroke={`url(#bg-teal-${id})`} strokeWidth="2.2" />
          <circle cx="18.5" cy="20" r="5" fill={`url(#bg-teal-${id})`} />
          <circle cx="30" cy="18.5" r="4.2" fill={`url(#bg-gold-${id})`} />
          <path d="M10.5 34.5c1.1-4.3 4.1-6.7 8-6.7s6.9 2.4 8 6.7" fill={`url(#bg-teal-${id})`} />
          <path d="M24.8 33.8c.9-3.5 3.3-5.4 6.4-5.4 2.7 0 4.9 1.4 6 4.1" fill={`url(#bg-gold-${id})`} fillOpacity=".88" />
          <path d="M24 7.5 25.4 11.2 29.1 12.6 25.4 14 24 17.7 22.6 14 18.9 12.6 22.6 11.2Z" fill="#ffffff" />
        </>
      )}

      {name === "videoReel" && (
        <>
          <rect x="5" y="9" width="38" height="30" rx="8.5" fill={`url(#bg-rose-${id})`} />
          <rect x="5" y="9" width="38" height="12" rx="8.5" fill={`url(#bg-glass-${id})`} opacity=".4" />
          <path d="M20.2 17.6a1.6 1.6 0 0 1 2.46-1.35l10.2 6.4a1.6 1.6 0 0 1 0 2.7l-10.2 6.4a1.6 1.6 0 0 1-2.46-1.35V17.6Z" fill="#ffffff" />
        </>
      )}

      {name === "chatBubble" && (
        <>
          <path d="M24 7C14.1 7 6 13.7 6 22c0 4 1.9 7.6 5 10.3L8.2 40.2l9.2-3.4c2.1.6 4.3.9 6.6.9 9.9 0 18-6.7 18-15s-8.1-15.7-18-15.7Z" fill={`url(#bg-rose-${id})`} />
          <circle cx="17.5" cy="22.5" r="2.3" fill="#ffffff" />
          <circle cx="24" cy="22.5" r="2.3" fill="#ffffff" fillOpacity=".85" />
          <circle cx="30.5" cy="22.5" r="2.3" fill="#ffe79e" />
        </>
      )}

      {name === "discoverCompass" && (
        <>
          <circle cx="24" cy="24" r="18" fill={`url(#bg-violet-${id})`} />
          <circle cx="24" cy="24" r="14.5" fill="none" stroke="#ffffff" strokeOpacity=".22" strokeWidth="1.5" />
          <path d="M32.4 15.6 27.6 27.6 15.6 32.4 20.4 20.4 32.4 15.6Z" fill={`url(#bg-gold-${id})`} />
          <circle cx="24" cy="24" r="2.2" fill="#ffffff" />
        </>
      )}

      {name === "taskTrophy" && (
        <>
          <path d="M13 13H9a4.5 4.5 0 0 0 0 9h4M35 13h4a4.5 4.5 0 0 1 0 9h-4" stroke={`url(#bg-gold-${id})`} strokeWidth="3.2" strokeLinecap="round" />
          <path d="M13 8.5h22v11.5c0 6.1-4.9 11-11 11s-11-4.9-11-11V8.5Z" fill={`url(#bg-gold-${id})`} />
          <path d="M24 31v7M16.5 39.5h15" stroke={`url(#bg-gold-${id})`} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M24 13.5 25.7 17.8 30 19.5 25.7 21.2 24 25.5 22.3 21.2 18 19.5 22.3 17.8Z" fill="#ffffff" fillOpacity=".9" />
        </>
      )}

      {name === "checkinSun" && (
        <>
          <rect x="7" y="10" width="34" height="31" rx="8" fill={`url(#bg-gold-${id})`} />
          <rect x="7" y="10" width="34" height="10" rx="6" fill={`url(#bg-rose-${id})`} />
          <path d="M16 6.5v6M32 6.5v6" stroke="#fff4d2" strokeWidth="3" strokeLinecap="round" />
          <path d="m18 29.8 4.4 4.4 8.2-8.8" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}

      {name === "inviteGift" && (
        <>
          <rect x="7" y="18" width="34" height="8" rx="3" fill={`url(#bg-rose-${id})`} />
          <path d="M10 26h28v11.5a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V26Z" fill={`url(#bg-rose-${id})`} fillOpacity=".82" />
          <rect x="21.5" y="18" width="5" height="23.5" fill={`url(#bg-gold-${id})`} />
          <path d="M24 18h-7a4.5 4.5 0 1 1 0-9c4.2 0 7 9 7 9Zm0 0h7a4.5 4.5 0 1 0 0-9c-4.2 0-7 9-7 9Z" stroke={`url(#bg-gold-${id})`} strokeWidth="3" strokeLinejoin="round" />
        </>
      )}

      {name === "walletCard" && (
        <>
          <rect x="5" y="11" width="38" height="27" rx="7.5" fill={`url(#bg-rose-${id})`} />
          <rect x="5" y="11" width="38" height="10" rx="7.5" fill={`url(#bg-glass-${id})`} opacity=".35" />
          <rect x="27" y="22" width="16" height="9" rx="4.5" fill={`url(#bg-gold-${id})`} />
          <circle cx="32" cy="26.5" r="2.2" fill="#7c4704" />
        </>
      )}
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
