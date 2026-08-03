import type { Customer } from '../../../api/customers';
import { getIntentGrade, INTENT_LABEL } from './intentLevel';
import { getPurchaseStatus, PURCHASE_STATUS_LABEL } from './purchaseStatus';


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

// ========== 客户采购意向标签（全站统一收口，全局只有 准成交/高意向/中意向/低意向 四种表述） ==========
// 采购意向等级由商机中最高概率派生（逻辑统一收口在 intentLevel.ts）。
// 标签格式：成交状态前缀 + 采购意向，如「未成交客户·准成交」「本年度新客·准成交」「往年老客·高意向」
// 成交状态（未成交/本年度新客/往年老客）统一由 shared/purchaseStatus.ts 的 getPurchaseStatus 计算。
export function getCustomerIntentLabel(customer: Customer): string {
  const { grade } = getGrade(customer);
  return INTENT_LABEL[grade] || '低意向';
}

// 兼容旧名：逻辑标签 = 成交状态前缀 + 后半段
// 有商机：后半段为采购意向（准成交/高意向/中意向/低意向）
// 无商机：后半段固定为「待开发」
export function getCustomerLogicLabel(customer: Customer): string {
  const hasPipelines = (customer.pipelines || []).length > 0;
  const intent = hasPipelines ? (INTENT_LABEL[getGrade(customer).grade] || '低意向') : '待开发';
  const status = getPurchaseStatus(customer);
  return `${PURCHASE_STATUS_LABEL[status]}·${intent}`;
}

// 带颜色的类型标签（兼容旧调用方）
export function getCustomerTypeLabel(customer: Customer): { label: string; color: string } | null {
  const grade = getGrade(customer).grade;
  const label = INTENT_LABEL[grade] || '低意向';
  const color: Record<string, string> = {
    A: 'green',
    B: 'blue',
    C: 'gold',
    D: 'default',
  };
  return { label, color: color[grade] || 'default' };
}

// ========== 客户排序（纯函数，全站唯一来源：各组件/列表/详情共用） ==========
// 排序规则：采购意向 A→B→C→D → 预计商机金额降序 → 新客优先(未成交排最后) → 成交订单金额降序 → 创建时间倒序
// 已移除重点客户优先（标签不再含重点/公海逻辑，排序与标签保持一致）。
const GRADE_ORDER: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };

export function compareCustomers(a: Customer, b: Customer): number {
  // 重点客户（星标）优先排到最前面
  const keyA = a.isKeyAccount ? 1 : 0;
  const keyB = b.isKeyAccount ? 1 : 0;
  if (keyA !== keyB) return keyB - keyA;

  // 采购意向等级（A 最高优先）
  const ga = GRADE_ORDER[getGrade(a).grade] ?? 9;
  const gb = GRADE_ORDER[getGrade(b).grade] ?? 9;
  if (ga !== gb) return ga - gb;

  // 预计商机金额从高到低
  const amtA = a.pipelineAmount || 0;
  const amtB = b.pipelineAmount || 0;
  if (amtA !== amtB) return amtB - amtA;

  // 新客户优先，未成交（无首单）排最后（状态：new=0, old=1, prospect=2）
  const statusRank = (c: Customer): number => {
    const s = getPurchaseStatus(c);
    return s === 'new' ? 0 : s === 'old' ? 1 : 2;
  };
  const ra = statusRank(a);
  const rb = statusRank(b);
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
