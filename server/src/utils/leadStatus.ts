import { LeadStatus } from '@prisma/client';
import prisma from '../lib/prisma';

/**
 * 线索状态（4 态）：新线索 → 已确认 → 已打样 → 已成交。
 *
 * 状态**只能由单据事件自动推进**，不允许人工改动（PATCH /leads/:id/status 已下线，
 * PUT /leads/:id 不再接受 status）：
 * - 创建线索                      → NEW
 * - 线索绑定商机（Opportunity.leadId）→ CONFIRMED
 * - 该商机下生成打样单              → SAMPLED
 * - 该商机下生成销售订单            → WON
 *
 * 打样单 / 销售订单只关联 `opportunityId`，故线索侧经 **商机间接追溯**（Lead → Opportunity → 单据），
 * 不在 Lead 上冗余 sampleOrderId / salesOrderId 列（避免循环外键与双写不一致）。
 */

/** 状态递进顺序：只允许向前推进，不允许回退或降级 */
const LEAD_STATUS_RANK: Record<LeadStatus, number> = {
  NEW: 0,
  CONFIRMED: 1,
  SAMPLED: 2,
  WON: 3,
};

/**
 * 把线索推进到目标状态：已处于同级 / 更高状态时不变（不降级）。
 * 状态推进失败**不阻断**单据创建主流程（单据是权威，状态只是派生结论），仅记录日志。
 */
export async function advanceLeadStatus(leadId: string | null | undefined, next: LeadStatus): Promise<void> {
  if (!leadId) return;
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, status: true } });
    if (!lead) return;
    if (LEAD_STATUS_RANK[next] <= LEAD_STATUS_RANK[lead.status]) return;
    await prisma.lead.update({ where: { id: leadId }, data: { status: next } });
  } catch (err) {
    console.error('[leadStatus] advance failed', { leadId, next, err });
  }
}

/** 商机 → 线索 ID（单据只挂商机，线索经 Opportunity.leadId 间接追溯） */
export async function leadIdOfOpportunity(opportunityId: string | null | undefined): Promise<string | null> {
  if (!opportunityId) return null;
  try {
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { leadId: true },
    });
    return opportunity?.leadId ?? null;
  } catch (err) {
    console.error('[leadStatus] resolve opportunity failed', { opportunityId, err });
    return null;
  }
}

/** 建打样单 / 销售订单后，按商机追溯线索并推进状态 */
export async function advanceLeadStatusByOpportunity(
  opportunityId: string | null | undefined,
  next: LeadStatus,
): Promise<void> {
  const leadId = await leadIdOfOpportunity(opportunityId);
  await advanceLeadStatus(leadId, next);
}
