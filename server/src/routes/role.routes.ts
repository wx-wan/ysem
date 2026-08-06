import { Router } from 'express';
import { getRoles, getRole, createRole, updateRole, deleteRole, assignPermissions } from '../controllers/role.controller';
import { authenticate, requirePerm } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(requirePerm('system:role'));

/**
 * @swagger
 * tags:
 *   name: 角色管理
 *   description: 角色 CRUD 与权限分配
 */

/**
 * @swagger
 * /api/roles:
 *   get:
 *     tags: [角色管理]
 *     summary: 获取角色列表
 *     responses:
 *       200:
 *         description: 角色列表
 */
router.get('/', getRoles);

/**
 * @swagger
 * /api/roles/{id}:
 *   get:
 *     tags: [角色管理]
 *     summary: 获取角色详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 角色详情（含权限列表）
 */
router.get('/:id', getRole);

/**
 * @swagger
 * /api/roles:
 *   post:
 *     tags: [角色管理]
 *     summary: 创建角色
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post('/', requirePerm('system:role:create'), createRole);

router.put('/:id', requirePerm('system:role:edit'), updateRole);

/**
 * @swagger
 * /api/roles/{id}:
 *   delete:
 *     tags: [角色管理]
 *     summary: 删除角色
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete('/:id', requirePerm('system:role:delete'), deleteRole);

/**
 * @swagger
 * /api/roles/{id}/permissions:
 *   post:
 *     tags: [角色管理]
 *     summary: 为角色分配权限
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               permissionIds:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: 分配成功
 */
router.post('/:id/permissions', assignPermissions);

export default router;
