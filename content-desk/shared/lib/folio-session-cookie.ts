const SESSION = "shelf_session";
const PARENT = ".contentdesk.local";
const HOSTS = new Set(["contentdesk.local", "create.contentdesk.local"]);

function withoutDomain(cookie: string) {
  return cookie.replace(/;\s*Domain=[^;]*/gi, "");
}

function clearing(cookie: string) {
  return /;\s*Max-Age=0(?:\s*;|$)/i.test(cookie) || /^shelf_session=(?:;|$)/i.test(cookie.trim());
}

/** Login on either public host becomes one session for both sites. */
export function sharedSessionCookies(hostname: string, cookies: string[]): string[] {
  const host = hostname.toLowerCase().split(":")[0];
  if (!HOSTS.has(host)) return cookies;
  const next: string[] = [];
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (!/^shelf_session=/i.test(trimmed)) {
      next.push(cookie);
      continue;
    }
    const plain = withoutDomain(trimmed);
    if (clearing(plain)) {
      next.push(plain);
      next.push(`${plain}; Domain=${PARENT}`);
      continue;
    }
    next.push(`${plain}; Domain=${PARENT}`);
    const hostOnly = plain
      .replace(/^shelf_session=[^;]*/i, `${SESSION}=`)
      .replace(/;\s*Max-Age=[^;]*/gi, "")
      .replace(/;\s*Expires=[^;]*/gi, "");
    next.push(`${hostOnly}; Max-Age=0`);
  }
  return next;
}
