// 采购意向等级 —— 客户管理全局公用逻辑
// 商机(SalesPipeline.probability) 直接存储采购意向文案：准成交 / 高意向 / 中意向 / 低意向。
// 全局统一使用这四种表述，不再使用「成交概率」或数字。

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

/** 文案 -> 等级（直接映射，无需数值换算） */
const LABEL_TO_GRADE: Record<string, IntentGrade> = {
  准成交: 'A',
  高意向: 'B',
  中意向: 'C',
  低意向: 'D',
};

/** 数字百分比 -> 等级（仅用于兼容历史脏数据） */
function gradeFromNumber(n: number): IntentGrade {
  if (n >= 90) return 'A';
  if (n >= 60) return 'B';
  if (n >= 30) return 'C';
  return 'D';
}

/** 由采购意向文案/数字推算等级，缺省为 D(低意向) */
export function gradeFromProbability(probability?: number | string | null): IntentGrade {
  if (probability == null || probability === '') return 'D';
  if (typeof probability === 'number') return gradeFromNumber(probability);
  return LABEL_TO_GRADE[probability.trim()] ?? (Number.isNaN(Number(probability)) ? 'D' : gradeFromNumber(Number(probability)));
}

/** 由一组商机的采购意向推算客户等级：取最高意向，无商机为 D */
export function getIntentGrade(pipelines?: Array<{ probability?: number | string | null }>): IntentGrade {
  const order: Record<IntentGrade, number> = { A: 0, B: 1, C: 2, D: 3 };
  let best: IntentGrade = 'D';
  for (const p of pipelines || []) {
    const g = gradeFromProbability(p.probability);
    if (order[g] < order[best]) best = g;
  }
  return best;
}

/** 取得采购意向文案（如 "准成交"） */
export function getIntentLabel(grade: IntentGrade): string {
  return INTENT_LABEL[grade];
}

/** 取得采购意向标签颜色 */
export function getIntentColor(grade: IntentGrade): string {
  return INTENT_COLOR[grade];
}

/** 采购意向下拉选项（由低到高） */
export const INTENT_OPTIONS = [
  { label: '低意向', value: '低意向' },
  { label: '中意向', value: '中意向' },
  { label: '高意向', value: '高意向' },
  { label: '准成交', value: '准成交' },
];

/** 采购意向排序权重（准成交 > 高意向 > 中意向 > 低意向） */
export const INTENT_ORDER: string[] = ['准成交', '高意向', '中意向', '低意向'];

/** 按采购意向文案排序的权重值 */
export function intentSortWeight(label: string): number {
  const idx = INTENT_ORDER.indexOf(label);
  return idx === -1 ? INTENT_ORDER.length : idx;
}
