import { matchPath } from 'react-router-dom';

/**
 * 应用菜单定义 + 权限过滤纯函数。
 *
 * **唯一来源**：`server/prisma/seed.ts` 中 `type: 'MENU'` 的权限码（共 34 个，
 * 其 code / name / path / parent 均逐字取自 seed），未自造任何权限码或路径。
 *
 * 边界（Round F-3 §4）：菜单权限**只控制 UI 是否显示**。
 * 后端才是最终授权与数据范围权威 —— 例如 customers / sales / products / quotations /
 * 履约单据的 route 并无 requirePerm，hasPerm('customers') 仅决定菜单是否出现，
 * 不代表用户一定能访问全部 Customer API。前端不复制 roleScope()。
 *
 * 说明：seed 中菜单项带 icon 名称（服务端字段），本轮不使用图标 ——
 * 避免引入未在本工程声明的额外依赖（@ant-design/icons），也不影响导航正确性。
 */

export interface AppMenuItem {
  key: string;
  label: string;
  path?: string;
  /** 后端真实菜单权限码；缺省表示登录后公共导航 */
  permission?: string;
  children?: AppMenuItem[];
}

export interface MenuPermissionContext {
  hasPerm: (code: string) => boolean;
}

/** 菜单树原始定义（结构 = seed 的 parent 关系；顺序 = seed 的 sort；path 暂沿用 seed 值） */
const MENU_SOURCE: AppMenuItem[] = [
  { key: 'dashboard', label: '工作台', path: '/dashboard', permission: 'dashboard' },
  {
    key: 'customer-center',
    label: '客户中心',
    path: '/data/customers',
    permission: 'customer-center',
    children: [{ key: 'customers', label: '客户管理', path: '/data/customers', permission: 'customers' }],
  },
  {
    key: 'product-center',
    label: '产品中心',
    path: '/data/products',
    permission: 'product-center',
    children: [
      { key: 'products', label: '产品管理', path: '/data/products', permission: 'products' },
      { key: 'materials', label: '物料管理', path: '/data/materials', permission: 'materials' },
      { key: 'bom', label: 'BOM 管理', path: '/data/bom', permission: 'bom' },
      { key: 'craft', label: '工艺管理', path: '/data/craft', permission: 'craft' },
      { key: 'suppliers', label: '供应商管理', path: '/data/suppliers', permission: 'suppliers' },
      { key: 'product:taxonomy:view', label: '产品档案', path: '/setting/archive', permission: 'product:taxonomy:view' },
    ],
  },
  {
    key: 'sales-center',
    label: '销售中心',
    path: '/sales',
    permission: 'sales-center',
    children: [
      { key: 'sales', label: '销售总览', path: '/sales', permission: 'sales' },
      { key: 'sales:leads', label: '线索', path: '/sales/leads', permission: 'sales:leads' },
      { key: 'sales:opportunities', label: '商机', path: '/sales/opportunities', permission: 'sales:opportunities' },
      { key: 'sales:quotes', label: '报价', path: '/sales/quotes', permission: 'sales:quotes' },
      { key: 'sales:design', label: '设计', path: '/sales/design', permission: 'sales:design' },
      { key: 'sales:samples', label: '打样', path: '/sales/samples', permission: 'sales:samples' },
      { key: 'sales:orders', label: '销售订单', path: '/sales/orders', permission: 'sales:orders' },
    ],
  },
  {
    key: 'production-center',
    label: '生产中心',
    path: '/supply/production',
    permission: 'production-center',
    children: [
      { key: 'purchase', label: '采购管理', path: '/supply/purchase', permission: 'purchase' },
      { key: 'production', label: '生产管理', path: '/supply/production', permission: 'production' },
      { key: 'inventory', label: '库存管理', path: '/supply/inventory', permission: 'inventory' },
      { key: 'shipment', label: '出运管理', path: '/logistics/shipment', permission: 'shipment' },
    ],
  },
  {
    key: 'finance-center',
    label: '财务中心',
    path: '/finance/settlement',
    permission: 'finance-center',
    children: [
      { key: 'sales:settlement', label: '结算管理', path: '/finance/settlement', permission: 'sales:settlement' },
    ],
  },
  {
    key: 'system',
    label: '系统管理',
    path: '/setting',
    permission: 'system',
    children: [
      // ↓ 三者 seed path 均为 /setting/user，前端由 FRONTEND_PATH_OVERRIDES 映射为独立入口（F-3.1）
      { key: 'system:user', label: '用户管理', path: '/setting/user', permission: 'system:user' },
      { key: 'system:role', label: '角色管理', path: '/setting/user', permission: 'system:role' },
      { key: 'system:dept', label: '部门管理', path: '/setting/user', permission: 'system:dept' },
      { key: 'system:perm', label: '权限管理', path: '/setting/perm', permission: 'system:perm' },
      { key: 'system:channel', label: '渠道管理', path: '/setting/channel', permission: 'system:channel' },
      { key: 'system:customer-type', label: '客户类型', path: '/setting/customer-type', permission: 'system:customer-type' },
      { key: 'system:approval', label: '审批管理', path: '/setting/approval', permission: 'system:approval' },
      { key: 'system:logs', label: '操作日志', path: '/setting/logs', permission: 'system:logs' },
    ],
  },
];

