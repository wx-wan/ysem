import { Router } from 'express';
import { getPermissions, getPermissionTree, createPermission, updatePermission, deletePermission } from '../controllers/permission.controller';
import { authenticate, requirePerm } from '../middleware/auth';

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 权限管理
 *   description: 权限树与 CRUD
 */

/**
 * @swagger
 * /api/permissions:
 *   get:
 *     tags: [权限管理]
 *     summary: 获取权限列表
 *     responses:
 *       200:
 *         description: 权限列表
 */
router.get('/', requirePerm('system:perm'), getPermissions);

/**
 * @swagger
 * /api/permissions/tree:
 *   get:
 *     tags: [权限管理]
 *     summary: 获取权限树
 *     responses:
 *       200:
 *         description: 树形权限结构
 */
router.get('/tree', requirePerm('system:perm'), getPermissionTree);

/**
 * @swagger
 * /api/permissions:
 *   post:
 *     tags: [权限管理]
 *     summary: 创建权限
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string }
 *               code: { type: string }
 *               type: { type: string, enum: [menu, api] }
 *               parentId: { type: integer, nullable: true }
 *               path: { type: string }
 *               icon: { type: string }
 *               sort: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post('/', requirePerm('system:perm:create'), createPermission);

router.put('/:id', requirePerm('system:perm:edit'), updatePermission);
router.delete('/:id', requirePerm('system:perm:delete'), deletePermission);

export default router;
