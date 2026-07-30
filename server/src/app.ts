import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
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

const app = express();

// 安全中间件
app.use(helmet());
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
  skip: (req) => req.path.includes('/ext/'),
});
app.use('/api/', limiter);

// 日志 & 解析
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

// 错误处理
app.use(errorHandler);

export default app;