/**
 * 前端路由映射（Round F-3.1）—— **权限码仍是唯一菜单来源，但 seed 的 path 不强制等于前端 route**。
 *
 * 根因：seed 中 system:user / system:role / system:dept 三个不同 MENU 权限码共用同一 path
 * `/setting/user`，前端若照搬该 path 会导致三者路由冲突（点击「角色管理」「部门管理」仍停在
 * `/setting/user`，且无法区分选中项）。因此在前端 normalization 层为它们指定独立入口。
 *
 * 注意：仅调整**前端导航路径**，不修改 seed、不修改后端（/api/roles、/api/departments 本轮亦不接入）。
 */
export const FRONTEND_PATH_OVERRIDES: Record<string, string> = {
  'system:user': '/setting/user',
  'system:role': '/setting/role',
  'system:dept': '/setting/department',
};

/** 按 permission code 应用前端路由覆盖（递归，纯函数；无覆盖时保持原 path） */
export function normalizeMenuPaths(menu: AppMenuItem[]): AppMenuItem[] {
  return menu.map((item) => {
    const path = item.permission && FRONTEND_PATH_OVERRIDES[item.permission]
      ? FRONTEND_PATH_OVERRIDES[item.permission]
      : item.path;
    return {
      ...item,
      path,
      children: item.children ? normalizeMenuPaths(item.children) : undefined,
    };
  });
}

/** 应用菜单（已应用前端路由映射；菜单 key / permission 仍为 seed 的真实权限码） */
export const APP_MENU: AppMenuItem[] = normalizeMenuPaths(MENU_SOURCE);

/**
 * 权限过滤（纯函数，无副作用）：
 *   · 无 permission → 可见（登录后公共导航）
 *   · 有 permission → 必须 hasPerm(code) === true
 *   · 有 children 的组：先按自身权限判定，再递归过滤子项；子项全不可见时**整组隐藏**（避免空组）
 */
export function filterMenuByPermission(menu: AppMenuItem[], ctx: MenuPermissionContext): AppMenuItem[] {
  const result: AppMenuItem[] = [];
  for (const item of menu) {
    if (item.permission && !ctx.hasPerm(item.permission)) continue;
    if (item.children && item.children.length > 0) {
      const children = filterMenuByPermission(item.children, ctx);
      if (children.length === 0) continue;
      result.push({ ...item, children });
      continue;
    }
    result.push(item);
  }
  return result;
}

/** 按 key 查项（用于菜单点击 → 取 path） */
export function findMenuItemByKey(menu: AppMenuItem[], key: string): AppMenuItem | undefined {
  for (const item of menu) {
    if (item.key === key) return item;
    if (item.children) {
      const hit = findMenuItemByKey(item.children, key);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * 收集全部唯一 path（用于路由注册）。
 * 同一 path 同时出现在组与叶子时（seed 的 customer-center/customers 均为 /data/customers）
 * 以**叶子**的 label 为准；`group` 为父级 label（用于占位页显示「父级 / 页面」）。
 */
export function collectMenuPaths(menu: AppMenuItem[]): { path: string; label: string; group?: string }[] {
  const found = new Map<string, { path: string; label: string; group?: string; leaf: boolean }>();
  const walk = (items: AppMenuItem[], parentLabel?: string) => {
    for (const item of items) {
      const hasChildren = !!(item.children && item.children.length > 0);
      if (item.path) {
        const current = found.get(item.path);
        if (!current || (!current.leaf && !hasChildren)) {
          found.set(item.path, { path: item.path, label: item.label, group: parentLabel, leaf: !hasChildren });
        }
      }
      if (hasChildren) walk(item.children!, item.label);
    }
  };
  walk(menu);
  return Array.from(found.values()).map(({ path, label, group }) => ({ path, label, group }));
}

/**
 * 当前路由对应的选中菜单 key（Round F-3 §15）：
 * 使用 `matchPath({ path, end: false })` 支持嵌套路由（/sales/leads/xxx → sales:leads）。
 *
 * 命中多条时取 **path 最长者**（最具体）；长度相同时**优先叶子项**——
 * seed 中父组与其首个子项常共用同一 path（customer-center/customers 均为 /data/customers、
 * sales-center/sales 均为 /sales、production-center/production 均为 /supply/production），
 * 而 SubMenu 无法呈现 selected 态，选中父组会导致「无高亮 + 祖先未展开」。
 * 仅当没有任何叶子命中时，才回退到组节点（例如 /setting 仅出现在 system 组上）。
 */
export function findSelectedKey(menu: AppMenuItem[], pathname: string): string | undefined {
  const best = { leaf: undefined as { key: string; length: number } | undefined, any: undefined as { key: string; length: number } | undefined };

  const consider = (slot: 'leaf' | 'any', key: string, length: number) => {
    const cur = best[slot];
    if (!cur || length > cur.length) best[slot] = { key, length };
  };

  const walk = (items: AppMenuItem[]) => {
    for (const item of items) {
      const hasChildren = !!(item.children && item.children.length > 0);
      if (item.path) {
        const matched = matchPath({ path: item.path, end: false }, pathname);
        if (matched) {
          consider('any', item.key, item.path.length);
          if (!hasChildren) consider('leaf', item.key, item.path.length);
        }
      }
      if (hasChildren) walk(item.children!);
    }
  };

  walk(menu);
  return (best.leaf ?? best.any)?.key;
}

/** 选中项的全部祖先 key（用于默认展开） */
export function findAncestorKeys(menu: AppMenuItem[], targetKey: string): string[] {
  const dfs = (items: AppMenuItem[], trail: string[]): string[] | undefined => {
    for (const item of items) {
      if (item.key === targetKey) return trail;
      if (item.children && item.children.length > 0) {
        const hit = dfs(item.children, [...trail, item.key]);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return dfs(menu, []) ?? [];
}
