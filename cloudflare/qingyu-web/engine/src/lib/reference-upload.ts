export async function readReferenceImages(files: File[]) {
  if (!files.length || files.length > 9)
    throw new Error("每次请选择 1–9 张图片。");
  if (
    files.some(
      (f) => !["image/png", "image/jpeg", "image/webp"].includes(f.type),
    )
  )
    throw new Error("支持 PNG、JPEG、WebP 图片。");
  if (files.some((f) => f.size > 20 * 1024 * 1024))
    throw new Error("单张图片不能超过 20MB。");
  return Promise.all(
    files.map(async (file) => {
      const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`无法读取「${file.name}」，请确认图片没有损坏。`); });
      try {
        const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("浏览器无法读取图片。");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const imageUrl = canvas.toDataURL("image/jpeg", 0.85);
        return { title: file.name.replace(/\.[^.]+$/, ""), imageUrl };
      } finally {
        bitmap.close();
      }
    }),
  );
}
