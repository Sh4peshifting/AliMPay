export function normalizeBusinessQrContent(value: string) {
  if (value.length > 2048) return "";
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "qr.alipay.com" || url.port || url.username || url.password || url.pathname === "/") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function createBusinessQrUri(content: string) {
  const qrcode = normalizeBusinessQrContent(content);
  return qrcode ? `alipays://platformapi/startapp?${new URLSearchParams({ saId: "10000007", qrcode })}` : "";
}
