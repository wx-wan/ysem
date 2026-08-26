/**
 * 产品图片工具：images 字段格式统一为 JSON 数组字符串 [{ url, name }]，第一张即主图。
 * 兼容历史数据：旧格式为「逗号分隔的 URL 字符串」。
 */

export interface ProductImageItem {
  url: string;
  name: string;
}

/** 解析 images 字段（JSON 数组或旧逗号分隔 URL），返回图片列表 */
export function parseImages(raw?: string | ProductImageItem[] | null): ProductImageItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((i) => i && typeof i.url === 'string' && i.url)
          .map((i) => ({ url: i.url, name: typeof i.name === 'string' && i.name ? i.name : '图片' }));
      }
    } catch {
      /* 落入旧格式解析 */
    }
  }

  // 旧格式：逗号分隔 URL
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url, i) => ({ url, name: i === 0 ? '主图' : `图片${i + 1}` }));
}

/** 序列化为存储格式（JSON 数组字符串） */
export function serializeImages(items: ProductImageItem[]): string {
  return JSON.stringify(items);
}

/** 取主图（第一张）URL */
export function mainImageUrl(raw?: string | null): string | undefined {
  return parseImages(raw)[0]?.url;
}
