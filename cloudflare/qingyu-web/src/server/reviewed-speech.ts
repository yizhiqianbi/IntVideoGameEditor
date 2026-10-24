import { ContentError, type ModerationEnv } from './policy';
export type CompanionScope = { accountId: string; profile: 'classic' | 'intimate' | 'traveler' };
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const denied = () => new ContentError(503, '这条语音尚未完成内容检查，请稍后重试。');
/** Validate bytes, source text and scope; a nearby safe message proves none of these. */
export async function reviewedSpeechText(url: string, value: unknown, env: ModerationEnv, scope?: CompanionScope): Promise<string> {
  try {
    if (!scope || !env.COMPANION_MEDIA_REVIEW_SECRET || env.COMPANION_MEDIA_REVIEW_SECRET.length < 32 || !value || typeof value !== 'object' || Array.isArray(value)) throw denied();
    const proof = value as Record<string, unknown>;
    if (Object.keys(proof).sort().join(',') !== 'accountId,kind,profile,reviewedAt,sha256,signature,text,version'
      || proof.version !== 1 || proof.kind !== 'audio' || proof.accountId !== scope.accountId || proof.profile !== scope.profile
      || typeof proof.text !== 'string' || !proof.text.trim() || proof.text.length > 900
      || typeof proof.reviewedAt !== 'number' || !Number.isSafeInteger(proof.reviewedAt) || proof.reviewedAt <= 0 || proof.reviewedAt > Date.now() + 300_000
      || typeof proof.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(proof.sha256)
      || typeof proof.signature !== 'string' || !/^[a-f0-9]{64}$/.test(proof.signature)) throw denied();
    const match = /^data:audio\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(url);
    if (!match || url.length > 8_000_000) throw denied();
    const bytes = Uint8Array.from(atob(match[1].replace(/\s/g, '')), character => character.charCodeAt(0));
    if (!bytes.length || hex(await crypto.subtle.digest('SHA-256', bytes)) !== proof.sha256) throw denied();
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.COMPANION_MEDIA_REVIEW_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const payload = JSON.stringify([1, 'audio', proof.accountId, proof.profile, proof.sha256, proof.text, proof.reviewedAt]);
    const signature = Uint8Array.from(proof.signature.match(/../g)!, part => parseInt(part, 16));
    if (!await crypto.subtle.verify('HMAC', key, signature, encoder.encode(payload))) throw denied();
    return proof.text;
  } catch { throw denied(); }
}
