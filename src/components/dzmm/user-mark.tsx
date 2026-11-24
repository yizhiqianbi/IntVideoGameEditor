/** Account portrait. Default art is used until the person uploads a photo. */
export function UserMark({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 80 80" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="user-mark-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#e58aab" />
        <stop offset="52%" stopColor="#c2416b" />
        <stop offset="100%" stopColor="#7a2342" />
      </linearGradient>
      <linearGradient id="user-mark-moon" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fff6f2" />
        <stop offset="100%" stopColor="#ffd9c4" />
      </linearGradient>
      <mask id="user-mark-cut">
        <rect width="80" height="80" fill="white" />
        <circle cx="48" cy="37" r="19" fill="black" />
      </mask>
    </defs>
    <circle cx="40" cy="40" r="40" fill="url(#user-mark-bg)" />
    <circle cx="40" cy="40" r="39" fill="none" stroke="rgba(255,255,255,.18)" />
    <circle cx="37" cy="40" r="17" fill="url(#user-mark-moon)" mask="url(#user-mark-cut)" />
    <path d="M55 25l1.7 4.4 4.4 1.7-4.4 1.7-1.7 4.4-1.7-4.4-4.4-1.7 4.4-1.7z" fill="rgba(255,246,242,.82)" />
    <path d="M24 58c3-7 8-10 13-10" stroke="rgba(255,255,255,.22)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
  </svg>;
}

/** Renders the uploaded photo when present, otherwise the default mark. */
export function AccountAvatar({ src, className, alt = "" }: { src?: string; className?: string; alt?: string }) {
  if (src) return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" />;
  return <UserMark className={className} />;
}
