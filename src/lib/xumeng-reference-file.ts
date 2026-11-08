const directTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxEdge = 1600;
const maxBytes = 1_800_000;

export function referenceFileType(file: { type: string; name: string }): "image/png" | "image/jpeg" | "image/webp" | "" {
  if (file.type === "image/jpg") return "image/jpeg";
  if (directTypes.has(file.type)) return file.type as "image/png" | "image/jpeg" | "image/webp";
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("这张参考图无法读取，请换一张。"));
    reader.onerror = () => reject(new Error("这张参考图无法读取，请换一张。"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth ? resolve(image) : reject(new Error("这张参考图无法读取，请换一张。"));
    image.onerror = () => reject(new Error("这张参考图无法读取，请换一张。"));
    image.src = url;
  });
}

async function shrink(source: CanvasImageSource, width: number, height: number, name: string) {
  const edge = Math.max(width, height);
  const scale = edge > maxEdge ? maxEdge / edge : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("这张参考图无法读取，请换一张。");
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("这张参考图无法读取，请换一张。");
  const base = name.replace(/\.[^.]+$/, "") || "reference";
  const file = new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  return { file, dataUrl: await readDataUrl(file), width: targetWidth, height: targetHeight };
}

export async function prepareReferenceImage(file: File): Promise<{ file: File; dataUrl: string; width: number; height: number }> {
  if (!file.size) throw new Error("请选择 PNG、JPG 或 WebP 图片。");
  const named = referenceFileType(file);
  if (named) {
    const typed = file.type === named ? file : new File([file], file.name || "reference", { type: named });
    const dataUrl = await readDataUrl(typed);
    const image = await loadImage(dataUrl);
    if (Math.max(image.naturalWidth, image.naturalHeight) <= maxEdge && typed.size <= maxBytes) {
      return { file: typed, dataUrl, width: image.naturalWidth, height: image.naturalHeight };
    }
    return shrink(image, image.naturalWidth, image.naturalHeight, typed.name);
  }
  try {
    const bitmap = await createImageBitmap(file);
    try { return await shrink(bitmap, bitmap.width, bitmap.height, file.name || "reference"); }
    finally { bitmap.close(); }
  } catch {
    throw new Error("请选择 PNG、JPG 或 WebP 图片。");
  }
}
