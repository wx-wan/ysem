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

  // 2. 创建默认权限（菜单 & 按钮）
  const menuPermissions = [
    { name: '仪表盘', code: 'dashboard', type: 'MENU' as const, path: '/dashboard', icon: 'DashboardOutlined', sort: 0 },
    { name: '系统管理', code: 'system', type: 'MENU' as const, path: '/system', icon: 'SettingOutlined', sort: 1 },
    { name: '用户管理', code: 'system:user', type: 'MENU' as const, path: '/system/user', icon: 'UserOutlined', sort: 10 },
    { name: '角色管理', code: 'system:role', type: 'MENU' as const, path: '/system/role', icon: 'TeamOutlined', sort: 11 },
    { name: '部门管理', code: 'system:dept', type: 'MENU' as const, path: '/system/dept', icon: 'ApartmentOutlined', sort: 12 },
    { name: '权限管理', code: 'system:perm', type: 'MENU' as const, path: '/system/perm', icon: 'SafetyOutlined', sort: 13 },
  ];

  // 先建父级菜单
  let systemMenuId: string | null = null;
  for (const perm of menuPermissions) {
    const created = await prisma.permission.upsert({
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
    if (perm.code === 'system') systemMenuId = created.id;
  }

  // 更新子菜单的 parentId
  if (systemMenuId) {
    const childCodes = ['system:user', 'system:role', 'system:dept', 'system:perm'];
    for (const code of childCodes) {
      await prisma.permission.update({
        where: { code },
        data: { parentId: systemMenuId },
      });
    }
  }

  // 按钮级权限
  const buttonPermissions = [
    { name: '用户新增', code: 'system:user:create', type: 'BUTTON' as const, sort: 0 },
    { name: '用户编辑', code: 'system:user:edit', type: 'BUTTON' as const, sort: 1 },
    { name: '用户删除', code: 'system:user:delete', type: 'BUTTON' as const, sort: 2 },
    { name: '角色新增', code: 'system:role:create', type: 'BUTTON' as const, sort: 0 },
    { name: '角色编辑', code: 'system:role:edit', type: 'BUTTON' as const, sort: 1 },
    { name: '角色删除', code: 'system:role:delete', type: 'BUTTON' as const, sort: 2 },
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

  // 5. 创建默认管理员
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const email = process.env.ADMIN_EMAIL || 'admin@enterprise.com';
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

  console.log('✅ 数据库初始化完成！');
  console.log(`📧 默认管理员: ${username} / ${password}`);
}

main()
  .catch((e) => {
    console.error('❌ 初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
