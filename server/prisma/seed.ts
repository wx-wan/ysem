/**
 * ============================================================================
 * YSEM V1.0 · System Seed
 * ============================================================================
 * 目标：只初始化「系统运行必需」的基线数据，不产生任何业务数据。
 *
 * 覆盖范围（System Master Data）：
 *   1. Department      组织架构基线（总部 + 5 个业务部门）
 *   2. Role            角色基线（admin / business / purchaser / user）
 *   3. Permission      权限基线（与 V1.0 前端菜单 + 后端 requirePerm 全量对齐）
 *   4. RolePermission  角色-权限授予（admin 全量；其余按最小可用集合）
 *   5. User            仅创建 1 个管理员（密码由环境变量注入）
 *   6. NumberSequence  编号序列基线（15 个 code，currentValue = 0）
 *   7. Channel         获客渠道基线（3 平台 + 6 店铺）
 *   8. CustomerType / ProductCraft / ProductAudience / ProductCategory 主数据
 *
 * 明确不初始化（禁止）：
 *   ApprovalConfig · DailyExchangeRate · 以及全部业务数据
 *   (Lead / Customer / Opportunity / Quotation / SampleOrder / SalesOrder /
 *    ProductionOrder / PurchaseOrder / Shipment / Payment / Profit /
 *    Product / Supplier / Certificate / ComboProduct)
 *
 * 设计约束：
 *   · 全流程包裹在单个 Prisma 交互式事务中：全成功 COMMIT，任一失败 ROLLBACK。
 *   · 幂等：反复执行不产生重复数据；仅更新显式白名单字段；
 *           不重置管理员密码、不重置编号序列计数、不执行任何 deleteMany。
 *   · 安全：不内置任何默认密码；ADMIN_PASSWORD 缺失时直接失败。
 * ============================================================================
 */
