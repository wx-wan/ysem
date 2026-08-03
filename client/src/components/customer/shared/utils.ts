import type { Customer } from '../../../api/customers';
import { getIntentGrade } from './intentLevel';

// ========== 客户等级（A/B/C/D 四级，仅由商机中最高采购意向决定，不受重点客户影响） ==========
export function getGrade(customer: Customer): { grade: 'A' | 'B' | 'C' | 'D'; tagColor: string } {
  // 采购意向等级由商机最高概率派生（逻辑统一收口在 intentLevel.ts）
  const grade = getIntentGrade(customer.pipelines || []);

  // 等级只反映商机真实意向，重点客户不加权（避免“设为重点”篡改意向等级）
  const TAG_COLOR: Record<'A' | 'B' | 'C' | 'D', string> = { A: 'red', B: 'orange', C: 'gold', D: 'gray' };
  return { grade, tagColor: TAG_COLOR[grade] };
}

// ========== 标签色值 ==========
export function tagColorToHex(tagColor: string | undefined, token: any): string {
  const m: Record<string, string> = {
    red: token.colorError,
    blue: token.colorPrimary,
    green: token.colorSuccess,
    orange: token.colorWarning,
    cyan: token.colorInfo,
    purple: token.purple || '#722ed1',
    magenta: token.magenta || '#eb2f96',
    gold: token.gold || '#faad14',
    lime: token.lime || '#a0d911',
    volcano: token.volcano || '#fa541c',
    geekblue: token.geekblue || '#2f54eb',
    gray: '#8c8c8c',
  };
  return m[tagColor || ''] || token.colorPrimary;
}

export function tagColorToBg(tagColor: string, token: any): string {
  const m: Record<string, string> = {
    red: token.colorErrorBg,
    blue: token.colorPrimaryBg,
    green: token.colorSuccessBg,
    orange: token.colorWarningBg,
    cyan: token.colorInfoBg,
    purple: token.colorFillSecondary,
    gray: token.colorFillQuaternary || '#f5f5f5',
  };
  return m[tagColor] || token.colorFillSecondary;
}

// ========== 客户逻辑类型标签（成交/未成交 + 商机最高采购意向，全站统一收口） ==========
const INTENT_LABEL: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: '准成交', B: '高意向', C: '中意向', D: '低意向',
};

// 渲染用纯文字标签（卡片视图与详情弹窗共用，保证一致）
// 规则：已成交客户按首单年份 → 本年度新客/往年老客；未成交客户按商机最高意向 → 未成交客户·意向
export function getCustomerLogicLabel(customer: Customer): string {
  const cy = new Date().getFullYear().toString();
  if (customer.firstOrderDate) {
    return customer.firstOrderDate.startsWith(cy) ? '本年度新客' : '往年老客';
  }
  const { grade } = getGrade(customer);
  const hasPipelines = (customer.pipelines || []).length > 0;
  return hasPipelines ? `未成交客户 · ${INTENT_LABEL[grade] || '低意向'}` : '未成交客户';
}

// 带颜色的类型标签（兼容旧调用方）
export function getCustomerTypeLabel(customer: Customer): { label: string; color: string } | null {
  const label = getCustomerLogicLabel(customer);
  const color: Record<string, string> = {
    '本年度新客': 'green',
    '往年老客': 'blue',
    '未成交客户': 'default',
  };
  if (label.startsWith('未成交客户 ·')) return { label, color: 'orange' };
  return { label, color: color[label] || 'default' };
}

// ========== 客户排序（纯函数，全站唯一来源：各组件/列表/详情共用） ==========
// 排序规则：采购意向 A→B→C→D → 预计商机金额降序 → 新客优先(未成交排最后) → 成交订单金额降序 → 创建时间倒序
// 已移除重点客户优先（标签不再含重点/公海逻辑，排序与标签保持一致）。
const GRADE_ORDER: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };

export function compareCustomers(a: Customer, b: Customer): number {
  // 采购意向等级（A 最高优先）
  const ga = GRADE_ORDER[getGrade(a).grade] ?? 9;
  const gb = GRADE_ORDER[getGrade(b).grade] ?? 9;
  if (ga !== gb) return ga - gb;

  // 预计商机金额从高到低
  const amtA = a.pipelineAmount || 0;
  const amtB = b.pipelineAmount || 0;
  if (amtA !== amtB) return amtB - amtA;

  // 新客户优先，未成交（无首单）排最后
  const currentYear = new Date().getFullYear().toString();
  const orderRank = (c: Customer): number => {
    if (!c.firstOrderDate) return 2;
    return c.firstOrderDate.startsWith(currentYear) ? 0 : 1;
  };
  const ra = orderRank(a);
  const rb = orderRank(b);
  if (ra !== rb) return ra - rb;

  // 成交订单金额从高到低
  const totalA = a.totalAmount || 0;
  const totalB = b.totalAmount || 0;
  if (totalA !== totalB) return totalB - totalA;

  // 创建时间倒序
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

// ========== 头像颜色 ==========
export function avatarColor(name: string): string {
  const colors = [
    '#1677ff', '#52c41a', '#fa8c16', '#eb2f96',
    '#722ed1', '#13c2c2', '#2f54eb', '#f5222d',
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
