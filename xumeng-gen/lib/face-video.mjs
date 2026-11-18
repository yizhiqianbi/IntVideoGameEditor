// 换脸模块支持视频作为原始素材时共用的规则和文案。
// 这个文件会进入浏览器端，不能引用 node: 模块。

export const FACE_VIDEO_MAX_BYTES = 64 * 1024 * 1024;
export const FACE_VIDEO_MAX_SECONDS = 30;
export const FACE_VIDEO_MIN_BYTES = 1024;

export const FACE_VIDEO_PROMPT =
  "把参考图里的人脸换到视频里的人物脸上。保留视频原有的动作、姿势、服装、场景、光线、镜头和背景，只改五官、脸型和发型，并让新脸贴合原来的角度和光线。人物是虚构的成年人。";

export const FACE_VIDEO_HINT = "视频建议 30 秒以内、64MB 以内，MP4 或 MOV。";
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
