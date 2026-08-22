import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import roleRoutes from './routes/role.routes';
import departmentRoutes from './routes/department.routes';
import permissionRoutes from './routes/permission.routes';
import exchangeRoutes from './routes/exchange.routes';
import salesRoutes from './routes/sales.routes';
import customerRoutes from './routes/customer.routes';
import orderRoutes from './routes/order.routes';
import productRoutes from './routes/product.routes';
import productGroupRoutes from './routes/productGroup.routes';
import sampleRoutes from './routes/sample.routes';
import quoteRoutes from './routes/quote.routes';
import taxonomyRoutes from './routes/productTaxonomy.routes';
import certificateRoutes from './routes/certificate.routes';
import uploadRoutes from './routes/upload.routes';
import operationLogRoutes from './routes/operationLog.routes';
import { UPLOAD_DIR } from './controllers/upload.controller';
import path from 'path';

const app = express();

// 安全中间件
app.use(helmet({
  contentSecurityPolicy: false, // 允许 Swagger UI 加载外部资源
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

// 限流
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.includes('/ext/') || req.path.includes('/docs'),
});
app.use('/api/', limiter);

// 日志 & 解析
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Swagger API 文档
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'YSEM API 文档',
  customfavIcon: '',
}));

// 导出 OpenAPI JSON
app.get('/api/docs.json', (_req, res) => {
  res.json(swaggerSpec);
});

// 根路由 - API 欢迎页
app.get('/api', (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>YSEM API</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .card { background: white; border-radius: 16px; padding: 48px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.15); max-width: 480px; }
        h1 { font-size: 2rem; color: #1a1a2e; margin-bottom: 8px; }
        p { color: #666; margin-bottom: 24px; }
        a { display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 500; transition: transform 0.2s, box-shadow 0.2s; }
        a:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4); }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🚀 YSEM API</h1>
        <p>义乌寿春企业管理系统后端 API 服务</p>
        <a href="/api/docs">📖 查看 API 文档</a>
      </div>
    </body>
    </html>
  `);
});

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/ext/exchange', exchangeRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);
app.use('/api/product-groups', productGroupRoutes);
app.use('/api/sample-applies', sampleRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/product/taxonomy', taxonomyRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/operations', operationLogRoutes);
app.use('/api/upload', uploadRoutes);

// 静态资源：上传的图片
app.use('/api/uploads', express.static(UPLOAD_DIR));

// 错误处理
app.use(errorHandler);

export default app;
