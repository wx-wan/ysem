import type { Channel } from '../api/channel';

/** 来源组合值：渠道 + 平台（无子平台的渠道仅传 channelId，与后端拆分口径逐字一致） */
export interface SourceKeyValue {
  channelId?: string;
  shopId?: string;
}

export interface SourceOption {
  label: string;
  value: string;
}

/** 解析 sourceKey（JSON `{channelId, shopId}`）；解析失败返回 null */
export const parseSourceKey = (raw?: string | null): SourceKeyValue | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SourceKeyValue;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * 由渠道 / 平台拼成 sourceKey 组合值（与来源选项的取值格式逐字一致）。
 * 不兜底 `shopId = channelId`：无子平台的渠道只传 channelId，否则后端父子一致性校验必然 400。
 */
export const buildSourceKey = (
  channelId?: string | null,
  shopId?: string | null,
): string | null =>
  channelId
    ? JSON.stringify(shopId && shopId !== channelId ? { channelId, shopId } : { channelId })
    : null;

/** 渠道树 → 来源选项（有子平台时展开为「渠道 · 平台」，否则仅渠道） */
export const buildSourceOptions = (channels: Channel[]): SourceOption[] => {
  const list: SourceOption[] = [];
  channels.forEach((c) => {
    const children = c.children || [];
    if (!children.length) {
      list.push({ label: c.name, value: JSON.stringify({ channelId: c.id }) });
    } else {
      children.forEach((child) => {
        list.push({
          label: `${c.name} · ${child.name}`,
          value: JSON.stringify({ channelId: c.id, shopId: child.id }),
        });
      });
    }
  });
  return list;
};

/**
 * 来源组合值 → 展示文本（按渠道树解析名称）。
 *
 * 覆盖「客户有渠道但无平台」这类值：它不在 `buildSourceOptions` 的候选里
 * （有子平台的渠道只展开为「渠道 · 平台」），必须以渠道名兜底显示，
 * 否则控件一个 chip 都不高亮 —— 表现为「来源渠道没有正确回显」。
 */
export const sourceKeyLabel = (value?: string | null, channels: Channel[] = []): string => {
  const parsed = parseSourceKey(value);
  if (!parsed?.channelId) return '';
  const channel = channels.find((c) => c.id === parsed.channelId);
  const shop = parsed.shopId
    ? channels.flatMap((c) => c.children || []).find((s) => s.id === parsed.shopId)
    : undefined;
  return [channel?.name, shop?.name].filter(Boolean).join(' · ');
};
