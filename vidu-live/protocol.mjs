import { randomUUID } from 'node:crypto';
export function text(value, name, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} 不能为空且不能超过 ${max} 字符`);
  return value.trim();
}
export function image(value) {
  if (typeof value !== 'string') throw new Error('请选择参考图');
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    if (value.length > 7 * 1024 * 1024) throw new Error('单张图片请小于 5 MB');
    return value;
  }
  try { if (new URL(value).protocol === 'https:') return value; } catch {}
  throw new Error('参考图必须是 PNG/JPEG/WebP 或 HTTPS 图片地址');
}
export function referencePayload(images) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 3) throw new Error('直播参考图需要 1–3 张');
  const result = { prompt_operation: { op_type: 'switch', images: images.map(item => {
    if (!['object', 'garment', 'background'].includes(item.kind)) throw new Error('参考图类型无效');
    return { image_uri: image(item.url), image_id: randomUUID(), kind: item.kind, user_text: String(item.description || '').slice(0, 2000) };
  }) } };
  if (Buffer.byteLength(JSON.stringify(result)) > 15 * 1024 * 1024) throw new Error('参考图合计过大，请减少图片或压缩后重试');
  return result;
}
export function generationPayload(kind, prompt, images = []) {
  if (!['image', 'video'].includes(kind)) throw new Error('生成类型无效');
  if (!Array.isArray(images) || images.length > 3) throw new Error('最多选择 3 张参考图');
  const body = { model: kind === 'image' ? 'viduq2' : 'viduq3-turbo', prompt: text(prompt, '提示词'), images: images.map(image), aspect_ratio: '16:9', resolution: kind === 'image' ? '1080p' : '720p' };
  if (kind === 'video') Object.assign(body, { duration: 5, audio: true });
  return { path: kind === 'image' ? '/ent/v2/reference2image' : images.length ? '/ent/v2/reference2video' : '/ent/v2/text2video', body };
}
export function signal(liveId, connId, sequence, type, payload) { return { type, live_id: liveId, conn_id: connId, seq_id: sequence, payload }; }
