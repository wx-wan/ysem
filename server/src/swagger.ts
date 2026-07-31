import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '义乌寿春企业管理系统 API',
      version: '1.0.0',
      description: `
## 概述
YSEM 企业管理系统后端 API，支持客户关系管理 (CRM)、订单管理、销售管理、用户权限管理等功能。

## 认证
大部分接口需要在请求头中携带 JWT Token：
\`\`\`
Authorization: Bearer <access_token>
\`\`\`

## 默认管理员
- 用户名: \`admin\`
- 密码: \`admin123\`
      `,
    },
    servers: [
      { url: 'http://localhost:3000', description: '本地开发环境' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: '认证', description: '登录、获取用户信息、登出' },
      { name: '用户管理', description: '用户 CRUD' },
      { name: '角色管理', description: '角色 CRUD 与权限分配' },
      { name: '部门管理', description: '组织架构管理' },
      { name: '权限管理', description: '权限树' },
      { name: '客户管理', description: '公海/私海客户管理、阶段流转、报告统计' },
      { name: '订单管理', description: '订单 CRUD' },
      { name: '销售管理', description: '销售记录' },
      { name: '汇率', description: '多币种汇率查询' },
      { name: '健康检查', description: '服务状态检查' },
    ],
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
