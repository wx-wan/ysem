import type { IntentLevel, OpportunityOutcome, PipelineStage } from '../../../types/sales';

/**
 * 商机（Opportunity）UI 常量（Round F-S2）
 *
 * 原则：**值**逐字来自后端真实契约（prisma enum + pipelineStage.ts），前端只补中文 label 与分页边界。
 * 标签复用：意向 / 结论（outcome）的中文文案已由 F-6/F-7 在 pages/customers/constants.ts 收口
 * （INTENT_LABEL / INTENT_COLOR / OPPORTUNITY_OUTCOME_LABEL / OPPORTUNITY_OUTCOME_COLOR /
 * OPPORTUNITY_INTENT_LABEL），本文件**引用并再导出**同一来源，避免出现第二套会漂移的文案
 * （与 CustomerDetailPage 的商机表逐字一致）。
 */
import { INTENT_COLOR, INTENT_LABEL } from '../../customers/constants';

/** 意向等级 → 中文（键 = 后端 IntentLevel；文案复用 F-6 收口表） */
export const INTENT_LEVEL_LABEL: Record<string, string> = INTENT_LABEL;
export const INTENT_LEVEL_COLOR: Record<string, string> = INTENT_COLOR;

export {
  OPPORTUNITY_INTENT_LABEL,
  OPPORTUNITY_OUTCOME_COLOR,
  OPPORTUNITY_OUTCOME_LABEL,
} from '../../customers/constants';

/** 分页（后端 pageSize 无显式上限；前端自行限制，不发送越界值） */
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100];

/**
 * 阶段中文 label —— 键 = server/src/utils/pipelineStage.ts L16 的真实取值（派生值，不可人工切换）。
 * 文案取自项目内既有术语（菜单「商机 / 报价 / 打样 / 生产 / 出运」与 SALES_ORDER_STATUS_LABEL 的「已出运」）。
 */
export const STAGE_LABEL: Record<PipelineStage, string> = {
  LEAD: '线索',
  OPPORTUNITY: '商机',
  QUOTED: '已报价',
  SAMPLE: '打样',
  PRODUCTION: '生产',
  SHIPPED: '已出运',
  ORDER: '已下单',
};

export const STAGE_COLOR: Record<PipelineStage, string> = {
  LEAD: 'default',
  OPPORTUNITY: 'blue',
  QUOTED: 'cyan',
  SAMPLE: 'purple',
  PRODUCTION: 'orange',
  SHIPPED: 'geekblue',
  ORDER: 'green',
};

/** 阶段提示：派生值由后端按关联单据推导，前端不得提供人工切换入口 */
export const STAGE_DERIVED_HINT = '阶段由后端按关联单据（报价 / 打样 / 订单 / 出运）自动推导，不可人工修改。';

/** 意向等级选项（值 = 后端 IntentLevel 枚举；文案 = 全站统一的 准成交/高意向/中意向/低意向） */
export const OPPORTUNITY_INTENT_OPTIONS: { value: IntentLevel; label: string }[] = [
  { value: 'LOW', label: '低意向' },
  { value: 'MEDIUM', label: '中意向' },
  { value: 'HIGH', label: '高意向' },
  { value: 'READY', label: '准成交' },
];

/** 结论提示（outcome 为唯一落库终态字段；后端无状态机约束，本阶段不提供变更入口） */
export const OUTCOME_NOTE = '结论（进行中 / 赢单 / 输单）当前无流转规则，本阶段仅展示。';

/** 意向清空语义提示（后端 L484-489：intentLevel 传 null 等同不修改 ⇒ 不支持清空） */
export const INTENT_CLEAR_UNSUPPORTED_HINT = '后端不支持将意向清空为「无意向」（传 null 视为不修改），可选择其他等级调整。';

/** 客户不可更换提示（本阶段 UI 不提供更换客户；后端 schema 虽允许，但不在 MVP 范围） */
export const CUSTOMER_IMMUTABLE_HINT = '商机的客户在创建后不可更换（MVP 范围）；如需调整请新建商机。';

/** 明细重建提示（后端 update 传 products 会删除并重建全部明细） */
export const ITEMS_REBUILD_HINT = '保存时将按下方产品明细整体覆盖该商机的产品关联。';

export const OPPORTUNITY_OUTCOME_OPTIONS: { value: OpportunityOutcome; label: string }[] = [
  { value: 'OPEN', label: '进行中' },
  { value: 'WON', label: '赢单' },
  { value: 'LOST', label: '输单' },
];

/**
 * 商机活动动作 label —— 键 = OpportunityActivity.action（模型注释 L: CREATED / STAGE_CHANGE /
 * NOTE_ADDED / QUOTATION_SENT / WON / LOST）；当前后端仅写入 CREATED（createOpportunity L396-402）。
 */
export const OPPORTUNITY_ACTIVITY_LABEL: Record<string, string> = {
  CREATED: '创建商机',
  STAGE_CHANGE: '阶段变更',
  NOTE_ADDED: '新增跟进',
  QUOTATION_SENT: '已发报价',
  WON: '赢单',
  LOST: '输单',
};

/** 详情页 activities 取值上限（后端 getOpportunity take: 30） */
export const ACTIVITY_TAKE_LIMIT = 30;
