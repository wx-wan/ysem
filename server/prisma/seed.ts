import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始初始化数据库...');

  // 1. 创建默认角色
  const adminRole = await prisma.role.upsert({
    where: { code: 'admin' },
    update: {},
    create: {
      name: '超级管理员',
      code: 'admin',
      description: '系统超级管理员，拥有全部权限',
      sort: 0,
    },
  });

  const userRole = await prisma.role.upsert({
    where: { code: 'user' },
    update: {},
    create: {
      name: '普通用户',
      code: 'user',
      description: '普通用户',
      sort: 1,
    },
  });

  const businessRole = await prisma.role.upsert({
    where: { code: 'business' },
    update: {},
    create: {
      name: '业务人员',
      code: 'business',
      description: '业务人员，可查看仪表盘、销售、客户、订单',
      sort: 2,
    },
  });

  const purchaserRole = await prisma.role.upsert({
    where: { code: 'purchaser' },
    update: {},
    create: {
      name: '采购人员',
      code: 'purchaser',
      description: '采购人员，可查看仪表盘、销售、客户、订单，供货模式仅可选轻定制/成品现货',
      sort: 3,
    },
  });

  // 2. 创建默认权限（菜单 & 按钮）
  const menuPermissions = [
    { name: '仪表盘', code: 'dashboard', type: 'MENU' as const, path: '/dashboard', icon: 'DashboardOutlined', sort: 0 },
    { name: '销售管理', code: 'sales', type: 'MENU' as const, path: '/sales', icon: 'ShoppingOutlined', sort: 1 },
    { name: '产品', code: 'sales:products', type: 'MENU' as const, path: '/sales/products', icon: 'AppstoreOutlined', sort: 10, parent: 'sales' },
    { name: '线索', code: 'sales:leads', type: 'MENU' as const, path: '/sales/leads', icon: 'ProjectOutlined', sort: 11, parent: 'sales' },
    { name: '商机', code: 'sales:opportunities', type: 'MENU' as const, path: '/sales/opportunities', icon: 'ThunderboltOutlined', sort: 12, parent: 'sales' },
    { name: '订单', code: 'sales:orders', type: 'MENU' as const, path: '/sales/orders', icon: 'ShoppingCartOutlined', sort: 13, parent: 'sales' },
    { name: '生产管理', code: 'production', type: 'MENU' as const, path: '/production', icon: 'UnorderedListOutlined', sort: 2 },
    { name: '发货管理', code: 'shipment', type: 'MENU' as const, path: '/shipment', icon: 'SendOutlined', sort: 3 },
    { name: '客户管理', code: 'customers', type: 'MENU' as const, path: '/customers', icon: 'TeamOutlined', sort: 4 },
    { name: '数据报表', code: 'reports', type: 'MENU' as const, path: '/reports', icon: 'BarChartOutlined', sort: 5 },
    { name: '设置', code: 'system', type: 'MENU' as const, path: '/system', icon: 'SettingOutlined', sort: 6 },
    { name: '用户管理', code: 'system:user', type: 'MENU' as const, path: '/system/user', icon: 'UserOutlined', sort: 10, parent: 'system' },
    { name: '角色管理', code: 'system:role', type: 'MENU' as const, path: '/system/role', icon: 'TeamOutlined', sort: 11, parent: 'system' },
    { name: '部门管理', code: 'system:dept', type: 'MENU' as const, path: '/system/dept', icon: 'ApartmentOutlined', sort: 12, parent: 'system' },
    { name: '权限管理', code: 'system:perm', type: 'MENU' as const, path: '/system/perm', icon: 'SafetyOutlined', sort: 13, parent: 'system' },
    { name: '产品分类管理', code: 'product:taxonomy:view', type: 'MENU' as const, path: '/system/product-taxonomy', icon: 'AppstoreOutlined', sort: 14, parent: 'system' },
  ];

  // 先建父级菜单
  for (const perm of menuPermissions) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: {
        name: perm.name,
        code: perm.code,
        type: perm.type,
        path: perm.path,
        icon: perm.icon,
        sort: perm.sort,
        parentId: null,
      },
    });
  }

  // 更新子菜单的 parentId
  for (const perm of menuPermissions) {
    if (perm.parent) {
      const parent = await prisma.permission.findUnique({ where: { code: perm.parent } });
      if (parent) {
        await prisma.permission.update({
          where: { code: perm.code },
          data: { parentId: parent.id },
        });
      }
    }
  }

  // 按钮级权限
  const buttonPermissions = [
    { name: '用户新增', code: 'system:user:create', type: 'BUTTON' as const, sort: 0 },
    { name: '用户编辑', code: 'system:user:edit', type: 'BUTTON' as const, sort: 1 },
    { name: '用户删除', code: 'system:user:delete', type: 'BUTTON' as const, sort: 2 },
    { name: '重置密码', code: 'system:user:resetpwd', type: 'BUTTON' as const, sort: 3 },
    { name: '角色新增', code: 'system:role:create', type: 'BUTTON' as const, sort: 0 },
    { name: '角色编辑', code: 'system:role:edit', type: 'BUTTON' as const, sort: 1 },
    { name: '角色删除', code: 'system:role:delete', type: 'BUTTON' as const, sort: 2 },
    { name: '部门新增', code: 'system:dept:create', type: 'BUTTON' as const, sort: 0 },
    { name: '部门编辑', code: 'system:dept:edit', type: 'BUTTON' as const, sort: 1 },
    { name: '部门删除', code: 'system:dept:delete', type: 'BUTTON' as const, sort: 2 },
    { name: '权限新增', code: 'system:perm:create', type: 'BUTTON' as const, sort: 0 },
    { name: '权限编辑', code: 'system:perm:edit', type: 'BUTTON' as const, sort: 1 },
    { name: '权限删除', code: 'system:perm:delete', type: 'BUTTON' as const, sort: 2 },
    { name: '产品分类新增', code: 'product:taxonomy:create', type: 'BUTTON' as const, sort: 0 },
    { name: '产品分类编辑', code: 'product:taxonomy:update', type: 'BUTTON' as const, sort: 1 },
    { name: '产品分类删除', code: 'product:taxonomy:delete', type: 'BUTTON' as const, sort: 2 },
  ];

  for (const perm of buttonPermissions) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: perm,
    });
  }

  // 3. 为 admin 角色分配所有权限
  const allPermissions = await prisma.permission.findMany();
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    });
  }

  // 为业务人员分配业务菜单权限（仪表盘/销售/客户/订单/报表）
  const businessMenuCodes = ['dashboard', 'sales', 'sales:products', 'sales:leads', 'sales:opportunities', 'sales:orders', 'customers', 'orders', 'production', 'shipment', 'reports'];
  for (const code of businessMenuCodes) {
    const perm = await prisma.permission.findUnique({ where: { code } });
    if (perm) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: businessRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: businessRole.id, permissionId: perm.id },
      });
    }
  }

  // 为采购人员分配业务菜单权限（与业务人员相同，但不含「客户管理」）
  const purchaserMenuCodes = businessMenuCodes.filter((c) => c !== 'customers');
  for (const code of purchaserMenuCodes) {
    const perm = await prisma.permission.findUnique({ where: { code } });
    if (perm) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: purchaserRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: purchaserRole.id, permissionId: perm.id },
      });
    }
  }

  // 为普通用户分配基础菜单权限（仪表盘/客户/报表）
  const userMenuCodes = ['dashboard', 'customers', 'reports'];
  for (const code of userMenuCodes) {
    const perm = await prisma.permission.findUnique({ where: { code } });
    if (perm) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: userRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: userRole.id, permissionId: perm.id },
      });
    }
  }

  // 4. 创建默认部门
  const rootDept = await prisma.department.upsert({
    where: { code: 'ROOT' },
    update: {},
    create: { name: '总公司', code: 'ROOT', sort: 0 },
  });

  await prisma.department.upsert({
    where: { code: 'TECH' },
    update: {},
    create: { name: '技术部', code: 'TECH', parentId: rootDept.id, sort: 1 },
  });

  await prisma.department.upsert({
    where: { code: 'HR' },
    update: {},
    create: { name: '人事部', code: 'HR', parentId: rootDept.id, sort: 2 },
  });

  // 创建默认管理员
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const email = process.env.ADMIN_EMAIL || 'admin@ysem.com';
  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      password: hashedPassword,
      realName: '系统管理员',
      email,
      roleId: adminRole.id,
      departmentId: rootDept.id,
      status: 'ACTIVE',
    },
  });

  // 创建测试业务员
  const bizPwd = await bcrypt.hash('business123', 12);
  await prisma.user.upsert({
    where: { username: 'business' },
    update: {},
    create: {
      username: 'business',
      password: bizPwd,
      realName: '张三',
      email: 'business@ysem.com',
      roleId: businessRole.id,
      departmentId: rootDept.id,
      status: 'ACTIVE',
    },
  });

  // 创建测试采购员
  const purPwd = await bcrypt.hash('purchaser123', 12);
  await prisma.user.upsert({
    where: { username: 'purchaser' },
    update: {},
    create: {
      username: 'purchaser',
      password: purPwd,
      realName: '李四',
      email: 'purchaser@ysem.com',
      roleId: purchaserRole.id,
      departmentId: rootDept.id,
      status: 'ACTIVE',
    },
  });

  console.log('✅ 数据库初始化完成！');
  console.log(`📧 管理员: ${username} / ${password}`);
  console.log(`📧 业务员: business / business123`);
  console.log(`📧 采购员: purchaser / purchaser123`);

  // 5. 初始化产品分类数据
  console.log('🏭 初始化产品分类...');

  // 工艺（基础项，产品侧多选组合，如 搪胶+注塑）；code 用于自动生成 SKU
  const crafts = [
    { name: '搪胶', code: 'TJ', sort: 1 },
    { name: '注塑', code: 'ZS', sort: 2 },
    { name: '硅胶', code: 'GJ', sort: 3 },
  ];
  for (const c of crafts) {
    await prisma.productCraft.upsert({ where: { name: c.name }, update: { code: c.code }, create: c });
  }

  // 二级受众 + 三级品类
  const audienceData = [
    {
      name: '儿童', code: 'ET', sort: 0,
      categories: ['沐浴玩具', '挤压玩具', '存钱罐', '摆件', '益智玩具', '安抚玩具', '节日玩具', '沙滩玩具'],
    },
    {
      name: '宠物', code: 'CW', sort: 1,
      categories: ['宠物益智啃咬玩具', '抛掷球类玩具', '宠物发声玩具', '宠物碗及喂食器', '宠物便携包及出行用品', '宠物清洁美容产品'],
    },
    {
      name: '配件', code: 'PJ', sort: 2,
      categories: ['脸皮', '新品类'],
    },
    {
      name: '文具', code: 'WJ', sort: 3,
      categories: ['印章', '笔', '笔筒'],
    },
    {
      name: '家居', code: 'JJ', sort: 4,
      categories: ['杯套', '门档', '沥水篮'],
    },
  ];

  for (const aud of audienceData) {
    const audience = await prisma.productAudience.upsert({
      where: { name: aud.name },
      update: { code: aud.code },
      create: { name: aud.name, code: aud.code, sort: aud.sort },
    });
    for (let i = 0; i < aud.categories.length; i++) {
      await prisma.productCategory.upsert({
        where: { audienceId_name: { audienceId: audience.id, name: aud.categories[i] } },
        update: {},
        create: { name: aud.categories[i], audienceId: audience.id, sort: i },
      });
    }
  }

  console.log('✅ 产品分类初始化完成！');

  // 6. 初始化获客渠道（线上渠道 / 线下渠道 + 平台）
  console.log('📡 初始化获客渠道...');
  const channelSeed: { name: string; category: 'ONLINE' | 'OFFLINE'; shops?: string[] }[] = [
    { name: '国际站', category: 'ONLINE', shops: ['寿春平台', '微它平台'] },
    { name: '1688', category: 'ONLINE', shops: ['微它平台', '景元平台'] },
    { name: '线下渠道', category: 'OFFLINE', shops: ['广交会', '义博会'] },
  ];
  for (const p of channelSeed) {
    let platform = await prisma.channel.findFirst({ where: { name: p.name, parentId: null } });
    if (!platform) {
      platform = await prisma.channel.create({ data: { name: p.name, category: p.category, status: 'ENABLED', sort: 0 } });
    } else {
      await prisma.channel.update({ where: { id: platform.id }, data: { category: p.category } });
    }
    for (let i = 0; i < (p.shops || []).length; i++) {
      const shopName = p.shops![i];
      const shop = await prisma.channel.findFirst({ where: { name: shopName, parentId: platform.id } });
      if (!shop) {
        await prisma.channel.create({ data: { name: shopName, category: p.category, parentId: platform.id, status: 'ENABLED', sort: i } });
      }
    }
  }
  console.log('✅ 获客渠道初始化完成！');
}

main()
  .catch((e) => {
    console.error('❌ 初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
