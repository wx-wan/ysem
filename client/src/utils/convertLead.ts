import { leadApi, type Lead } from '../api/lead';
import { customerApi } from '../api/customers';
import { productApi } from '../api/products';
import { salesApi } from '../api/sales';

export interface ConvertResult {
  pipeline: any;
  customerCreated: boolean;
  productCreated: boolean;
  customerId: string | null;
  productId: string | null;
}

/**
 * 线索确认 → 转化为商机：
 * 1. 检测客户是否已建档（customerId），未建档则按线索信息新建客户
 * 2. 检测产品是否已建档（productId），未建档则按线索信息新建产品
 * 3. 新建一条商机记录，关联建档后的客户与产品
 * 4. 将线索状态标记为「已确认」（QUALIFIED）
 */
export async function convertLeadToOpportunity(leadId: string): Promise<ConvertResult> {
  const leadRes = await leadApi.get(leadId);
  const lead: Lead = leadRes.data;

  // ---- 客户建档检测 ----
  let customerId: string | null = lead.customerId ?? null;
  let customerCreated = false;
  if (!customerId && lead.companyName) {
    const cRes: any = await customerApi.create({
      companyName: lead.companyName,
      contactName: lead.contactName ?? undefined,
      email: lead.email ?? undefined,
      phone: lead.phone ?? undefined,
      country: lead.country ?? undefined,
    });
    customerId = cRes?.data?.id ?? null;
    if (customerId) {
      customerCreated = true;
      await leadApi.update(leadId, { customerId });
    }
  }

  // ---- 产品建档检测 ----
  let productId: string | null = lead.productId ?? null;
  let productCreated = false;
  if (!productId && lead.productName) {
    const pRes: any = await productApi.create({ name: lead.productName });
    productId = pRes?.data?.id ?? null;
    if (productId) {
      productCreated = true;
      await leadApi.update(leadId, { productId });
    }
  }

  // ---- 新建商机 ----
  const  title = lead.leadName || [lead.companyName, lead.productName].filter(Boolean).join('-') || '商机';
  const pipelineRes: any = await salesApi.create({
    title,
    companyName: lead.companyName ?? undefined,
    contactName: lead.contactName ?? undefined,
    email: lead.email ?? undefined,
    phone: lead.phone ?? undefined,
    country: lead.country ?? undefined,
    source: lead.sourceChannel ?? undefined,
    customerId: customerId ?? undefined,
    products: productId ? [{ productId, quantity: lead.quantity || 1 }] : undefined,
    assignedTo: lead.assignedTo ?? undefined,
    leadId: leadId, // 绑定来源线索，后端会回填线索的 pipelineId，实现双向溯源
  } as any);
  // salesApi.create 返回完整 axios 响应；后端返回 { code, data, message }，
  // 因此真实 pipeline 在 pipelineRes.data.data
  const pipeline = pipelineRes?.data?.data ?? pipelineRes?.data ?? pipelineRes;

  // ---- 标记线索为「已确认」 ----
  await leadApi.update(leadId, { status: 'QUALIFIED' });

  return { pipeline, customerCreated, productCreated, customerId, productId };
}
