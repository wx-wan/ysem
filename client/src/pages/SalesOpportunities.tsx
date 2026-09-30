import Sales from './Sales';

/**
 * 商机页（/sales/opportunities）：默认「全部」状态，
 * 状态切换栏（全部 / 待处理 / 跟进中 / 已报价）由 Sales 内部承载。
 */
export default function SalesOpportunities() {
  return <Sales />;
}
