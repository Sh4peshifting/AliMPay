export function qrImageUrl(source: string) {
  const url = new URL(source, window.location.origin);
  return /^\/uploads\/business-qr-[a-f\d]{16}\.(png|jpg|webp)$/.test(url.pathname) ? url.pathname : url.toString();
}

export async function decodeQrImage(source: Blob | string) {
  let blob: Blob;
  if (typeof source === "string") {
    // Uploaded QR images live on this instance, even if its public domain changed.
    const response = await fetch(qrImageUrl(source), { credentials: "same-origin" });
    if (!response.ok) throw new Error("经营码图片读取失败");
    blob = await response.blob();
  } else {
    blob = source;
  }
  const [{ default: jsQR }, bitmap] = await Promise.all([import("jsqr"), createImageBitmap(blob)]);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("浏览器无法读取二维码图片");
    let lastWidth = 0;
    for (const maximum of [1024, 2048, 4096]) {
      const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      if (lastWidth === canvas.width) continue;
      lastWidth = canvas.width;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
      if (result?.data) return result.data;
    }
    return "";
  } finally {
    bitmap.close();
  }
}
