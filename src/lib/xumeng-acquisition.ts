import { characterLinkId, characterSharePath } from "./xumeng-character-link";

export const XUMENG_POSTERS = ["catch", "waiting", "gaze"] as const;
export const ACQUISITION_SOURCES = ["invite_link", "character_share", "poster"] as const;
export const ACQUISITION_STORAGE_KEY = "xumeng-acquisition";

const INVITE_CODE = /^[A-Z0-9]{6,32}$/;
const CHARACTER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

export type XumengPoster = (typeof XUMENG_POSTERS)[number];
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export type AcquisitionLanding = {
  source: AcquisitionSource;
  inviteCode: string | null;
  characterId: string | null;
  poster: XumengPoster | null;
};

export function normalizeInviteCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
  return INVITE_CODE.test(code) ? code : null;
}

function isPoster(value: string | null | undefined): value is XumengPoster {
  return value === "catch" || value === "waiting" || value === "gaze";
}

/** Registered users share a character with their invite code. Guests keep the clean path. */
export function characterShareLocation(characterId: string, inviteCode: string | null): string {
  const path = characterSharePath(characterId);
  const code = normalizeInviteCode(inviteCode);
  const params = new URLSearchParams();
  if (code) {
    params.set("invite", code);
    params.set("from", "character");
  }
  const query = params.toString();
  if (path) return query ? `${path}?${query}` : path;
  const hash = `#character/${encodeURIComponent(characterId)}`;
  return query ? `/?${query}${hash}` : `/${hash}`;
}

/** Poster pages keep a clean canonical URL. The query is only on the link people send. */
export function posterShareLocation(poster: XumengPoster, inviteCode: string | null): string {
  const code = normalizeInviteCode(inviteCode);
  if (!code) return `/go/${poster}`;
  return `/go/${poster}?invite=${encodeURIComponent(code)}&from=poster`;
}

/** The poster click should land in the app with the same invite and poster name. */
export function posterEntryHref(search: string, poster: XumengPoster): string {
  const params = new URLSearchParams(search);
  const invite = normalizeInviteCode(params.get("invite"));
  const next = new URLSearchParams();
  if (invite) next.set("invite", invite);
  next.set("from", "poster");
  next.set("poster", poster);
  return `/?${next.toString()}`;
}

export function readAcquisitionLanding(input: { pathname: string; search: string }): AcquisitionLanding | null {
  const params = new URLSearchParams(input.search);
  const inviteCode = normalizeInviteCode(params.get("invite"));
  const from = params.get("from");
  const characterId = characterLinkId(input.pathname);
  const pathPoster = input.pathname.replace(/\/+$/, "").match(/^\/(?:go|jump)\/(catch|waiting|gaze)$/)?.[1];
  const queryPoster = params.get("poster");
  const poster = isPoster(queryPoster) ? queryPoster : isPoster(pathPoster) ? pathPoster : null;
  if (from === "poster" || (poster && inviteCode)) {
    if (!poster) return null;
    return { source: "poster", inviteCode, characterId: null, poster };
  }
  if (from === "character" || (characterId && inviteCode)) {
    return {
      source: "character_share",
      inviteCode,
      characterId: characterId && CHARACTER_ID.test(characterId) ? characterId : null,
      poster: null,
    };
  }
  if (inviteCode) return { source: "invite_link", inviteCode, characterId: null, poster: null };
  return null;
}

export function parseStoredAcquisition(raw: string | null): AcquisitionLanding | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AcquisitionLanding>;
    if (!value || typeof value.source !== "string" || !ACQUISITION_SOURCES.includes(value.source as AcquisitionSource)) return null;
    const source = value.source as AcquisitionSource;
    const characterId = source === "character_share" && typeof value.characterId === "string" && CHARACTER_ID.test(value.characterId)
      ? value.characterId : null;
    const poster = source === "poster" && isPoster(value.poster) ? value.poster : null;
    if (source === "poster" && !poster) return null;
    return { source, inviteCode: normalizeInviteCode(value.inviteCode), characterId, poster };
  } catch {
    return null;
  }
}