import { MasterStatus, Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

// ---------------------------------------------------------------------------
// 环境变量加载
// 修复：原 `dotenv.config({ path: '../.env' })` 依赖进程 cwd，
//       当 cwd = server/ 时解析为 <repo>/.env（不存在），
//       导致 `npm run db:seed` 与 `npx prisma db seed` 行为不一致。
// 现按「脚本目录 → cwd」顺序加载，两种入口结果一致。
// ---------------------------------------------------------------------------
const ENV_CANDIDATES = [
  path.resolve(__dirname, '../.env'), // server/prisma/../.env  → server/.env
  path.resolve(process.cwd(), '.env'), // cwd 为 server/ 时
  path.resolve(process.cwd(), 'server/.env'), // cwd 为仓库根时
];
for (const envPath of ENV_CANDIDATES) {
  // dotenv 默认不覆盖已存在的变量，因此先命中者生效
  dotenv.config({ path: envPath });
}

const prisma = new PrismaClient();

// ===========================================================================
// 一、声明式基线定义
// ===========================================================================

type PermType = 'MENU' | 'BUTTON';

interface PermissionSeed {
  code: string;
  name: string;
  type: PermType;
  path?: string;
  icon?: string;
  sort: number;
  /** 父级权限 code；分组节点为 undefined */
  parent?: string;
}

/**
 * 权限基线（56 项）。
 * 命名规范：`模块:动作`（分组节点与 V1.0 前端已硬编码的页面 code 除外）。
 * 说明：下列 code 必须与 client/src/App.tsx、client/src/layouts/MainLayout.tsx、
 *       client/src/pages/*、server/src/routes/* 中硬编码的 code 完全一致，
 *       否则对应菜单/按钮/接口对非 admin 角色永久不可达。
 */
const PERMISSIONS: PermissionSeed[] = [
  // ---------- 工作台 ----------
  { code: 'dashboard', name: '工作台', type: 'MENU', path: '/dashboard', icon: 'DashboardOutlined', sort: 0 },

  // ---------- 客户中心 ----------
  { code: 'customer-center', name: '客户中心', type: 'MENU', path: '/data/customers', icon: 'TeamOutlined', sort: 1 },
  { code: 'customers', name: '客户管理', type: 'MENU', path: '/data/customers', icon: 'TeamOutlined', sort: 1, parent: 'customer-center' },

  // ---------- 产品中心 ----------
  { code: 'product-center', name: '产品中心', type: 'MENU', path: '/data/products', icon: 'AppstoreOutlined', sort: 2 },
  { code: 'products', name: '产品管理', type: 'MENU', path: '/data/products', icon: 'AppstoreOutlined', sort: 1, parent: 'product-center' },
  { code: 'materials', name: '物料管理', type: 'MENU', path: '/data/materials', icon: 'ContainerOutlined', sort: 2, parent: 'product-center' },
  { code: 'bom', name: 'BOM 管理', type: 'MENU', path: '/data/bom', icon: 'ProfileOutlined', sort: 3, parent: 'product-center' },
  { code: 'craft', name: '工艺管理', type: 'MENU', path: '/data/craft', icon: 'ExperimentOutlined', sort: 4, parent: 'product-center' },
  { code: 'suppliers', name: '供应商管理', type: 'MENU', path: '/data/suppliers', icon: 'TeamOutlined', sort: 5, parent: 'product-center' },
  { code: 'product:taxonomy:view', name: '产品档案', type: 'MENU', path: '/setting/archive', icon: 'AppstoreOutlined', sort: 6, parent: 'product-center' },
  { code: 'product:taxonomy:create', name: '产品档案新增', type: 'BUTTON', sort: 1, parent: 'product:taxonomy:view' },
  { code: 'product:taxonomy:update', name: '产品档案编辑', type: 'BUTTON', sort: 2, parent: 'product:taxonomy:view' },
  { code: 'product:taxonomy:delete', name: '产品档案删除', type: 'BUTTON', sort: 3, parent: 'product:taxonomy:view' },
  { code: 'certificate:create', name: '证书新增', type: 'BUTTON', sort: 7, parent: 'product-center' },
  { code: 'certificate:update', name: '证书编辑', type: 'BUTTON', sort: 8, parent: 'product-center' },
  { code: 'certificate:delete', name: '证书删除', type: 'BUTTON', sort: 9, parent: 'product-center' },

  // ---------- 销售中心 ----------
  { code: 'sales-center', name: '销售中心', type: 'MENU', path: '/sales', icon: 'ShoppingCartOutlined', sort: 3 },
  { code: 'sales', name: '销售总览', type: 'MENU', path: '/sales', icon: 'ShoppingCartOutlined', sort: 1, parent: 'sales-center' },
  { code: 'sales:leads', name: '线索', type: 'MENU', path: '/sales/leads', icon: 'ProjectOutlined', sort: 2, parent: 'sales-center' },
  { code: 'sales:opportunities', name: '商机', type: 'MENU', path: '/sales/opportunities', icon: 'ThunderboltOutlined', sort: 3, parent: 'sales-center' },
  { code: 'sales:quotes', name: '报价', type: 'MENU', path: '/sales/quotes', icon: 'SolutionOutlined', sort: 4, parent: 'sales-center' },
  { code: 'sales:design', name: '设计', type: 'MENU', path: '/sales/design', icon: 'BgColorsOutlined', sort: 5, parent: 'sales-center' },
  { code: 'sales:samples', name: '打样', type: 'MENU', path: '/sales/samples', icon: 'ExperimentOutlined', sort: 6, parent: 'sales-center' },
  { code: 'sales:orders', name: '销售订单', type: 'MENU', path: '/sales/orders', icon: 'ShoppingCartOutlined', sort: 7, parent: 'sales-center' },

  // ---------- 生产中心 ----------
  { code: 'production-center', name: '生产中心', type: 'MENU', path: '/supply/production', icon: 'ToolOutlined', sort: 4 },
  { code: 'purchase', name: '采购管理', type: 'MENU', path: '/supply/purchase', icon: 'ShopOutlined', sort: 1, parent: 'production-center' },
  { code: 'production', name: '生产管理', type: 'MENU', path: '/supply/production', icon: 'UnorderedListOutlined', sort: 2, parent: 'production-center' },
  { code: 'inventory', name: '库存管理', type: 'MENU', path: '/supply/inventory', icon: 'ContainerOutlined', sort: 3, parent: 'production-center' },
  { code: 'shipment', name: '出运管理', type: 'MENU', path: '/logistics/shipment', icon: 'SendOutlined', sort: 4, parent: 'production-center' },

  // ---------- 财务中心 ----------
  { code: 'finance-center', name: '财务中心', type: 'MENU', path: '/finance/settlement', icon: 'DollarOutlined', sort: 5 },
  { code: 'sales:settlement', name: '结算管理', type: 'MENU', path: '/finance/settlement', icon: 'FileDoneOutlined', sort: 1, parent: 'finance-center' },

  // ---------- 系统管理 ----------
  { code: 'system', name: '系统管理', type: 'MENU', path: '/setting', icon: 'SettingOutlined', sort: 6 },
  { code: 'system:user', name: '用户管理', type: 'MENU', path: '/setting/user', icon: 'UserOutlined', sort: 1, parent: 'system' },
  { code: 'system:user:create', name: '用户新增', type: 'BUTTON', sort: 1, parent: 'system:user' },
  { code: 'system:user:edit', name: '用户编辑', type: 'BUTTON', sort: 2, parent: 'system:user' },
  { code: 'system:user:delete', name: '用户删除', type: 'BUTTON', sort: 3, parent: 'system:user' },
  { code: 'system:user:resetpwd', name: '重置密码', type: 'BUTTON', sort: 4, parent: 'system:user' },
  { code: 'system:role', name: '角色管理', type: 'MENU', path: '/setting/user', icon: 'TeamOutlined', sort: 2, parent: 'system' },
  { code: 'system:role:create', name: '角色新增', type: 'BUTTON', sort: 1, parent: 'system:role' },
  { code: 'system:role:edit', name: '角色编辑', type: 'BUTTON', sort: 2, parent: 'system:role' },
  { code: 'system:role:delete', name: '角色删除', type: 'BUTTON', sort: 3, parent: 'system:role' },
  { code: 'system:dept', name: '部门管理', type: 'MENU', path: '/setting/user', icon: 'ApartmentOutlined', sort: 3, parent: 'system' },
  { code: 'system:dept:create', name: '部门新增', type: 'BUTTON', sort: 1, parent: 'system:dept' },
  { code: 'system:dept:edit', name: '部门编辑', type: 'BUTTON', sort: 2, parent: 'system:dept' },
  { code: 'system:dept:delete', name: '部门删除', type: 'BUTTON', sort: 3, parent: 'system:dept' },
  { code: 'system:perm', name: '权限管理', type: 'MENU', path: '/setting/perm', icon: 'SafetyOutlined', sort: 4, parent: 'system' },
  { code: 'system:perm:create', name: '权限新增', type: 'BUTTON', sort: 1, parent: 'system:perm' },
  { code: 'system:perm:edit', name: '权限编辑', type: 'BUTTON', sort: 2, parent: 'system:perm' },
  { code: 'system:perm:delete', name: '权限删除', type: 'BUTTON', sort: 3, parent: 'system:perm' },
  { code: 'system:channel', name: '渠道管理', type: 'MENU', path: '/setting/channel', icon: 'ApiOutlined', sort: 5, parent: 'system' },
  { code: 'system:channel:edit', name: '渠道编辑', type: 'BUTTON', sort: 1, parent: 'system:channel' },
  { code: 'system:customer-type', name: '客户类型', type: 'MENU', path: '/setting/customer-type', icon: 'TagsOutlined', sort: 6, parent: 'system' },
  { code: 'system:customer-type:edit', name: '客户类型编辑', type: 'BUTTON', sort: 1, parent: 'system:customer-type' },
  { code: 'system:approval', name: '审批管理', type: 'MENU', path: '/setting/approval', icon: 'NodeIndexOutlined', sort: 7, parent: 'system' },
  { code: 'system:approval:edit', name: '审批编辑', type: 'BUTTON', sort: 1, parent: 'system:approval' },
  { code: 'system:logs', name: '操作日志', type: 'MENU', path: '/setting/logs', icon: 'BarChartOutlined', sort: 8, parent: 'system' },
];

interface RoleSeed {
  code: string;
  name: string;
  description: string;
  sort: number;
  dataScope: 'ALL' | 'DEPT' | 'SELF';
}

const ROLES: RoleSeed[] = [
  { code: 'admin', name: '超级管理员', description: '系统超级管理员，拥有全部权限', sort: 0, dataScope: 'ALL' },
  { code: 'business', name: '业务人员', description: '业务人员：线索、商机、报价、设计、打样、销售订单', sort: 1, dataScope: 'SELF' },
  { code: 'purchaser', name: '采购人员', description: '采购人员：采购、生产、库存、出运；供货模式仅可选轻定制/成品现货', sort: 2, dataScope: 'SELF' },
  { code: 'user', name: '普通用户', description: '普通用户：仅可查看工作台与客户基础信息', sort: 3, dataScope: 'SELF' },
];

/**
 * 角色 → 权限授予规则。
 * 'admin' 使用通配 `*` 表示全量；其余角色只需声明「叶子 code」，
 * 其祖先节点由 grantLeafCodes() 自动补齐，保证权限树不出现悬空子节点。
 */
const ROLE_PERMISSION_CODES: Record<string, string[]> = {
  admin: ['*'],
  business: [
    'dashboard',
    'customers',
    'products',
    'craft',
    'product:taxonomy:view',
    'sales',
    'sales:leads',
    'sales:opportunities',
    'sales:quotes',
    'sales:design',
    'sales:samples',
    'sales:orders',
    'purchase',
    'production',
    'inventory',
    'shipment',
    'sales:settlement',
  ],
  purchaser: [
    'dashboard',
    'products',
    'materials',
    'bom',
    'craft',
    'suppliers',
    'purchase',
    'production',
    'inventory',
    'shipment',
    'sales:orders',
  ],
  user: ['dashboard', 'customers'],
};

interface DepartmentSeed {
  code: string;
  name: string;
  sort: number;
}

const DEPARTMENT_ROOT: DepartmentSeed = { code: 'ROOT', name: '总部', sort: 0 };
const DEPARTMENTS: DepartmentSeed[] = [
  { code: 'SALES', name: '销售部', sort: 1 },
  { code: 'ENGINEERING', name: '工程部', sort: 2 },
  { code: 'PROD', name: '生产部', sort: 3 },
  { code: 'PURCH', name: '采购部', sort: 4 },
  { code: 'FIN', name: '财务部', sort: 5 },
];

interface NumberSequenceSeed {
  code: string;
  name: string;
  prefix: string;
  datePattern?: string;
  padding?: number;
}

/**
 * 编号序列基线（15 个）。
 *
 * ⚠️ 格式冻结（Round 3B-3-4-0A）：本表是 V1.0 全部业务编号的唯一权威格式基准，
 * 供后续 NumberSequence Runtime 消费。`code` 为系统内部 sequence key，
 * **不要求等于最终编号 prefix**（如 OPP → BO、QUO → QU、SMP → SM、SHP → SH、
 * INS → QC、PAY → PY、PRF → PF）。
 *
 * 语义约定：PO = ProductionOrder、PR = PurchaseOrder、LEAD 使用 yyyyMM、其余 yyyyMMdd、
 * padding 统一为 4。Runtime 尚未接入；业务 controller 当前仍沿用旧前缀，
 * 其迁移属于后续 NumberSequence Runtime 轮次。
 *
 * 首次 currentValue = 0，后续运行不重置计数。
 */
const NUMBER_SEQUENCES: NumberSequenceSeed[] = [
  { code: 'LEAD', name: '线索编号', prefix: 'XS', datePattern: 'yyyyMM', padding: 4 },
  { code: 'OPP', name: '商机编号', prefix: 'BO', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'QUO', name: '报价单编号', prefix: 'QU', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'SMP', name: '打样单编号', prefix: 'SM', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'SO', name: '销售订单编号', prefix: 'SO', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'PO', name: '生产订单编号', prefix: 'PO', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'PR', name: '采购订单编号', prefix: 'PR', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'SHP', name: '出货单编号', prefix: 'SH', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'INS', name: '质检单编号', prefix: 'QC', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'PAY', name: '收付款编号', prefix: 'PY', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'PRF', name: '利润单编号', prefix: 'PF', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'CUS', name: '客户编号', prefix: 'CUS', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'PRD', name: '产品编号', prefix: 'PRD', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'SUP', name: '供应商编号', prefix: 'SUP', datePattern: 'yyyyMMdd', padding: 4 },
  { code: 'CMB', name: '组合产品编号', prefix: 'CMB', datePattern: 'yyyyMMdd', padding: 4 },
];

interface ChannelSeed {
  name: string;
  category: 'ONLINE' | 'OFFLINE';
  shops: string[];
}

/** 渠道基线：3 个平台 + 6 个店铺（平台 parentId = null） */
const CHANNELS: ChannelSeed[] = [
  { name: '国际站', category: 'ONLINE', shops: ['寿春店', '微它店'] },
  { name: '1688', category: 'ONLINE', shops: ['微它店', '景元店'] },
  { name: '展会', category: 'OFFLINE', shops: ['广交会', '义博会'] },
];

/**
 * 客户类型基线：按**业务形态**分类（启用项，出现在下拉中的顺序即 sort 升序）。
 * `name` 即 `Customer.customerType` / `Lead.customerType` 的存储值（有意不建外键）。
 */
const CUSTOMER_TYPES = [
  { name: '跨境电商类型', sort: 0 },
  { name: '传统商超类型', sort: 1 },
  { name: '品牌 & 代工类型', sort: 2 },
  { name: '教育文旅类型', sort: 3 },
  { name: '渠道分销 & 代理类', sort: 4 },
  { name: '政企 & 单位采购类', sort: 5 },
  { name: '传统贸易类型', sort: 6 },
];

/**
 * 历史客户类型（按生命周期分类）：不再出现在启用列表，但**只停用不删除** ——
 * 保留主数据行以便历史 `Customer.customerType` / `Lead.customerType` 字符串仍有对照。
 */
const CUSTOMER_TYPES_RETIRED = ['意向客户', '成交客户', '战略客户', '流失客户'];

const PRODUCT_CRAFTS = [
  { name: '搪胶', code: 'TJ', sort: 1 },
  { name: '注塑', code: 'ZS', sort: 2 },
  { name: '硅胶', code: 'GJ', sort: 3 },
];

const PRODUCT_AUDIENCES = [
  {
    name: '儿童',
    code: 'ET',
    sort: 0,
    categories: ['沐浴玩具', '挤压玩具', '存钱罐', '摆件', '益智玩具', '安抚玩具', '节日玩具', '沙滩玩具'],
  },
  {
    name: '宠物',
    code: 'CW',
    sort: 1,
    categories: ['宠物益智啃咬玩具', '抛掷球类玩具', '宠物发声玩具', '宠物碗及喂食器', '宠物便携包及出行用品', '宠物清洁美容产品'],
  },
  { name: '配件', code: 'PJ', sort: 2, categories: ['脸皮', '新品类'] },
  { name: '文具', code: 'WJ', sort: 3, categories: ['印章', '笔', '笔筒'] },
  { name: '家居', code: 'JJ', sort: 4, categories: ['杯套', '门档', '沥水篮'] },
];

// ===========================================================================
// 二、Seed 步骤
// ===========================================================================

/** 计算权限深度，保证父级先于子级写入（parentId 才能正确解析） */
function permissionDepth(code: string, byCode: Map<string, PermissionSeed>): number {
  const perm = byCode.get(code);
  if (!perm?.parent) return 0;
  return 1 + permissionDepth(perm.parent, byCode);
}

async function seedDepartments(tx: Prisma.TransactionClient): Promise<void> {
  const root = await tx.department.upsert({
    where: { code: DEPARTMENT_ROOT.code },
    update: { name: DEPARTMENT_ROOT.name, sort: DEPARTMENT_ROOT.sort, parentId: null },
    create: { code: DEPARTMENT_ROOT.code, name: DEPARTMENT_ROOT.name, sort: DEPARTMENT_ROOT.sort },
  });

  for (const dept of DEPARTMENTS) {
    await tx.department.upsert({
      where: { code: dept.code },
      update: { name: dept.name, sort: dept.sort, parentId: root.id },
      create: { code: dept.code, name: dept.name, sort: dept.sort, parentId: root.id },
    });
  }
}

async function seedRoles(tx: Prisma.TransactionClient): Promise<Map<string, string>> {
  const roleIdByCode = new Map<string, string>();
  for (const role of ROLES) {
    const saved = await tx.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description, sort: role.sort, dataScope: role.dataScope },
      create: { code: role.code, name: role.name, description: role.description, sort: role.sort, dataScope: role.dataScope },
    });
    roleIdByCode.set(role.code, saved.id);
  }
  return roleIdByCode;
}

