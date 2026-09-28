import type { IntentLevel, Prisma } from '@prisma/client';
import { getNextNumber } from '../lib/numberSequence';
import { customerRepository } from '../repositories/customer.repository';
import { opportunityRepository } from '../repositories/opportunity.repository';
import { operationLogRepository } from '../repositories/operationLog.repository';
import { runInTransaction } from '../repositories';
import { salesOrderRepository } from '../repositories/salesOrder.repository';
import { sampleOrderRepository } from '../repositories/sampleOrder.repository';
import { userRepository } from '../repositories/user.repository';
import { BUSINESS_TYPE } from '../lib/business-type';

/**
 * Customer Operation Layer（Round R-3 · Customer Pilot）
 *
 * 职责：**多仓储组合 / 跨表数据操作 / 事务编排**。
 * 不负责业务政策判断 —— 「客户是否可创建 / 可编辑 / 可认领」「intentLevel 派生规则」
 * 均由 Business Layer（services/customer.service.ts）决定。
 *
 * 事务边界：本层唯一出现 `$transaction` 的地方（Controller / Business 不出现）。
 */

// ============================================================
// 查询谓词（where 组合，非业务政策）
// ============================================================

/** 当年首次下单：year-01-01 <= firstOrderAt < (year+1)-01-01（按服务端本地日历年度） */
export const firstOrderAtInYear = (year: number) => ({
  gte: new Date(year, 0, 1),
  lt: new Date(year + 1, 0, 1),
});

/** 老客户：有首次下单时间且早于本年度（等价旧「非空且不以今年开头」） */
export const firstOrderAtBeforeYear = (year: number) => ({
  not: null,
  lt: new Date(year, 0, 1),
});

// ============================================================
// 列表 / 详情
// ============================================================

/** 列表：分页查询 + 总数（一次组合，两次查询并行，与既有 `Promise.all` 同结构） */
export async function loadCustomerListPage<I extends Prisma.CustomerInclude>(input: {
  where: Prisma.CustomerWhereInput;
  skip: number;
  take: number;
  include: I;
}): Promise<{ list: Prisma.CustomerGetPayload<{ include: I }>[]; total: number }> {
  const [list, total] = await Promise.all([
    customerRepository.findMany({
      where: input.where,
      skip: input.skip,
      take: input.take,
      // 排序口径：首次下单时间倒序 → 创建时间倒序（列表 / 公海 / 管理员视图一致）
      orderBy: [{ firstOrderAt: 'desc' }, { createdAt: 'desc' }],
      include: input.include,
    }),
    customerRepository.count(input.where),
  ]);
  return { list: list as unknown as Prisma.CustomerGetPayload<{ include: I }>[], total };
}

/** 客户下拉选项（我的私海 + 公海；管理员为全部）：where 由 Business 提供 */
export function loadCustomerOptions(where: Prisma.CustomerWhereInput) {
  return customerRepository.findMany({
    where,
    select: {
      id: true,
      companyName: true,
      contactName: true,
      customerNo: true,
      email: true,
      phone: true,
      country: true,
      customerType: true,
      channelId: true,
      shopId: true,
      contactMethods: true,
      ownerId: true,
    },
    orderBy: { companyName: 'asc' },
  });
}

/** 归属查询（跨全员，不套数据范围）：按公司名精确匹配，仅取主键 + 负责人 */
export function findCustomerByCompanyName(companyName: string) {
  return customerRepository.findFirst({
    where: { companyName },
    select: { id: true, ownerId: true, owner: { select: { realName: true, username: true } } },
  });
}

/** 创建前唯一性检测（去重）：按公司名精确匹配，取主键 + 编号 + 公司名（既有 409 文案依赖 companyName） */
export function findCustomerNameConflict(companyName: string) {
  return customerRepository.findFirst({
    where: { companyName },
    select: { id: true, customerNo: true, companyName: true },
  });
}

/** 客户详情（含订单 / 商机 / 线索的既有投影；字段与顺序逐字沿用） */
export function loadCustomerDetail(where: Prisma.CustomerWhereInput) {
  return customerRepository.findFirst({
    where,
    include: {
      owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
      salesOrders: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNo: true,
          status: true,
          currency: true,
          totalAmount: true,
          totalAmountCny: true,
          paidAmountCny: true,
          orderDate: true,
          deliveryDate: true,
          sampleOrderId: true,
          quotationId: true,
          opportunityId: true,
          remark: true,
          items: {
            orderBy: { sort: 'asc' },
            select: {
              id: true,
              lineNo: true,
              productId: true,
              productName: true,
              spec: true,
              quantity: true,
              unit: true,
              unitPrice: true,
              amount: true,
              currency: true,
            },
          },
          createdAt: true,
        },
      },
      opportunities: {
        orderBy: { createdAt: 'desc' },
        include: { owner: { select: { id: true, username: true, realName: true } } },
      },
      leads: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, leadNo: true, leadName: true, status: true, source: true, createdAt: true },
      },
    },
  });
}

