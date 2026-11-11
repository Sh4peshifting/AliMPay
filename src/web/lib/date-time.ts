export function parseDateTime(value: string) {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match || Number(match[1]) < 1) return null;
  const normalized = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}`;
  const date = new Date(`${normalized}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === normalized ? normalized : null;
}

export function formatDateTime(value: string) {
  return parseDateTime(value)?.replaceAll("-", "/").replace("T", " ") ?? value;
}