async function seedPermissions(tx: Prisma.TransactionClient): Promise<Map<string, string>> {
  const byCode = new Map(PERMISSIONS.map((p) => [p.code, p]));
  const ordered = [...PERMISSIONS].sort(
    (a, b) => permissionDepth(a.code, byCode) - permissionDepth(b.code, byCode),
  );

  const permIdByCode = new Map<string, string>();
  for (const perm of ordered) {
    const parentId = perm.parent ? permIdByCode.get(perm.parent) ?? null : null;
    const saved = await tx.permission.upsert({
      where: { code: perm.code },
      update: {
        name: perm.name,
        type: perm.type,
        path: perm.path ?? null,
        icon: perm.icon ?? null,
        sort: perm.sort,
        parentId,
      },
      create: {
        code: perm.code,
        name: perm.name,
        type: perm.type,
        path: perm.path ?? null,
        icon: perm.icon ?? null,
        sort: perm.sort,
        parentId,
      },
    });
    permIdByCode.set(perm.code, saved.id);
  }
  return permIdByCode;
}

/** 展开叶子 code：补齐全部祖先节点（上级分组/菜单） */
function expandWithAncestors(leafCodes: string[]): Set<string> {
  const byCode = new Map(PERMISSIONS.map((p) => [p.code, p]));
  const result = new Set<string>();
  for (const code of leafCodes) {
    let current: string | undefined = code;
    while (current) {
      result.add(current);
      current = byCode.get(current)?.parent;
    }
  }
  return result;
}

