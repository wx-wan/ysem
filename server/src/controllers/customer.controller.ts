import { Request, Response, NextFunction } from "express";
import * as XLSX from "xlsx";
import { z } from "zod";
import { CustomerLevel } from "@prisma/client";
import { error, success } from "../utils/response";
import { AuthRequest } from "../middleware/auth";
import * as customerService from "../services/customer.service";
import { includePublicSea, roleScope } from "../scope";

/**
 * Customer Controller（Round R-3 · Customer Pilot）
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO/schema 校验、
 *              authentication / permission context 接入、HTTP 状态码、response formatting。
 *
 * **禁止**：Prisma 访问、数据库查询、事务编排、复杂业务判断、状态机、跨实体业务流程
 * —— 这些均已在 R-3 迁往 services（Business）/ operations（Operation）/ repositories（Data）。
 *
 * API Contract 保持不变：endpoint / method / request field / response shape / 错误码与文案逐项未改。
 * 导出名与既有路由引用一致（`routes/customer.routes.ts` 无需改动）。
 * 错误处理沿用既有语义：业务失败由 Business 层抛 `DomainError`，经 `next(err)` 交
 * `middleware/errorHandler` 映射为**与既有 `error(res, msg, code)` 完全相同**的响应体。
 */

// ============================================================
// DTO（schema 校验留在 Controller）
// ============================================================

/** tags 归一：null / undefined → []；字符串按 `,` / `，` 拆分；数组逐项 trim 去空 */
const tagsField = z
  .union([z.array(z.string()), z.string(), z.null()])
  .optional()
  .transform((value): string[] => {
    if (value === null || value === undefined) return [];
    const list = Array.isArray(value) ? value : value.split(/[,，]/);
    return list.map((item) => item.trim()).filter((item) => item.length > 0);
  });

/** 主图入参：新字段 coverImage 优先，兼容旧字段名 images（数组取首个非空字符串） */
const coverImageField = z.union([z.string(), z.array(z.string()), z.null()]).optional();

const customerCreateSchema = z.object({
  companyName: z.string().trim().min(1, '公司名称不能为空').max(200),
  contactName: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  country: z.string().trim().max(100).nullish(),
  industry: z.string().trim().max(100).nullish(), // 所属行业（非必填）
  website: z.string().trim().max(500).nullish(), // 公司官网（非必填）
  customerType: z.string().trim().max(100).nullish(),
  // F-CRM-CHANNEL：承接线索转客户带入的渠道·平台组合来源（与 Lead.channelId/shopId 同义）
  sourceKey: z.string().trim().max(500).nullish(),
  channelId: z.string().trim().max(50).nullish(),
  shopId: z.string().trim().max(50).nullish(),
  // 联系方式（与 Lead.contactMethods 一致：[{tool, account}] 数组）
  contactMethods: z.any().nullish(),
  // D-SOURCE-2：Customer.source 由 API 业务语义固定为 MANUAL ⇒ create 不接受 source 入参
  notes: z.string().trim().max(2000).nullish(),
  ownerId: z.string().nullish(),
  isKeyAccount: z.boolean().optional(),
  tags: tagsField,
  // D-INTENT v2：Customer.intentLevel 为系统派生字段，**不再接受人工输入**
  coverImage: coverImageField,
  images: coverImageField,
});

