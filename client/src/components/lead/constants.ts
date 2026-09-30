import type { ReactNode } from 'react';
import type { Channel } from '../../api/channel';
import type { LeadStatus } from '../../api/lead';
import { STATUS_DOT } from '../common/statusDot';

/**
 * 线索状态元数据。
 * - `color`：antd Tag 颜色 —— 新线索=warning（待办）/ 已确认=次要灰（与「客户类型」标签同色，`--c-text-secondary`）/ 已打样=cyan / 已成交=green；
 * - `label`：i18n key；
 * - `icon`：统一为状态圆点（与看板「近期订单」同款 6px 圆点，颜色跟随标签文字色）。
 * 线索状态 4 态：新线索 → 已确认（绑定商机）→ 已打样 → 已成交。
 */
export const STATUS_META: Record<LeadStatus, { color: string; label: string; icon: ReactNode }> = {
  NEW: { color: 'warning', label: 'lead.statusNew', icon: STATUS_DOT },
  CONFIRMED: { color: '#64748b', label: 'lead.statusConfirmed', icon: STATUS_DOT },
  SAMPLED: { color: 'cyan', label: 'lead.statusSampled', icon: STATUS_DOT },
  WON: { color: 'green', label: 'lead.statusWon', icon: STATUS_DOT },
};

/** 渠道根节点展平为下拉选项（value = 渠道 ID，与后端 channelId 对齐） */
export const flattenChannelOptions = (channels: Channel[]) =>
  channels.filter((c) => !c.parentId).map((c) => ({ label: c.name, value: c.id }));

/** 平台选项：选中渠道后只列其下平台（value = 平台 ID，与后端 shopId 对齐）；未选渠道则列出所有平台 */
export const flattenPlatformOptions = (channels: Channel[], channel?: string) => {
  const opts: { label: string; value: string }[] = [];
  const collect = (node: Channel) => {
    (node.children || []).forEach((child) => {
      opts.push({ label: `${node.name} / ${child.name}`, value: child.id });
    });
  };
  if (channel) {
    const node = channels.find((c) => c.id === channel);
    if (node) collect(node);
  } else {
    channels.forEach(collect);
  }
  return opts;
};