async function seedRolePermissions(
  tx: Prisma.TransactionClient,
  roleIdByCode: Map<string, string>,
  permIdByCode: Map<string, string>,
): Promise<number> {
  let granted = 0;
  for (const [roleCode, codes] of Object.entries(ROLE_PERMISSION_CODES)) {
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) continue;

    const targetCodes = codes.includes('*') ? PERMISSIONS.map((p) => p.code) : [...expandWithAncestors(codes)];
    for (const code of targetCodes) {
      const permissionId = permIdByCode.get(code);
      if (!permissionId) continue;
      await tx.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
      granted += 1;
    }
  }
  return granted;
}

async function seedAdminUser(tx: Prisma.TransactionClient, roleId: string, departmentId: string): Promise<string> {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const realName = process.env.ADMIN_NAME || '系统管理员';
  const email = process.env.ADMIN_EMAIL || 'admin@ysem.com';
  // ADMIN_PASSWORD 已由 main() 前置校验，此处断言非空
  const password = process.env.ADMIN_PASSWORD as string;
  const hashedPassword = await bcrypt.hash(password, 12);

  await tx.user.upsert({
    where: { username },
    // 白名单：不更新 password —— 保证重复执行不重置管理员密码
    update: { email, realName, roleId, departmentId },
    create: {
      username,
      password: hashedPassword,
      realName,
      email,
      roleId,
      departmentId,
      status: 'ACTIVE',
    },
  });
  return username;
}

