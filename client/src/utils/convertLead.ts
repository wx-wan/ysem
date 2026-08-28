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

export interface ConvertOptions {
  /**
   * 当线索关联的客户在系统中不存在时，由调用方弹出「新建客户」弹窗（与客户页一致）。
   * 弹窗保存后 resolve 出新客户 id；弹窗为强制模式，不可取消跳过。
   */
  openCustomerForm: (initial: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
  }) => Promise<{ id: string }>;
  /**
   * 当线索关联的产品在系统中不存在时，由调用方弹出「新建产品」弹窗（与产品页一致）。
   * 弹窗保存后 resolve 出新产品 id；弹窗为强制模式，不可取消跳过。
   */
  openProductForm: (initial: { name?: string }) => Promise<{ id: string }>;
}

/**
 * 在客户列表/产品列表中按名称检索是否已存在
 */
async function findCustomerByName(name: string): Promise<string | null> {
  const res: any = await customerApi.listAll({ keyword: name, pageSize: 50 });
  const list: any[] = res?.data?.list ?? res?.data?.data?.list ?? [];
  const hit = list.find((c) => c.companyName === name || c.companyName?.includes(name) || name.includes(c.companyName ?? ''));
  return hit?.id ?? null;
}

async function findProductByName(name: string): Promise<string | null> {
  const res: any = await productApi.getList({ keyword: name, pageSize: 50 });
  const list: any[] = res?.data?.list ?? res?.data?.data?.list ?? [];
  const hit = list.find((p) => p.name === name || p.name?.includes(name) || name.includes(p.name ?? ''));
  return hit?.id ?? null;
}

/**
 * 线索确认 → 转化为商机：
 * 1. 检测客户是否已建档（customerId 或按名称在客户列表检索）；不存在则确认后新建客户
 * 2. 检测产品是否已建档（productId 或按名称在产品列表检索）；不存在则确认后新建产品
 * 3. 新建一条商机记录，关联建档后的客户与产品
 * 4. 将线索状态标记为「已确认」（QUALIFIED）
 */
export async function convertLeadToOpportunity(leadId: string, options: ConvertOptions = {}): Promise<ConvertResult> {
  const leadRes = await leadApi.get(leadId);
  const lead: Lead = leadRes.data;
  const { openCustomerForm, openProductForm } = options;

  // ---- 客户建档检测 ----
  let customerId: string | null = lead.customerId ?? null;
  let customerCreated = false;
  if (!customerId && lead.companyName) {
    customerId = await findCustomerByName(lead.companyName);
    if (!customerId) {
      // 未检测到客户：弹出「新建客户」弹窗（与客户页一致），强制建档
      const created = await openCustomerForm({
        companyName: lead.companyName,
        contactName: lead.contactName ?? undefined,
        email: lead.email ?? undefined,
        phone: lead.phone ?? undefined,
        country: lead.country ?? undefined,
      });
      customerId = created?.id ?? null;
      if (customerId) {
        customerCreated = true;
        await leadApi.update(leadId, { customerId });
      }
    }
  }

  // ---- 产品建档检测 ----
  let productId: string | null = lead.productId ?? null;
  let productCreated = false;
  if (!productId && lead.productName) {
    productId = await findProductByName(lead.productName);
    if (!productId) {
      // 未检测到产品：弹出「新建产品」弹窗（与产品页一致），强制建档
      const created = await openProductForm({ name: lead.productName });
      productId = created?.id ?? null;
      if (productId) {
        productCreated = true;
        await leadApi.update(leadId, { productId });
      }
    }
  }

  // ---- 新建商机 ----
  const title = lead.leadName || [lead.companyName, lead.productName].filter(Boolean).join('-') || '商机';
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
  const pipeline = pipelineRes?.data?.data ?? pipelineRes?.data ?? pipelineRes;

  // ---- 标记线索为「已确认」 ----
  await leadApi.update(leadId, { status: 'QUALIFIED' });

  return { pipeline, customerCreated, productCreated, customerId, productId };
}
