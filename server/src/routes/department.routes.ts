import { Router } from 'express';
import { getDepartments, getDeptTree, getDepartment, createDepartment, updateDepartment, deleteDepartment } from '../controllers/department.controller';
import { authenticate, requirePerm } from '../middleware/auth';

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 部门管理
 *   description: 组织架构管理
 */

/**
 * @swagger
 * /api/departments:
 *   get:
 *     tags: [部门管理]
 *     summary: 获取部门列表
 *     responses:
 *       200:
 *         description: 部门列表
 */
router.get('/', requirePerm('system:dept'), getDepartments);

/**
 * @swagger
 * /api/departments/tree:
 *   get:
 *     tags: [部门管理]
 *     summary: 获取部门树形结构
 *     responses:
 *       200:
 *         description: 树形部门结构
 */
router.get('/tree', requirePerm('system:dept'), getDeptTree);

router.get('/:id', requirePerm('system:dept'), getDepartment);
router.post('/', requirePerm('system:dept:create'), createDepartment);

/**
 * @swagger
 * /api/departments/{id}:
 *   put:
 *     tags: [部门管理]
 *     summary: 更新部门
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/:id', requirePerm('system:dept:edit'), updateDepartment);

router.delete('/:id', requirePerm('system:dept:delete'), deleteDepartment);

export default router;
