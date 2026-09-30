import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as leadService from '../services/lead.service';
import { created, fail, success } from '../utils/response';
import { includePublicSea, productVisibilityWhere, projectProductRows, roleScope } from '../scope';

/**
 * Lead Controller（Round R-2 · Lead Pilot）
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO/schema 校验、
 *              authentication / permission context 接入、HTTP 状态码、response formatting。
 *
 * **禁止**：Prisma 访问、数据库查询、事务编排、复杂业务判断、状态机、跨实体业务流程
 * —— 这些均已在 R-2 迁往 services（Business）/ operations（Operation）/ repositories（Data）。
 *
 * API Contract 保持不变：请求字段、响应结构、错误码与既有前端依赖字段逐项未改。
 * 导出名与既有路由引用一致（`routes/lead.routes.ts` 无需改动）。
 */

// ============================================================
// DTO（schema 校验留在 Controller）
// ============================================================

const leadSchema = z.object({
  // 名称可选：未传时由系统按「渠道-平台-采购产品-数量」规则自动生成
  leadName: z.string().min(1).optional(),
  customerId: z.string().optional().nullable(),
  // F-8L-A：来源渠道 / 来源平台正式字段（Lead.channelId / Lead.shopId，均 → Channel）
  channelId: z.string().optional().nullable(),
  shopId: z.string().optional().nullable(),
  // 来源渠道/平台组合值（前端下拉项为 JSON 字符串 {channelId, shopId}）；入库前拆为 channelId/shopId。
  // 与显式 channelId/shopId 二选一传入，sourceKey 优先级更高（见 Business 层拆分逻辑）。
  sourceKey: z.string().trim().max(500).optional().nullable(),
  sourceChannel: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  quantity: z.number().int().min(0).optional(),
  source: z.enum(['MANUAL', 'EXCEL', 'RPA', 'SYNC']).optional(),
  // 草稿标记：暂存场景传 true，放宽「至少一条有效联系方式」等必填约束
  draft: z.boolean().optional(),
  // 三步向导当前阶段（0 客户信息 / 1 需求详情 / 2 确认商机）
  stage: z.number().int().min(0).max(2).nullable().optional(),
  // 阶段锁定标志：客户信息 / 需求详情（建档后锁定）
  customerLocked: z.boolean().optional(),
  productLocked: z.boolean().optional(),
  // 线索状态不接受外部入参：只由单据事件自动推进（转商机 / 建打样单 / 建销售订单）
  companyName: z.string().trim().max(200).nullable().optional(),
  contactName: z.string().trim().max(100).nullable().optional(),
  // 联系方式：数组 [{tool, account}]，非草稿新增时至少一条
  contactMethods: z
    .array(
      z.object({
        tool: z.string().trim().min(1).max(100),
        account: z.string().trim().min(1).max(300),
      }),
    )
    .max(20)
    .nullable()
    .optional(),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  productInterest: z.string().trim().max(300).nullable().optional(),
  productName: z.string().trim().max(200).nullable().optional(),
  remark: z.string().trim().max(1000).nullable().optional(),
  targetMarket: z.string().trim().max(200).nullable().optional(),
  currency: z.string().trim().max(10).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  productType: z.string().trim().max(200).nullable().optional(),
  productDesc: z.string().trim().max(2000).nullable().optional(),
  // 需求详情扩展：产品分类与规格（落 LeadItem，建档时带入产品）
  craftIds: z.array(z.string()).optional().nullable(),
  audienceId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  sizeL: z.number().optional().nullable(),
  sizeW: z.number().optional().nullable(),
  sizeH: z.number().optional().nullable(),
  weight: z.number().optional().nullable(),
  // D1：参考图片接受「URL 字符串」或「{url,name}」对象数组；后端转为 Attachment(ownerType=LEAD) 记录
  images: z
    .array(z.object({ url: z.string().trim().min(1).max(500), name: z.string().trim().max(200).optional() }).or(z.string().trim().min(1).max(500)))
    .max(20)
    .nullable()
    .optional(),
  targetPrice: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined || v === '' ? null : String(v))),
  expectedDelivery: z.string().trim().max(50).nullable().optional(),
  customerType: z.string().trim().max(100).nullable().optional(),
  ownerId: z.string().optional().nullable(),
  // V1.0：Lead 不再持有 pipelineId，商机关联由 Opportunity.leadId 单向持有（见 sales.controller）
});

/** 线索状态中文名（4 态；状态由单据事件自动推进，无人工改动入口） */
const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: '新线索',
  CONFIRMED: '已确认',
  SAMPLED: '已打样',
  WON: '已成交',
};

// ============================================================
// HTTP 边界辅助
// ============================================================

/**
 * 组装业务上下文：actor 身份 + 数据范围提供者。
 * `req` 只在本函数内被读取，Business / Operation / Data 层不接触 HTTP 对象。
 *
 * 两个 admin 判据刻意并列（既有代码中确实不同）：
 *  - `isAdmin`       → roleCode === 'admin' || 'ADMIN'（getLeads 的 ownerId 自由筛选）
 *  - `isStrictAdmin` → roleCode === 'admin'            （release / transfer 的 actor 与 Customer 联动授权）
 */
function buildActorContext(req: AuthRequest): leadService.LeadActorContext {
  return {
    userId: req.userId,
    username: req.username,
    realName: req.realName,
    roleCode: req.roleCode,
    isAdmin: req.roleCode === 'admin' || req.roleCode === 'ADMIN',
    isStrictAdmin: req.roleCode === 'admin',
    ip: req.ip,
    scope: {
      owner: () => roleScope(req, { field: 'ownerId' }),
      assignee: () => roleScope(req, { field: 'id' }),
      customer: async () => includePublicSea(await roleScope(req)),
      productVisibility: () => productVisibilityWhere(req),
    },
  };
}

