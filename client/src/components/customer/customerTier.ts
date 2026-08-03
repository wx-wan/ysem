import type { Customer } from '../../api/customers';
import { getGrade } from './utils';

/** 客户荣誉层级（与 global.css .customer-tier-* 对应） */
export type CustomerTier =
  | 'shine'   // 本年度新客（金）
  | 'chest'   // 往年老客（紫）
  | 'cheer'   // A 级准成交（橙）
  | 'bottle'  // B 级高意向（蓝）
  | 'hatch'   // C 级中意向（浅蓝）
  | 'dull'    // D 级低意向（更浅蓝）
  | 'void';   // 无商机记录（灰）

export interface CustomerTierResult {
  tier: CustomerTier;
  /** 头部/卡片渐变背景 */
  headerGradient: string;
  /** 头部文字是否用深色（浅色渐变时为 true） */
  headerTextDark: boolean;
  /** 主色 */
  primary: string;
  /** 主色浅底（按钮背景等） */
  primaryLight: string;
  /** 主色超浅底 */
  primaryBg: string;
}

/**
 * 根据客户数据计算荣誉层级与主题色。
 * CustomerCard 与 CustomerDetailModal 共用，确保两处配色完全一致。
 */
export function getCustomerTier(customer: Customer | null): CustomerTierResult {
  if (!customer)
    return {
      tier: 'bottle',
      headerGradient: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
      headerTextDark: false,
      primary: '#1677ff',
      primaryLight: '#e6f0ff',
      primaryBg: 'rgba(22,119,255,0.08)',
    };

  const grade = getGrade(customer);
  const hasPipelines = (customer.pipelines || []).length > 0 || (customer._count?.pipelines ?? 0) > 0;
  const currentYear = new Date().getFullYear().toString();

  // 已成交客户
  if (customer.firstOrderDate) {
    if (customer.firstOrderDate.startsWith(currentYear))
      return {
        tier: 'shine',
        headerGradient: 'linear-gradient(135deg, #ffd666 0%, #f59e0b 100%)',
        headerTextDark: false,
        primary: '#f59e0b',
        primaryLight: '#fef3c7',
        primaryBg: 'rgba(245,158,11,0.08)',
      };
    return {
      tier: 'chest',
      headerGradient: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
      headerTextDark: false,
      primary: '#7c3aed',
      primaryLight: '#ede9fe',
      primaryBg: 'rgba(124,58,237,0.08)',
    };
  }

  // 未成交：无商机记录 → 灰色 void
  if (!hasPipelines) {
    return {
      tier: 'void',
      headerGradient: 'linear-gradient(135deg, #8a8f9a 0%, #6b7280 100%)',
      headerTextDark: false,
      primary: '#6b7280',
      primaryLight: '#e5e7eb',
      primaryBg: 'rgba(107,114,128,0.08)',
    };
  }

  // 未成交：有商机记录，按等级分级
  switch (grade.grade) {
    case 'A':
      return {
        tier: 'cheer',
        headerGradient: 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)',
        headerTextDark: false,
        primary: '#f97316',
        primaryLight: '#ffedd5',
        primaryBg: 'rgba(249,115,22,0.08)',
      };
    case 'B':
      return {
        tier: 'bottle',
        headerGradient: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
        headerTextDark: false,
        primary: '#1677ff',
        primaryLight: '#e6f0ff',
        primaryBg: 'rgba(22,119,255,0.08)',
      };
    case 'C':
      return {
        tier: 'hatch',
        headerGradient: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
        headerTextDark: false,
        primary: '#3b82f6',
        primaryLight: '#dbeafe',
        primaryBg: 'rgba(59,130,246,0.1)',
      };
    case 'D':
    default:
      return {
        tier: 'dull',
        headerGradient: 'linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%)',
        headerTextDark: false,
        primary: '#60a5fa',
        primaryLight: '#eff6ff',
        primaryBg: 'rgba(96,162,250,0.12)',
      };
  }
}

/** 头像背景色：与卡片头部色调保持一致 */
export function getAvatarColor(tier: CustomerTier, token: any): string {
  switch (tier) {
    case 'shine': return '#ffd666';
    case 'chest': return token.purple;
    case 'void': return '#8a8f9a';
    case 'cheer': return '#f97316';
    case 'bottle': return '#1677ff';
    case 'hatch': return '#3b82f6';
    case 'dull': return '#60a5fa';
    default: return token.colorPrimary;
  }
}
