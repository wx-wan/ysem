import type { Channel } from '../../api/channel';
import type { LeadSource, LeadStatus } from '../../api/lead';

/** 线索状态元数据（label 为 i18n key） */
export const STATUS_META: Record<LeadStatus, { color: string; label: string }> = {
  NEW: { color: 'blue', label: 'lead.statusNew' },
  CONTACTED: { color: 'cyan', label: 'lead.statusContacted' },
  QUALIFIED: { color: 'gold', label: 'lead.statusQualified' },
  INVALID: { color: 'default', label: 'lead.statusInvalid' },
  CONVERTED: { color: 'green', label: 'lead.statusConverted' },
  VALID: { color: 'green', label: 'lead.statusValid' },
};

/** 线索来源元数据（label 为 i18n key） */
export const SOURCE_META: Record<LeadSource, { color: string; label: string }> = {
  MANUAL: { color: 'default', label: 'lead.sourceManual' },
  EXCEL: { color: 'purple', label: 'lead.sourceExcel' },
  RPA: { color: 'geekblue', label: 'lead.sourceRpa' },
  SYNC: { color: 'cyan', label: 'lead.sourceSync' },
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