/**
 * 错误映射（HTTP 边界职责）：
 *  - DomainError（Business 层表达的业务失败）→ 既有响应形状 {code, message}
 *  - ZodError（DTO 校验失败）→ 400 + 逐条 message 拼接（仅 create/update/transfer 路径可能）
 *  - 其它 → 500 '服务器错误'（文案与既有实现逐字一致，未改为 errorHandler 的通用文案）
 */
function respondError(res: Response, err: unknown, zodAware: boolean): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (zodAware && err instanceof z.ZodError) {
    fail(res, 400, err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

/** 附件对外投影，剥离内部字段，仅暴露展示所需 {id,url,name,category,sort} */
function projectAttachments(rows: unknown[]): Record<string, unknown>[] {
  return (rows as Record<string, unknown>[]).map((a) => ({
    id: a.id,
    url: a.filePath,
    name: a.name ?? a.fileName,
    category: a.category,
    sort: a.sort,
  }));
}

// ============================================================
// 列表 / 详情 / 操作记录
// ============================================================

/** 列表：分页 + 多维筛选 */
export const getLeads = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const filters: leadService.LeadListFilters = {
      page: req.query.page as string,
      pageSize: req.query.pageSize as string,
      keyword: (req.query.keyword as string)?.trim(),
      channel: req.query.channel as string, // 渠道（父级，如 国际站）
      platform: req.query.platform as string, // 平台（子级，如 寿春店）
      status: req.query.status as string,
      source: req.query.source as string,
      ownerId: req.query.ownerId as string,
      productId: req.query.productId as string,
      scope: req.query.scope as string,
      sort: req.query.sort as string,
    };

    const { list, total, page, pageSize, attachmentMap } = await leadService.listLeads(
      filters,
      buildActorContext(req),
    );

    // 读取侧（DQ-3=C）：不可见 PRIVATE 产品的属性不得进入响应
    const safeList = (list as { id: string; items: Record<string, unknown>[] }[]).map((lead) => ({
      ...lead,
      items: projectProductRows(req, lead.items, leadService.LEAD_ITEM_PRODUCT_FIELDS, {
        nameField: 'productName',
      }),
      // D1：参考图片（Attachment ownerType=LEAD）
      attachments: projectAttachments(attachmentMap[lead.id] || []),
    }));
    success(res, { list: safeList, total, page, pageSize });
  } catch (err) {
    respondError(res, err, false);
  }
};

export const getLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { item, attachments } = await leadService.getLeadDetail(req.params.id, buildActorContext(req));
    success(res, {
      ...item,
      items: projectProductRows(req, item.items as Record<string, unknown>[], leadService.LEAD_ITEM_PRODUCT_FIELDS, {
        nameField: 'productName',
      }),
      // D1：参考图片（Attachment ownerType=LEAD）
      attachments: projectAttachments(attachments),
    });
  } catch (err) {
    respondError(res, err, false);
  }
};

/**
 * GET /api/leads/:id/logs —— 线索操作记录（详情面板「操作记录」Tab 数据源）。
 * 数据范围门：线索不可见与不存在**同响应 404**（不泄露存在性）。
 */
export const getLeadLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await leadService.getLeadLogs(req.params.id, buildActorContext(req));
    success(res, list);
  } catch (err) {
    respondError(res, err, false);
  }
};

// ============================================================
// 创建 / 更新 / 删除
// ============================================================

export const createLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = leadSchema.parse(req.body);
    const item = await leadService.createLead(data, buildActorContext(req));
    created(res, item);
  } catch (err) {
    respondError(res, err, true);
  }
};

export const updateLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = leadSchema.partial().parse(req.body);
    await leadService.updateLead(req.params.id, data, buildActorContext(req));
    success(res, null, '更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

export const deleteLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await leadService.deleteLead(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};

// ========== 删除线索参考图片附件（D1：Attachment ownerType=LEAD） ==========
export const deleteLeadAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await leadService.deleteLeadAttachment(req.params.id, req.params.attachmentId, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};

// ========== 释放线索（私海 → 公海） ==========
export const releaseLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await leadService.releaseLead(req.params.id, buildActorContext(req));
    success(res, null, '释放成功');
  } catch (err) {
    respondError(res, err, false);
  }
};

// ========== 认领线索（公海 → 私海） ==========
export const claimLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await leadService.claimLead(req.params.id, buildActorContext(req));
    success(res, null, '认领成功');
  } catch (err) {
    respondError(res, err, false);
  }
};

// ========== 转交线索（联动客户 / 产品负责人） ==========
export const transferLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { newOwnerId } = z.object({ newOwnerId: z.string().min(1) }).parse(req.body);
    await leadService.transferLead(req.params.id, newOwnerId, buildActorContext(req));
    success(res, null, '转交成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

// 人工改状态入口已下线：线索状态只由单据事件自动推进（绑定商机 → 已确认 / 建打样单 → 已打样 / 建订单 → 已成交），
// 见 state/leadStatus.state.ts（纯规则）与 operations/state.operations.ts（推进编排）。原 `PATCH /leads/:id/status`（changeLeadStatus）已从路由移除，
// 且 `status` 不在 PUT 白名单内，避免状态与实际单据不一致的脏值。