/** 客户归属状态判定所需的读取（仅数据范围条件） */
export function findCustomerScoped(where: Prisma.CustomerWhereInput) {
  return customerRepository.findFirst({ where });
}

/**
 * 客户归属判定 + 商机意向投影（D-INTENT v2：复用既有授权查询附带 opportunities，
 * 不新增查询、不产生 N+1；商机集合不被写路径修改）。
 */
export function findCustomerScopedWithIntent(where: Prisma.CustomerWhereInput) {
  return customerRepository.findFirst({
    where,
    include: { opportunities: { select: { intentLevel: true } } },
  });
}

// ============================================================
// 统计 / 聚合（多仓储组合）
// ============================================================

/** 客户统计：6 个计数聚合 + 1 次商机意向 groupBy + 1 次无订单计数（原 `Promise.all` 结构） */
export async function loadCustomerStats(input: {
  where: Prisma.CustomerWhereInput;
  totalWhere: Prisma.CustomerWhereInput;
  year: number;
}) {
  const { where, totalWhere, year } = input;
  const [total, newCustomers, oldCustomers, keyAccounts, intentGroups, noIntentCount] = await Promise.all([
    customerRepository.count(totalWhere),
    customerRepository.count({ ...where, firstOrderAt: firstOrderAtInYear(year), isKeyAccount: false }),
    customerRepository.count({ ...where, isKeyAccount: false, firstOrderAt: firstOrderAtBeforeYear(year) }),
    customerRepository.count({ ...where, isKeyAccount: true }),
    opportunityRepository.groupCountByCustomerAndIntent({ customer: where }),
    customerRepository.count({ ...where, opportunities: { none: { intentLevel: { not: null } } } }),
  ]);

  // 无订单客户（V1.0：firstOrderAt 为 null）
  const noOrderCount = await customerRepository.count({
    ...where,
    firstOrderAt: null,
    isKeyAccount: false,
  });

  return {
    total,
    newCount: newCustomers,
    oldCount: oldCustomers,
    keyCount: keyAccounts,
    intentGroups,
    noIntentCount,
    noOrderCount,
  };
}

/** 子筛选计数（未成交 A/B/C/D/无商机 + 已成交 新/老），口径与既有逐条一致 */
export async function loadSubFilterCounts(baseWhere: Prisma.CustomerWhereInput) {
  const year = new Date().getFullYear();
  const noOrderWhere: Prisma.CustomerWhereInput = { ...baseWhere, salesOrders: { none: {} } };
  const doneWhere: Prisma.CustomerWhereInput = { ...baseWhere, salesOrders: { some: {} } };
  const [A, B, C, D, none, newC, oldC] = await Promise.all([
    customerRepository.count({ ...noOrderWhere, opportunities: { some: { intentLevel: 'READY' } } }),
    customerRepository.count({
      ...noOrderWhere,
      AND: [
        { opportunities: { some: { intentLevel: 'HIGH' } } },
        { opportunities: { none: { intentLevel: 'READY' } } },
      ],
    }),
    customerRepository.count({
      ...noOrderWhere,
      AND: [
        { opportunities: { some: { intentLevel: 'MEDIUM' } } },
        { opportunities: { none: { intentLevel: 'READY' } } },
        { opportunities: { none: { intentLevel: 'HIGH' } } },
      ],
    }),
    customerRepository.count({
      ...noOrderWhere,
      opportunities: { some: {} },
      AND: [
        { opportunities: { none: { intentLevel: 'READY' } } },
        { opportunities: { none: { intentLevel: 'HIGH' } } },
        { opportunities: { none: { intentLevel: 'MEDIUM' } } },
      ],
    }),
    customerRepository.count({ ...noOrderWhere, opportunities: { none: {} } }),
    customerRepository.count({ ...doneWhere, firstOrderAt: firstOrderAtInYear(year) }),
    customerRepository.count({ ...doneWhere, firstOrderAt: firstOrderAtBeforeYear(year) }),
  ]);
  return {
    noOrderBreakdown: { '': A + B + C + D + none, A, B, C, D, none },
    doneBreakdown: { '': newC + oldC, new: newC, old: oldC },
  };
}

/** 列表页全量聚合（当前筛选条件，非分页）：商机金额 / 成交金额 / 意向分布 / 新老客户成交金额 */
export async function loadListAggregates(input: {
  customerWhere: Prisma.CustomerWhereInput;
  customerAnd: Prisma.CustomerWhereInput[];
  year: number;
}) {
  const { customerWhere, customerAnd, year } = input;
  const [estimatedAgg, totalAmountAgg, estimatedBreakdown, newAmountAgg, oldAmountAgg] = await Promise.all([
    opportunityRepository.sumEstimatedAmountByCustomerWhere(customerWhere),
    salesOrderRepository.sumAmountCnyByCustomerWhere(customerWhere),
    opportunityRepository.groupEstimatedByIntentLevelForCustomerWhere(customerWhere),
    // 新客户成交金额
    salesOrderRepository.sumAmountCnyByCustomerWhere({
      AND: [...customerAnd, { firstOrderAt: firstOrderAtInYear(year) }, { isKeyAccount: false }],
    }),
    // 老客户成交金额
    salesOrderRepository.sumAmountCnyByCustomerWhere({
      AND: [...customerAnd, { isKeyAccount: false }, { firstOrderAt: firstOrderAtBeforeYear(year) }],
    }),
  ]);
  return { estimatedAgg, totalAmountAgg, estimatedBreakdown, newAmountAgg, oldAmountAgg };
}

