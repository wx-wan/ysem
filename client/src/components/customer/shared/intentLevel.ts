// 采购意向等级 —— 客户管理全局公用逻辑
// 采购意向由商机(SalesPipeline.probability)派生，不直接存在客户字段上。
// 全局统一使用 准成交/高意向/中意向/低意向 四种表述，不使用「成交概率」措辞。
// 等级映射：A=准成交(≥90%) B=高意向(≥60%) C=中意向(≥30%) D=低意向(<30%)

export type IntentGrade = 'A' | 'B' | 'C' | 'D';

/** 等级 -> 中文文案 */
export const INTENT_LABEL: Record<IntentGrade, string> = {
  A: '准成交',
  B: '高意向',
  C: '中意向',
  D: '低意向',
};

/** 等级 -> antd Tag 颜色 */
export const INTENT_COLOR: Record<IntentGrade, string> = {
  A: 'green',
  B: 'blue',
  C: 'gold',
  D: 'default',
};

/** 采购意向下拉选项（由低到高） */
export const INTENT_OPTIONS = [
  { label: '低意向', value: '低意向' },
  { label: '中意向', value: '中意向' },
  { label: '高意向', value: '高意向' },
  { label: '准成交', value: '准成交' },
];

/**
 * 由成交概率(0-100)推算采购意向等级。
 * 文本值（历史脏数据）按含义换算为对应等级。
 */
export function gradeFromProbability(probability?: number | string | null): IntentGrade {
  if (probability == null || probability === '' || probability === '-') return 'D';
  if (typeof probability === 'string') {
    switch (probability) {
      case '准成交':
        return 'A';
      case '高意向':
        return 'B';
      case '中意向':
        return 'C';
      case '低意向':
        return 'D';
      default: {
        const n = Number(probability);
        return gradeFromProbability(Number.isNaN(n) ? undefined : n);
      }
    }
  }
  if (probability >= 90) return 'A';
  if (probability >= 60) return 'B';
  if (probability >= 30) return 'C';
  return 'D';
}

/**
 * 由一组商机概率中最高的一项推算客户采购意向等级。
 * 无商机时返回最低等级 D。
 */
export function getIntentGrade(pipelines?: Array<{ probability?: number | string | null }>): IntentGrade {
  if (!pipelines || pipelines.length === 0) return 'D';
  const maxProb = pipelines.reduce<number | string | null>((max, p) => {
    if (p.probability == null || p.probability === '') return max;
    if (typeof p.probability === 'string') {
      const order: Record<string, number> = { '低意向': 10, '中意向': 45, '高意向': 75, '准成交': 95 };
      const val = order[p.probability] ?? 0;
      return typeof max === 'number' ? Math.max(max, val) : val;
    }
    return typeof max === 'number' ? Math.max(max, p.probability) : p.probability;
  }, null);
  return gradeFromProbability(maxProb);
}

/** 取得采购意向文案（如 "准成交"） */
export function getIntentLabel(grade: IntentGrade): string {
  return INTENT_LABEL[grade];
}

/** 取得采购意向标签颜色 */
export function getIntentColor(grade: IntentGrade): string {
  return INTENT_COLOR[grade];
}

/** 采购意向排序权重（准成交 > 高意向 > 中意向 > 低意向） */
export const INTENT_ORDER: string[] = ['准成交', '高意向', '中意向', '低意向'];

/** 按采购意向文案排序的权重值 */
export function intentSortWeight(label: string): number {
  const idx = INTENT_ORDER.indexOf(label);
  return idx === -1 ? INTENT_ORDER.length : idx;
}
