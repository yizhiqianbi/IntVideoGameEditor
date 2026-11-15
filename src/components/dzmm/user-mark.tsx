/** Account portrait used when the person has not uploaded a photo. */
export function UserMark({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 80 80" aria-hidden="true">
    <circle cx="40" cy="40" r="40" fill="#d94c77" />
    <circle cx="40" cy="30" r="12" fill="#24140f" />
    <path d="M14 70c4-16 13-24 26-24s22 8 26 24" fill="#24140f" />
  </svg>;
}
