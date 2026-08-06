import { Router } from 'express';
import { getUsers, getUser, createUser, updateUser, deleteUser } from '../controllers/user.controller';
import { authenticate, requirePerm } from '../middleware/auth';

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 用户管理
 *   description: 用户 CRUD
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     tags: [用户管理]
 *     summary: 获取用户列表
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 用户列表（分页）
 */
router.get('/', requirePerm('system:user'), getUsers);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     tags: [用户管理]
 *     summary: 获取用户详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 用户详情
 */
router.get('/:id', requirePerm('system:user'), getUser);

/**
 * @swagger
 * /api/users:
 *   post:
 *     tags: [用户管理]
 *     summary: 创建用户
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password, email]
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *               email: { type: string }
 *               nickname: { type: string }
 *               deptId: { type: integer }
 *               roleIds: { type: array, items: { type: integer } }
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post('/', requirePerm('system:user:create'), createUser);

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     tags: [用户管理]
 *     summary: 更新用户
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/:id', requirePerm('system:user:edit'), updateUser);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     tags: [用户管理]
 *     summary: 删除用户
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete('/:id', requirePerm('system:user:delete'), deleteUser);

export default router;