/** 分页 enrichment：订单金额/最近下单日 + 商机金额（两次 groupBy，避免 N+1） */
export async function loadCustomerEnrichment(customerIds: string[]) {
  if (customerIds.length === 0) return { orderAgg: [], pipelineAgg: [] };
  const [orderAgg, pipelineAgg] = await Promise.all([
    salesOrderRepository.groupAmountByCustomerIds(customerIds),
    opportunityRepository.groupEstimatedAmountByCustomerIds(customerIds),
  ]);
  return { orderAgg, pipelineAgg };
}

/** 业务员列表及客户分布（管理员客户页左栏） */
export function loadAssignees() {
  return userRepository.findActiveAssignees();
}

/** 管理员视图统计：公海数 + 全库 4 计数 */
export async function loadAdminCounts(year: number) {
  const publicCount = await customerRepository.count({ ownerId: null });
  const withOwnerWhere: Prisma.CustomerWhereInput = { ownerId: { not: null } };
  const [totalAll, newAll, oldAll, keyAll] = await Promise.all([
    customerRepository.count(),
    customerRepository.count({
      firstOrderAt: firstOrderAtInYear(year),
      isKeyAccount: false,
      ...withOwnerWhere,
    }),
    customerRepository.count({
      isKeyAccount: false,
      ...withOwnerWhere,
      firstOrderAt: firstOrderAtBeforeYear(year),
    }),
    customerRepository.count({ isKeyAccount: true }),
  ]);
  return { publicCount, totalAll, newAll, oldAll, keyAll };
}

/** 报表统计原始输入（7 查询并行；阶段/B 转化率的计算在 Business 层） */
export async function loadReportStatsData(input: {
  opportunityWhere: Prisma.OpportunityWhereInput;
  customerWhere: Prisma.CustomerWhereInput;
  year: number;
}) {
  const { opportunityWhere, customerWhere, year } = input;
  const [allOpportunities, sampleOrderCount, shippedOrderCount, newCustomerCount, oldCustomerCount, newCustomerOrders, oldCustomerOrders] =
    await Promise.all([
      opportunityRepository.findForStageDerivation(opportunityWhere),
      // V1.0：「下打样单」阶段由 SampleOrder 承载（SalesOrder 无 SAMPLE_ORDER 状态）
      sampleOrderRepository.count(),
      // V1.0：SalesOrderStatus.SHIPPED
      salesOrderRepository.countByStatus('SHIPPED'),
      customerRepository.count({ ...customerWhere, firstOrderAt: firstOrderAtInYear(year) }),
      customerRepository.count({ ...customerWhere, firstOrderAt: firstOrderAtBeforeYear(year) }),
      salesOrderRepository.findAmountsByCustomerWhere({
        ...customerWhere,
        firstOrderAt: firstOrderAtInYear(year),
      }),
      salesOrderRepository.findAmountsByCustomerWhere({
        ...customerWhere,
        firstOrderAt: firstOrderAtBeforeYear(year),
      }),
    ]);
  return {
    allOpportunities,
    sampleOrderCount,
    shippedOrderCount,
    newCustomerCount,
    oldCustomerCount,
    newCustomerOrders,
    oldCustomerOrders,
  };
}

/** 国家下拉数据源 */
export function loadDistinctCountries() {
  return customerRepository.distinctCountries();
}

/** 客户操作记录（只取「对客户本身操作」的记录，按模块隔离） */
export function loadCustomerLogs(customerId: string) {
  return operationLogRepository.findByBusiness(
    { businessType: BUSINESS_TYPE.CUSTOMER, businessId: customerId },
    100,
  );
}

// ============================================================
// 写入（事务编排）
// ============================================================

/**
 * 创建客户（编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞）。
 * 返回新建客户行（无 include，与既有响应一致）。
 */
export async function createCustomerAggregate(
  data: Omit<Prisma.CustomerUncheckedCreateInput, 'customerNo'>,
) {
  return runInTransaction(async (tx) => {
    const customerNo = await getNextNumber(tx, 'CUS');
    return customerRepository.create({ data: { ...data, customerNo } }, tx);
  });
}

/** Excel 逐行导入：逐行独立事务，保留既有「部分成功」语义 */
export async function createImportedCustomer(
  data: Omit<Prisma.CustomerUncheckedCreateInput, 'customerNo'>,
) {
  return runInTransaction(async (tx) => {
    const customerNo = await getNextNumber(tx, 'CUS');
    return customerRepository.create({ data: { ...data, customerNo } }, tx);
  });
}

/** 意向分组的原始形态（Business 层据此派生「最高意向」与分布） */
export type CustomerIntentGroup = {
  customerId: string;
  intentLevel: IntentLevel | null;
  _count: number;
};