async function seedNumberSequences(tx: Prisma.TransactionClient): Promise<void> {
  for (const seq of NUMBER_SEQUENCES) {
    await tx.numberSequence.upsert({
      where: { code: seq.code },
      // 白名单：不更新 currentPeriod / currentValue / version —— 保证不重置业务计数
      update: {
        name: seq.name,
        prefix: seq.prefix,
        datePattern: seq.datePattern ?? 'yyyyMMdd',
        padding: seq.padding ?? 4,
      },
      create: {
        code: seq.code,
        name: seq.name,
        prefix: seq.prefix,
        datePattern: seq.datePattern ?? 'yyyyMMdd',
        padding: seq.padding ?? 4,
        currentPeriod: '',
        currentValue: 0,
      },
    });
  }
}

async function seedChannels(tx: Prisma.TransactionClient): Promise<void> {
  for (const platform of CHANNELS) {
    // 平台 parentId = null，复合唯一键 [parentId, name] 对 NULL 不生效，故用 findFirst
    const existing = await tx.channel.findFirst({ where: { name: platform.name, parentId: null } });
    const saved = existing
      ? await tx.channel.update({
          where: { id: existing.id },
          data: { category: platform.category, status: MasterStatus.ACTIVE },
        })
      : await tx.channel.create({
          data: { name: platform.name, category: platform.category, status: MasterStatus.ACTIVE, sort: 0 },
        });

    for (let i = 0; i < platform.shops.length; i += 1) {
      const shopName = platform.shops[i];
      await tx.channel.upsert({
        where: { parentId_name: { parentId: saved.id, name: shopName } },
        update: { category: platform.category, status: MasterStatus.ACTIVE, sort: i },
        create: {
          name: shopName,
          category: platform.category,
          status: MasterStatus.ACTIVE,
          sort: i,
          parentId: saved.id,
        },
      });
    }
  }
}

