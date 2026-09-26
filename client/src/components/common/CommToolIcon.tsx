import {
  AppstoreOutlined,
  CommentOutlined,
  CustomerServiceOutlined,
  GlobalOutlined,
  MailOutlined,
  MessageOutlined,
  MobileOutlined,
  PhoneOutlined,
  SendOutlined,
  WechatOutlined,
  WhatsAppOutlined,
} from '@ant-design/icons';
import { forwardRef, useEffect } from 'react';
import type { ComponentType } from 'react';
import { useCommToolStore } from '../../stores/useCommToolStore';

/** 系统设置 → 沟通工具维护 可选的图标清单（antd 图标组件名） */
export const COMM_TOOL_ICON_OPTIONS = [
  { label: '邮箱', value: 'MailOutlined' },
  { label: '电话', value: 'PhoneOutlined' },
  { label: '手机', value: 'MobileOutlined' },
  { label: '客服/旺旺', value: 'CustomerServiceOutlined' },
  { label: '微信', value: 'WechatOutlined' },
  { label: 'WhatsApp', value: 'WhatsAppOutlined' },
  { label: '消息', value: 'MessageOutlined' },
  { label: '评论', value: 'CommentOutlined' },
  { label: '发送', value: 'SendOutlined' },
  { label: '全球/网站', value: 'GlobalOutlined' },
];

const ICON_MAP: Record<string, ComponentType<any>> = {
  AppstoreOutlined,
  CommentOutlined,
  CustomerServiceOutlined,
  GlobalOutlined,
  MailOutlined,
  MessageOutlined,
  MobileOutlined,
  PhoneOutlined,
  SendOutlined,
  WechatOutlined,
  WhatsAppOutlined,
};

/** 图标名 → 组件（未知图标回退 AppstoreOutlined） */
export function getCommToolIconComponent(name?: string | null): ComponentType<any> {
  if (name && ICON_MAP[name]) return ICON_MAP[name];
  return AppstoreOutlined;
}

/**
 * 按「沟通工具名称」渲染其维护的图标。
 * 从 useCommToolStore 取出该工具存储的 icon 字段，再映射为组件；
 * 工具未维护 icon 或名称匹配不到时回退 AppstoreOutlined。
 * 使用 forwardRef：作为 Tooltip/Popover 子元素时 antd 会向其注入 ref。
 */
export const CommToolIcon = forwardRef<HTMLSpanElement, { name?: string | null } & Record<string, any>>(
  function CommToolIcon({ name, ...rest }, ref) {
    const tools = useCommToolStore((s) => s.tools);
    const fetchTools = useCommToolStore((s) => s.fetchTools);
    // 工具未加载时主动拉取一次（store 已做幂等防护，重复调用无副作用），
    // 保证列表/详情等未打开过表单的页面也能正确拿到图标
    useEffect(() => {
      if (tools.length === 0) void fetchTools();
    }, [tools.length, fetchTools]);
    const iconName = tools.find((t) => t.name === name)?.icon ?? null;
    const Cmp = getCommToolIconComponent(iconName);
    return (
      <span ref={ref} style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}>
        <Cmp {...rest} />
      </span>
    );
  },
);
