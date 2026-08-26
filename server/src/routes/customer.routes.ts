import { Router } from "express";
import { authenticate } from "../middleware/auth";
import multer from "multer";
import * as ctrl from "../controllers/customer.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: 客户管理
 *   description: 公海/私海客户管理、阶段流转、报告统计
 */

/**
 * @swagger
 * /api/customers/my:
 *   get:
 *     tags: [客户管理]
 *     summary: 我的私海客户列表
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: 私海客户列表
 */
router.get("/my", ctrl.listMy);

/**
 * @swagger
 * /api/customers/public:
 *   get:
 *     tags: [客户管理]
 *     summary: 公海客户列表
 *     responses:
 *       200:
 *         description: 公海客户列表
 */
router.get("/public", ctrl.listPublic);

/**
 * @swagger
 * /api/customers/all:
 *   get:
 *     tags: [客户管理]
 *     summary: 全部客户列表（管理员）
 *     responses:
 *       200:
 *         description: 全部客户列表
 */
router.get("/all", ctrl.listAll);

/**
 * @swagger
 * /api/customers/options:
 *   get:
 *     tags: [客户管理]
 *     summary: 客户下拉选项（我的私海 + 公海；管理员为全部）
 *     responses:
 *       200:
 *         description: 客户列表
 */
router.get("/options", ctrl.listOptions);

/**
 * @swagger
 * /api/customers/countries:
 *   get:
 *     tags: [客户管理]
 *     summary: 获取国家列表
 *     responses:
 *       200:
 *         description: 去重后的国家列表
 */
router.get("/countries", ctrl.getCountries);

/**
 * @swagger
 * /api/customers/report:
 *   get:
 *     tags: [客户管理]
 *     summary: 获取报告统计数据
 *     responses:
 *       200:
 *         description: 12项核心指标数据
 */
router.get("/report", ctrl.getReportStats);

/**
 * @swagger
 * /api/customers/import:
 *   post:
 *     tags: [客户管理]
 *     summary: Excel 批量导入客户
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
router.post("/import", upload.single("file"), ctrl.importExcel);

/**
 * @swagger
 * /api/customers/{id}/claim:
 *   post:
 *     tags: [客户管理]
 *     summary: 认领公海客户到私海
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 认领成功
 */
router.post("/:id/claim", ctrl.claim);

/**
 * @swagger
 * /api/customers/{id}/release:
 *   post:
 *     tags: [客户管理]
 *     summary: 释放客户到公海
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 释放成功
 */
router.post("/:id/release", ctrl.release);

/**
 * @swagger
 * /api/customers/{id}/transfer:
 *   post:
 *     tags: [客户管理]
 *     summary: 转交客户给其他业务员（管理员）
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
 *             required: [newOwnerId]
 *             properties:
 *               newOwnerId:
 *                 type: string
 *     responses:
 *       200:
 *         description: 转交成功
 */
router.post("/:id/transfer", ctrl.transfer);

/**
 * @swagger
 * /api/customers/{id}/tags:
 *   patch:
 *     tags: [客户管理]
 *     summary: 更新客户标签
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
 *             required: [tags]
 *             properties:
 *               tags:
 *                 type: string
 *                 description: 标签字符串，格式 "name#color,name#color"
 *     responses:
 *       200:
 *         description: 标签更新成功
 */
router.patch("/:id/tags", ctrl.updateTags);

/**
 * @swagger
 * /api/customers/{id}:
 *   get:
 *     tags: [客户管理]
 *     summary: 获取客户详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 客户详情
 */
router.get("/:id", ctrl.getById);

/**
 * @swagger
 * /api/customers:
 *   post:
 *     tags: [客户管理]
 *     summary: 创建客户
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, description: 客户名称 }
 *               status: { type: string, enum: [lead, prospect, sample, order], default: lead }
 *               ownerId: { type: integer, description: 归属用户ID，私海不传则默认当前用户 }
 *               source: { type: string }
 *               country: { type: string }
 *               contact: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               remark: { type: string }
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post("/", ctrl.create);

/**
 * @swagger
 * /api/customers/{id}:
 *   put:
 *     tags: [客户管理]
 *     summary: 更新客户
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put("/:id", ctrl.update);

/**
 * @swagger
 * /api/customers/{id}:
 *   delete:
 *     tags: [客户管理]
 *     summary: 删除客户
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete("/:id", ctrl.remove);

export default router;