const customerUpdateSchema = z.object({
  companyName: z.string().trim().min(1, '公司名称不能为空').max(200).optional(),
  englishName: z.string().trim().max(200).nullish(),
  industry: z.string().trim().max(100).nullish(),
  website: z.string().trim().max(500).nullish(),
  contactName: z.string().trim().max(100).nullish(),
  position: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  wechat: z.string().trim().max(100).nullish(),
  country: z.string().trim().max(100).nullish(),
  region: z.string().trim().max(100).nullish(),
  customerLevel: z.nativeEnum(CustomerLevel).optional(),
  customerType: z.string().trim().max(100).nullish(),
  // F-CRM-CHANNEL：编辑时也允许改写渠道·平台组合来源
  sourceKey: z.string().trim().max(500).nullish(),
  channelId: z.string().trim().max(50).nullish(),
  shopId: z.string().trim().max(50).nullish(),
  contactMethods: z.any().nullish(),
  // D-SOURCE-4：普通 update 不得修改 Customer.source ⇒ 不接受 source 入参
  notes: z.string().trim().max(2000).nullish(),
  ownerId: z.string().nullish(),
  isKeyAccount: z.boolean().optional(),
  tags: tagsField,
  // D-INTENT v2：Customer.intentLevel 为系统派生字段，**不再接受人工输入/修改**
  // 首次下单日期：V1.0 字段 firstOrderAt 优先（末键为保留的旧入参兼容别名）
  firstOrderAt: customerService.dateField,
  firstOrderDate: customerService.dateField,
  coverImage: coverImageField,
  images: coverImageField,
});

// ============================================================
// HTTP 边界辅助
// ============================================================

/**
 * 组装业务上下文：actor 身份 + 数据范围提供者。
 * `req` 只在本函数内被读取，Business / Operation / Data 层不接触 HTTP 对象。
 *
 * 两个 admin 判据刻意并列（既有代码中确实不同）：
 *  - `isAdmin`       → roleCode === 'admin' || 'ADMIN'（getReportStats 报表口径）
 *  - `isStrictAdmin` → roleCode === 'admin'            （update / remove / claim / release / transfer）
 */
function buildActorContext(req: AuthRequest): customerService.CustomerActorContext {
  return {
    userId: req.userId,
    username: req.username,
    roleCode: req.roleCode,
    isAdmin: req.roleCode === "admin" || req.roleCode === "ADMIN",
    isStrictAdmin: req.roleCode === "admin",
    scope: {
      customer: async () => includePublicSea(await roleScope(req)),
      owner: () => roleScope(req),
      assignee: () => roleScope(req, { field: "id" }),
    },
  };
}

/**
 * 错误映射（HTTP 边界职责）：
 *  - ZodError（DTO 校验失败，仅 create / update / updateTags 路径可能）→ 400 + 逐条 message（`；` 拼接，文案与既有一致）
 *  - 其余（含 Business 层抛出的 DomainError）→ `next(err)`，交由既有 errorHandler 处理，
 *    响应体与既有 `error(res, msg, code)` 完全相同（`{code, message}` + 同状态码）。
 */
function handleFailure(
  err: unknown,
  res: Response,
  next: NextFunction,
  zodAware = false,
): void {
  if (zodAware && err instanceof z.ZodError) {
    error(res, err.errors.map((e) => e.message).join("；"), 400);
    return;
  }
  next(err);
}

/** 分页参数（与既有 `req.query.page / pageSize` 默认值 "1" / "20" 一致） */
function listInput(req: AuthRequest): customerService.CustomerListInput {
  return {
    keyword: req.query.keyword as string | undefined,
    type: req.query.type as string | undefined,
    country: req.query.country as string | undefined,
    page: req.query.page as string | undefined,
    pageSize: req.query.pageSize as string | undefined,
    ownerId: req.query.ownerId as string | undefined,
  };
}

// ========== 获取我的私海客户 ==========
export const listMy = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    success(res, await customerService.listMy(listInput(req), buildActorContext(req)));
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 获取公海客户 ==========
export const listPublic = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    success(res, await customerService.listPublic(listInput(req), buildActorContext(req)));
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 轻量归属查询（线索表单 onBlur 去重 / 归属判定专用） ==========
/**
 * GET /customers/ownership?companyName=xxx
 *
 * 跨全员检索（刻意**不套数据权限 scope**），按公司名称精确匹配，
 * 仅返回归属状态码 + 命中客户主键 + 负责人姓名，**绝不返回任何具体客户资料**。
 */
