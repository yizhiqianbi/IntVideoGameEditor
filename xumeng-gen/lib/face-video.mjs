// 换脸模块支持视频作为原始素材时共用的规则和文案。
// 这个文件会进入浏览器端，不能引用 node: 模块。

export const FACE_VIDEO_MAX_BYTES = 64 * 1024 * 1024;
export const FACE_VIDEO_MAX_SECONDS = 15;
export const FACE_VIDEO_MIN_BYTES = 1024;

export const FACE_VIDEO_PROMPT =
  "以参考图里的人物作为角色，按参考视频的动作、表情和节奏生成视频。参考视频提供动作、镜头和节奏，参考图提供人物外观和画面风格，不要保留参考视频里原来的脸和身份。人物是虚构的成年人，二十一岁以上。";

export const FACE_VIDEO_HINT = "视频建议 15 秒以内、64MB 以内，MP4 或 MOV。";
export const FACE_VIDEO_UPLOADING = "正在上传视频…";
export const FACE_VIDEO_WAITING = "正在换脸，视频要稍等一会儿…";

const VIDEO_EXT = /\.(?:mp4|m4v|mov)$/i;
const VIDEO_TYPES = new Set(["video/mp4", "video/x-m4v", "video/quicktime"]);

export function isVideoFile(name, type) {
  const mime = typeof type === "string" ? type.toLowerCase().trim() : "";
  if (VIDEO_TYPES.has(mime)) return true;
  return VIDEO_EXT.test(typeof name === "string" ? name : "");
}

export function videoFileProblem(name, type, size) {
  if (!isVideoFile(name, type)) return "原始画面可以用图片，或 MP4、MOV 视频。";
  if (!Number.isFinite(size) || size < FACE_VIDEO_MIN_BYTES) return "这段视频读不了。";
  if (size > FACE_VIDEO_MAX_BYTES) return "视频请控制在 64MB 以内。";
  return "";
}

export function videoSecondsProblem(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "这段视频读不了。";
  if (seconds > FACE_VIDEO_MAX_SECONDS + 0.25) return `视频请控制在 ${FACE_VIDEO_MAX_SECONDS} 秒以内。`;
  return "";
}
