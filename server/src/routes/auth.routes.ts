import { Router } from 'express';
import { login, register, refreshToken, logout, getProfile, changePassword } from '../controllers/auth.controller';
import { events } from '../controllers/notify.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: 认证
 *   description: 登录、注册、Token 管理
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [认证]
 *     summary: 用户登录
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 example: admin
 *               password:
 *                 type: string
 *                 example: admin123
 *     responses:
 *       200:
 *         description: 登录成功，返回 accessToken 和 refreshToken
 */
router.post('/login', login);

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [认证]
 *     summary: 用户注册
 *     security: []
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
 *     responses:
 *       200:
 *         description: 注册成功
 */
router.post('/register', register);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     tags: [认证]
 *     summary: 刷新 Token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: 刷新成功
 */
router.post('/refresh', refreshToken);
router.post('/logout', authenticate, logout);

/**
 * @swagger
 * /api/auth/profile:
 *   get:
 *     tags: [认证]
 *     summary: 获取当前用户信息
 *     responses:
 *       200:
 *         description: 返回用户信息（含角色、权限）
 */
router.get('/profile', authenticate, getProfile);

/**
 * @swagger
 * /api/auth/password:
 *   put:
 *     tags: [认证]
 *     summary: 修改密码
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [oldPassword, newPassword]
 *             properties:
 *               oldPassword: { type: string }
 *               newPassword: { type: string }
 *     responses:
 *       200:
 *         description: 密码修改成功
 */
router.put('/password', authenticate, changePassword);

/**
 * @swagger
 * /api/auth/events:
 *   get:
 *     tags: [认证]
 *     summary: SSE 通知流（权限变更/审批/公告等实时推送）
 *     description: token 通过 query 传递（EventSource 不支持自定义 Header）
 *     security: []
 */
router.get('/events', events);

export default router;
