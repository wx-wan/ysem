import { Router } from 'express';
import multer from 'multer';
import {
  getPipelines, getKanban, getPipeline, createPipeline,
  updatePipeline, changeStage, deletePipeline, batchDelete,
  importExcel, getAssignUsers,
} from '../controllers/sales.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 销售管理
 *   description: 销售管道管理
 */

/**
 * @swagger
 * /api/sales/assign-users:
 *   get:
 *     tags: [销售管理]
 *     summary: 获取可分配用户列表
 *     responses:
 *       200:
 *         description: 用户列表
 */
router.get('/assign-users', getAssignUsers);

/**
 * @swagger
 * /api/sales/kanban:
 *   get:
 *     tags: [销售管理]
 *     summary: 获取看板数据
 *     responses:
 *       200:
 *         description: 按阶段分组的销售看板
 */
router.get('/kanban', getKanban);

/**
 * @swagger
 * /api/sales/import:
 *   post:
 *     tags: [销售管理]
 *     summary: Excel 批量导入销售记录
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: 导入结果
 */
router.post('/import', upload.single('file'), importExcel);

/**
 * @swagger
 * /api/sales:
 *   get:
 *     tags: [销售管理]
 *     summary: 获取销售列表
 *     responses:
 *       200:
 *         description: 销售记录列表
 */
router.get('/', getPipelines);

router.get('/:id', getPipeline);

/**
 * @swagger
 * /api/sales:
 *   post:
 *     tags: [销售管理]
 *     summary: 创建销售记录
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, name]
 *             properties:
 *               customerId: { type: integer }
 *               name: { type: string }
 *               amount: { type: number }
 *               stage: { type: string }
 *               probability: { type: integer }
 *               expectedCloseDate: { type: string, format: date }
 *               assigneeId: { type: integer }
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post('/', createPipeline);

router.put('/:id', updatePipeline);

/**
 * @swagger
 * /api/sales/{id}/stage:
 *   patch:
 *     tags: [销售管理]
 *     summary: 修改销售阶段
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
 *             required: [stage]
 *             properties:
 *               stage: { type: string }
 *     responses:
 *       200:
 *         description: 阶段变更成功
 */
router.patch('/:id/stage', changeStage);

/**
 * @swagger
 * /api/sales/batch:
 *   delete:
 *     tags: [销售管理]
 *     summary: 批量删除销售记录
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: 批量删除成功
 */
router.delete('/batch', batchDelete);

router.delete('/:id', deletePipeline);

export default router;
