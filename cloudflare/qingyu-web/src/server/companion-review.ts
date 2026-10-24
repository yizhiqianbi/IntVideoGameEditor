import { reviewedSpeechText, type CompanionScope } from "./reviewed-speech";
import { normalizeMedia } from '../../engine/src/lib/qingyu-companion-media';
import {checkLocalContent,reviewContent,ContentError,type ModerationEnv} from './policy';
/** Review exactly the media aliases that the shared transcript renderer accepts. */
export async function reviewCompanionResponse(response: Response, env: ModerationEnv, fetcher: typeof fetch = fetch, scope?: CompanionScope) {
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) return response;
  let value: unknown;
  try { value = await response.clone().json(); }
  catch { throw new ContentError(503, '聊天内容暂时无法检查，请稍后重试。'); }
  const prose = new Set<string>(), images = new Set<string>();
  const fixedTitles = new Set(["和陆时予的聊天", "和 陆时予 的聊天", "和沈聿的聊天", "和季临川的聊天"]);
  const speech: {url: string; proof: unknown}[] = [];
  function visit(v: unknown, key = '') {
    if (Array.isArray(v)) { v.forEach(item => visit(item, key)); return; }
    if (v && typeof v === 'object') {
      const item = v as Record<string, unknown>;
      const media = normalizeMedia(item);
      for (const part of media) {
        if ((part.kind === 'image' || part.kind === 'emoji') && part.url) images.add(part.url);
        for (const text of [part.text, part.alt, part.label]) if (text?.trim()) prose.add(text);
        if (part.kind === 'audio' && part.url) {
          speech.push({url:part.url,proof:part.qingyuSpeechReview});
        }
      }
      for (const [k, child] of Object.entries(item)) visit(child, k);
    } else if (typeof v === 'string' && /^(text|content|title|personality|speakingStyle|relationshipStyle|alt|label)$/.test(key) && v.trim() && !v.startsWith('data:')) { if (key !== 'title' || !fixedTitles.has(v)) prose.add(v); }
  }
  visit(value);
  for (const clip of speech) prose.add(await reviewedSpeechText(clip.url, clip.proof, env, scope));
  if (prose.size) { checkLocalContent([...prose]); await reviewContent([...prose].join('\n'), env, fetcher); }
  if (images.size) await reviewContent([...images].map(url => ({ type: 'image_url', image_url: {url} })), env, fetcher);
  return response;
}
