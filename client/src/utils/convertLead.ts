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
   * 当线索关联的客户/产品在系统中均缺失时，由调用方弹出「待建档清单」汇总弹窗，
   * 用户在汇总页内逐项打开真实新建弹窗建档，全部就绪后 resolve 出新记录 id。
   * 若仅缺一项或调用方未提供此回调，则回退为分别调用 openCustomerForm / openProductForm。
   */
  showCreateSummary?: (items: {
    customerName?: string;
    productName?: string;
  }) => Promise<{ customerId?: string; productId?: string }>;
  /**
   * 当线索关联的客户在系统中不存在时，由调用方弹出「新建客户」弹窗（与客户页一致）。
   * 弹窗保存后 resolve 出新客户 id；弹窗为强制模式，不可取消跳过。
   */
  openCustomerForm?: (initial: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
  }) => Promise<{ id: string }>;
  /**
   * 当线索关联的产品在系统中不存在时，由调用方弹出「新建产品」弹窗（与产品页一致）。
   * 弹窗保存后 resolve 出新产品 id；弹窗为强制模式，不可取消跳过。
   * initial.description 可预填产品描述（来自线索 productDesc），避免建出半成品产品。
   */
  openProductForm?: (initial: { name?: string; description?: string }) => Promise<{ id: string }>;
}

/**
 * 在客户列表/产品列表中按名称检索是否已存在
 */
async function findCustomerByName(name: string): Promise<string | null> {
  const res: any = await customerApi.listAll({ page: 1, pageSize: 200 });
  const list: any[] = res?.data?.list ?? res?.data?.data?.list ?? [];
  const hit = list.find((c) => c.companyName && name && c.companyName.toLowerCase() === name.toLowerCase());
  return hit?.id ?? null;
}

async function findProductByName(name: string): Promise<string | null> {
  const res: any = await productApi.getList({ page: 1, pageSize: 200 });
  const list: any[] = res?.data?.list ?? res?.data?.data?.list ?? [];
  const hit = list.find((p) => p.name && name && p.name.toLowerCase() === name.toLowerCase());
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
  const { openCustomerForm, openProductForm, showCreateSummary } = options;

  // ---- 客户建档检测（先查线索已关联 / 精确同名，判断是否需要新建） ----
  let customerId: string | null = lead.customerId ?? null;
  if (!customerId && lead.companyName) {
    customerId = await findCustomerByName(lead.companyName);
  }
  const needCustomer = !customerId && !!lead.companyName;

  // ---- 产品建档检测 ----
  let productId: string | null = lead.productId ?? null;
  if (!productId && lead.productName) {
    productId = await findProductByName(lead.productName);
  }
  const needProduct = !productId && !!lead.productName;

  let customerCreated = false;
  let productCreated = false;

  // 两项均缺失且调用方支持汇总弹窗：先弹「待建档清单」，用户逐项建档后统一返回 ids
  if ((needCustomer || needProduct) && showCreateSummary) {
    const ids = await showCreateSummary({
      customerName: needCustomer ? lead.companyName! : undefined,
      productName: needProduct ? lead.productName! : undefined,
    });
    if (needCustomer && ids.customerId) {
      customerId = ids.customerId;
      customerCreated = true;
      await leadApi.update(leadId, { customerId });
    }
    if (needProduct && ids.productId) {
      productId = ids.productId;
      productCreated = true;
      await leadApi.update(leadId, { productId });
    }
  } else {
    // 回退：逐项弹出真实新建弹窗（兼容旧调用方）
    if (needCustomer) {
      const created = await openCustomerForm?.({
        companyName: lead.companyName!,
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
    if (needProduct) {
      const created = await openProductForm?.({ name: lead.productName!, description: lead.productDesc ?? undefined });
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
    stage: 'OPPORTUNITY',
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
    // 商机做实：带入线索的预估数据，新商机不再是空壳
    estimatedAmount: lead.targetPrice ? Number(lead.targetPrice) : undefined,
  } as any);
  const pipeline = pipelineRes?.data?.data ?? pipelineRes?.data ?? pipelineRes;

  // ---- 标记线索为「已确认」 ----
  await leadApi.update(leadId, { status: 'QUALIFIED' });

  return { pipeline, customerCreated, productCreated, customerId, productId };
}
