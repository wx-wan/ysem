import { leadApi, type Lead } from '../api/lead';
import { resolveLeadCustomer } from './leadCustomer';
import { resolveLeadProduct } from './leadProduct';
import { customerApi } from '../api/customers';
import { productApi } from '../api/products';
import { type ProductImageItem } from '../utils/productImages';

/**
 * 将线索参考图片附件（Attachment ownerType=LEAD）转换为产品图片格式 [{url,name}]，
 * 便于在「确认转商机 → 新建产品」时把线索参考图带入产品。
 */
function leadAttachmentsToProductImages(attachments?: { url: string; name?: string | null }[] | null): ProductImageItem[] {
  if (!attachments || !attachments.length) return [];
  return attachments.map((a, i) => ({ url: a.url, name: a.name || (i === 0 ? '主图' : `图片${i + 1}`) }));
}

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
    /** 待建档产品的初始图片（来自线索参考图，转为产品格式 [{url,name}]） */
    images?: ProductImageItem[];
  }) => Promise<{ customerId?: string; productId?: string }>;
  /**
   * 当线索关联的客户在系统中不存在时，由调用方弹出「新建客户」弹窗（与客户页一致）。
   * 弹窗保存后 resolve 出新客户 id；弹窗为强制模式，不可取消跳过。
   */
  openCustomerForm?: (initial?: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
    /** 线索参考图片（产品图片格式 [{url,name}]），转线索建档时带入客户表 */
    images?: ProductImageItem[];
  }) => Promise<{ id: string }>;
  /**
   * 当线索关联的产品在系统中不存在时，由调用方弹出「新建产品」弹窗（与产品页一致）。
   * 弹窗保存后 resolve 出新产品 id；弹窗为强制模式，不可取消跳过。
   * initial.description 可预填产品描述（来自线索 productDesc），避免建出半成品产品。
   */
  openProductForm?: (initial?: { name?: string; description?: string; images?: ProductImageItem[] }) => Promise<{ id: string }>;
}

// V1.1：线索保存时后端已原子建档并回填外键，前端**不再**按名称在客户/产品列表中兜底检索
// （旧的 findCustomerByName / findProductByName 依赖线索的冗余文本列，那些列已下线）。

/**
 * 线索确认 → 转化为商机：
 * 1. 客户：取线索已关联的 `customerId`（后端建档时回填）；缺失时按需引导建档
 * 2. 产品：取 `items[0].productId`；缺失时按需引导建档
 * 3. 新建一条商机记录，关联建档后的客户与产品
 * 4. 线索状态由后端在创建商机时自动推进为「已确认」（前端不写状态）
 */
export async function convertLeadToOpportunity(leadId: string, options: ConvertOptions = {}): Promise<ConvertResult> {
  const leadRes = await leadApi.get(leadId);
  const lead: Lead = leadRes.data;
  const { openCustomerForm, openProductForm, showCreateSummary } = options;
  // 线索参考图（Attachment ownerType=LEAD）转换为产品图片格式，带入新建产品流程
  const productImages = leadAttachmentsToProductImages(lead.attachments);

  // ---- 客户 / 产品建档检测（V1.1：一律以线索外键为准，名称仅用于建档预填） ----
  const customerId: string | null = lead.customerId ?? null;
  // 客户信息：已建档取客户库关系；**暂存取线索快照**（暂存客户不在客户库，建档时用它预填）
  const customerInfo = resolveLeadCustomer(lead);
  const customerName = customerInfo?.companyName ?? undefined;
  const needCustomer = !customerId;

  const firstItem = lead.items?.[0];
  const productId: string | null = firstItem?.productId ?? null;
  const productName = resolveLeadProduct(lead)?.name ?? undefined;
  const needProduct = !productId;

  let customerCreated = false;
  let productCreated = false;

  // 两项均缺失且调用方支持汇总弹窗：先弹「待建档清单」，用户逐项建档后统一返回 ids
  if ((needCustomer || needProduct) && showCreateSummary) {
    const ids = await showCreateSummary({
      customerName: needCustomer ? customerName : undefined,
      productName: needProduct ? productName : undefined,
      images: needProduct ? productImages : undefined,
    });
    if (needCustomer && ids.customerId) {
      customerCreated = true;
      await leadApi.update(leadId, { customerId: ids.customerId });
    }
    if (needProduct && ids.productId) {
      productCreated = true;
      await leadApi.update(leadId, { productId: ids.productId });
    }
  } else {
    // 回退：逐项弹出真实新建弹窗（兼容旧调用方）
    if (needCustomer) {
      const created = await openCustomerForm?.({
        companyName: customerName,
        contactName: customerInfo?.contactName ?? undefined,
        email: customerInfo?.email ?? undefined,
        phone: customerInfo?.phone ?? undefined,
        country: customerInfo?.country ?? undefined,
        images: productImages,
      });
      if (created?.id) {
        customerCreated = true;
        await leadApi.update(leadId, { customerId: created.id });
      }
    }
    if (needProduct) {
      const created = await openProductForm?.({ name: productName, images: productImages });
      if (created?.id) {
        productCreated = true;
        await leadApi.update(leadId, { productId: created.id });
      }
    }
  }

  // ---- 确认线索（服务端在此刻创建商机）----
  // 规则：商机不支持创建，只可由线索创建 —— 唯一入口是 `POST /api/leads/:id/confirm`，
  // 客户与来源线索由**服务端从线索派生**（故不提交 customerId / leadId）；
  // 渠道与阶段同样由服务端派生。创建成功后后端自动把线索推进为「已确认」。
  const title = lead.leadName || [customerName, productName].filter(Boolean).join('-') || '商机';
  const pipelineRes: any = await leadApi.confirm(leadId, {
    title,
    ownerId: lead.ownerId ?? null,
    // 商机做实：带入线索的预估数据，新商机不再是空壳
    estimatedAmount: lead.targetPrice ? Number(lead.targetPrice) : undefined,
    // 数量取线索明细（V1.1：Lead.quantity 标量已下线）
    products: productId ? [{ productId, quantity: firstItem?.quantity || 1 }] : null,
  });
  const pipeline = pipelineRes?.data?.data ?? pipelineRes?.data ?? pipelineRes;

  // 线索状态不再由前端写入：后端创建商机（Opportunity.leadId 绑定）时自动推进为「已确认」

  return { pipeline, customerCreated, productCreated, customerId, productId };
}
