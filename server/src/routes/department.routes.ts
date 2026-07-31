import { Router } from 'express';
import { getDepartments, getDeptTree, getDepartment, createDepartment, updateDepartment, deleteDepartment } from '../controllers/department.controller';
import { authenticate, authorize } from '../middleware/auth';

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
router.get('/', getDepartments);

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
router.get('/tree', getDeptTree);

router.get('/:id', getDepartment);
router.post('/', authorize('admin'), createDepartment);

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
router.put('/:id', authorize('admin'), updateDepartment);

router.delete('/:id', authorize('admin'), deleteDepartment);

export default router;
