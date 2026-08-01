import type { Customer } from '../../api/customers';

// ========== 客户等级（A/B/C/D 四级，仅由商机中最高采购意向决定，不受重点客户影响） ==========
export function getGrade(customer: Customer): { grade: 'A' | 'B' | 'C' | 'D'; tagColor: string } {
  // 从商机记录中取最高等级的采购意向
  const intentRank: Record<string, number> = { '准成交': 4, '高意向': 3, '中意向': 2, '低意向': 1 };
  const probabilities = (customer.pipelines || [])
    .map((p: any) => p.probability)
    .filter(Boolean);
  const level = probabilities.length > 0
    ? probabilities.reduce((max, p) => (intentRank[p] || 0) > (intentRank[max] || 0) ? p : max, probabilities[0])
    : null;

  // 等级只反映商机真实意向，重点客户不加权（避免“设为重点”篡改意向等级）
  if (level === '准成交') return { grade: 'A', tagColor: 'red' };
  if (level === '高意向') return { grade: 'B', tagColor: 'orange' };
  if (level === '中意向') return { grade: 'C', tagColor: 'gold' };
  return { grade: 'D', tagColor: 'gray' };
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

// ========== 客户类型标签 ==========
export function getCustomerTypeLabel(customer: Customer): { label: string; color: string } | null {
  if (customer.isKeyAccount) return { label: '重点客户', color: 'red' };
  if (!customer.firstOrderDate) return { label: '未成交客户', color: 'default' };
  const currentYear = new Date().getFullYear().toString();
  if (customer.firstOrderDate.startsWith(currentYear)) return { label: '本年度新客', color: 'green' };
  return { label: '往年老客', color: 'blue' };
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
