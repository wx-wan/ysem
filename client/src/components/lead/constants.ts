import { createElement, type ReactNode } from 'react';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ExperimentOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import type { Channel } from '../../api/channel';
import type { LeadStatus } from '../../api/lead';

/**
 * 线索状态元数据。
 * - `color`：antd Tag 语义色（新线索=warning 感叹号 / 已确认=success）；
 * - `label`：i18n key；
 * - `icon`：状态标签前缀图标（不依赖颜色也能辨识状态）。
 * 线索状态 4 态：新线索 → 已确认（绑定商机）→ 已打样 → 已成交。
 */
export const STATUS_META: Record<LeadStatus, { color: string; label: string; icon: ReactNode }> = {
  NEW: { color: 'warning', label: 'lead.statusNew', icon: createElement(ExclamationCircleOutlined) },
  CONFIRMED: { color: 'success', label: 'lead.statusConfirmed', icon: createElement(CheckCircleOutlined) },
  SAMPLED: { color: 'cyan', label: 'lead.statusSampled', icon: createElement(ExperimentOutlined) },
  WON: { color: 'green', label: 'lead.statusWon', icon: createElement(TrophyOutlined) },
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