async function seedCustomerTypes(tx: Prisma.TransactionClient): Promise<void> {
  for (const ct of CUSTOMER_TYPES) {
    // isActive 显式置 true：可重复执行的 seed 在被人工停用后能恢复为启用基线
    await tx.customerType.upsert({
      where: { name: ct.name },
      update: { sort: ct.sort, isActive: true },
      create: { name: ct.name, sort: ct.sort, isActive: true },
    });
  }

  // 历史类型仅停用（保留行）：避免历史 Customer/Lead 的 customerType 字符串失去主数据对照
  await tx.customerType.updateMany({
    where: { name: { in: [...CUSTOMER_TYPES_RETIRED] } },
    data: { isActive: false },
  });
}

async function seedProductMasterData(tx: Prisma.TransactionClient): Promise<void> {
  for (const craft of PRODUCT_CRAFTS) {
    await tx.productCraft.upsert({
      where: { name: craft.name },
      update: { code: craft.code, sort: craft.sort },
      create: { name: craft.name, code: craft.code, sort: craft.sort, status: MasterStatus.ACTIVE },
    });
  }

  for (const aud of PRODUCT_AUDIENCES) {
    const audience = await tx.productAudience.upsert({
      where: { name: aud.name },
      update: { code: aud.code, sort: aud.sort },
      create: { name: aud.name, code: aud.code, sort: aud.sort, status: MasterStatus.ACTIVE },
    });

    for (let i = 0; i < aud.categories.length; i += 1) {
      await tx.productCategory.upsert({
        where: { audienceId_name: { audienceId: audience.id, name: aud.categories[i] } },
        update: { sort: i },
        create: { name: aud.categories[i], audienceId: audience.id, sort: i, status: MasterStatus.ACTIVE },
      });
    }
  }
}