export const checkOwnership = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    success(res, await customerService.checkOwnership(req.query.companyName as string | undefined, buildActorContext(req)));
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 客户下拉选项：我的私海 + 公海；管理员为全部 ==========
export const listOptions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    success(res, await customerService.listOptions(buildActorContext(req)));
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 管理员：查看所有客户（按业务员分组） ==========
export const listAll = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    success(res, await customerService.listAll(listInput(req), buildActorContext(req)));
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 客户详情（含订单列表） ==========
export const getById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    success(res, await customerService.getById(req.params.id, buildActorContext(req)));
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 创建客户 ==========
export const create = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = customerCreateSchema.parse(req.body);
    success(res, await customerService.create(body, buildActorContext(req)), "创建成功");
  } catch (err) {
    handleFailure(err, res, next, true);
  }
};

// ========== 更新客户 ==========
export const update = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = customerUpdateSchema.parse(req.body);
    success(res, await customerService.update(req.params.id, body, buildActorContext(req)), "更新成功");
  } catch (err) {
    handleFailure(err, res, next, true);
  }
};

// ========== 删除客户 ==========
export const remove = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await customerService.remove(req.params.id, buildActorContext(req));
    success(res, null, "删除成功");
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 认领客户（公海 → 私海） ==========
export const claim = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await customerService.claim(req.params.id, buildActorContext(req));
    success(res, null, "认领成功");
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 释放客户（私海 → 公海） ==========
export const release = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await customerService.release(req.params.id, buildActorContext(req));
    success(res, null, "释放成功");
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 转交客户（管理员操作） ==========
export const transfer = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await customerService.transfer(req.params.id, req.body?.newOwnerId, buildActorContext(req));
    success(res, null, "转交成功");
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== Excel 导入 ==========
export const importExcel = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) {
      error(res, "请上传文件", 400);
      return;
    }
    const { created, failed } = await customerService.importExcel(file.buffer);
    success(res, { created, failed }, `导入完成：成功 ${created} 条，失败 ${failed} 条`);
  } catch (err) {
    handleFailure(err, res, next);
  }
};

/**
 * Excel 导入模板下载。
 *
 * 表头必须与 `customerService.importExcel` 的 fieldMap 对齐（含中英文别名中的中文项）；
 * 「来源 / 意向等级」按 D-SOURCE-3 / D-INTENT v2 不再由 Excel 决定，故模板不提供这两列。
 */
export const downloadTemplate = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const header = ['公司名称', '联系人', '邮箱', '电话', '国家', '备注', '重点客户', '首次下单日期'];
    const ws = XLSX.utils.aoa_to_sheet([header]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '客户导入模板');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="customer-import-template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 国家列表 ==========
export const getCountries = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    success(res, await customerService.getCountries());
  } catch (err) {
    handleFailure(err, res, next);
  }
};

// ========== 更新客户标签 ==========
export const updateTags = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // V1.0 入参校验：tags 归一为 string[]（字符串兼容，按 `,` / `，` 拆分）
    const { tags } = z.object({ tags: tagsField }).parse(req.body);
    success(res, await customerService.updateTags(req.params.id, tags, buildActorContext(req)), "标签更新成功");
  } catch (err) {
    handleFailure(err, res, next, true);
  }
};

// ========== 报告统计 ==========
export const getReportStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    success(res, await customerService.getReportStats(buildActorContext(req)));
  } catch (err) {
    handleFailure(err, res, next);
  }
};

/**
 * GET /api/customers/:id/logs —— 客户操作记录（详情「跟进动态」Tab 数据源）。
 * 按 `OperationLog.customerId = 客户 id` 捞取；客户不可见时返回 `{ code: 'NOT_FOUND' }`（既有契约，200）。
 */
export const getCustomerLogs = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    success(res, await customerService.getCustomerLogs(req.params.id, buildActorContext(req)));
  } catch (err) {
    handleFailure(err, res, next);
  }
};
