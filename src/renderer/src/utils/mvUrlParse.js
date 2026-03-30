/**
 * 从页面 URL 或裸视频 ID 解析 YouTube / Bilibili MV（与 MV 设置里自定义链接规则一致）
 * @param {string} url
 * @returns {{ id: string, source: "youtube" | "bilibili" } | null}
 */
export function extractVideoId(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  const ytLong = trimmed.match(
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/,
  );
  if (ytLong) return { id: ytLong[1], source: "youtube" };

  const ytShort = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (ytShort) return { id: ytShort[1], source: "youtube" };

  const bvMatch = trimmed.match(/(BV[a-zA-Z0-9]{10})/i);
  if (bvMatch) return { id: bvMatch[1], source: "bilibili" };

  const biliUrl = trimmed.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})/i);
  if (biliUrl) return { id: biliUrl[1], source: "bilibili" };

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { id: trimmed, source: "youtube" };
  }

  return null;
}