// ===========================================================================
// 三、入口
// ===========================================================================

async function main(): Promise<void> {
  // 安全前置：管理员密码必须由环境变量注入，禁止内置默认密码
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD is required');
  }

  console.log('🌱 [YSEM V1.0] 开始初始化系统基线数据...');

  const result = await prisma.$transaction(
    async (tx) => {
      await seedDepartments(tx);
      const roleIdByCode = await seedRoles(tx);
      const permIdByCode = await seedPermissions(tx);
      const granted = await seedRolePermissions(tx, roleIdByCode, permIdByCode);

      const rootDept = await tx.department.findUniqueOrThrow({ where: { code: DEPARTMENT_ROOT.code } });
      const adminUsername = await seedAdminUser(tx, roleIdByCode.get('admin')!, rootDept.id);

      await seedNumberSequences(tx);
      await seedChannels(tx);
      await seedCustomerTypes(tx);
      await seedProductMasterData(tx);

      return {
        adminUsername,
        departments: 1 + DEPARTMENTS.length,
        roles: ROLES.length,
        permissions: PERMISSIONS.length,
        rolePermissions: granted,
        numberSequences: NUMBER_SEQUENCES.length,
        channels: CHANNELS.reduce((sum, c) => sum + 1 + c.shops.length, 0),
        customerTypes: CUSTOMER_TYPES.length,
        crafts: PRODUCT_CRAFTS.length,
        audiences: PRODUCT_AUDIENCES.length,
        categories: PRODUCT_AUDIENCES.reduce((sum, a) => sum + a.categories.length, 0),
      };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  console.log('✅ 系统基线数据初始化完成（事务已提交）');
  console.log(`   Department      : ${result.departments}`);
  console.log(`   Role            : ${result.roles}`);
  console.log(`   Permission      : ${result.permissions}`);
  console.log(`   RolePermission  : ${result.rolePermissions}`);
  console.log(`   NumberSequence  : ${result.numberSequences}`);
  console.log(`   Channel         : ${result.channels}`);
  console.log(`   CustomerType    : ${result.customerTypes}`);
  console.log(`   ProductCraft    : ${result.crafts}`);
  console.log(`   ProductAudience : ${result.audiences}`);
  console.log(`   ProductCategory : ${result.categories}`);
  console.log(`   管理员账号      : ${result.adminUsername}（密码由 ADMIN_PASSWORD 环境变量注入，未打印）`);
}

main()
  .catch((e) => {
    console.error('❌ 系统基线数据初始化失败，事务已回滚：');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
