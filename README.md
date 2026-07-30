# 企业管理系统 (Enterprise Management System)

全栈企业管理系统，包含用户管理、角色权限管理、部门管理等功能模块。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Ant Design 5 + Zustand + React Router 6 |
| 后端 | Node.js + Express + TypeScript + Prisma ORM |
| 数据库 | SQLite (开发) / PostgreSQL (生产) |
| 认证 | JWT (Access Token + Refresh Token) |
| 部署 | Docker + Docker Compose + Nginx |

## 项目结构

```
.
├── client/                 # 前端项目
│   ├── src/
│   │   ├── api/           # API 接口封装
│   │   ├── layouts/       # 布局组件
│   │   ├── pages/         # 页面组件
│   │   ├── stores/        # 状态管理 (Zustand)
│   │   └── styles/        # 全局样式
│   ├── index.html
│   └── package.json
├── server/                 # 后端项目
│   ├── src/
│   │   ├── controllers/   # 控制器
│   │   ├── middleware/     # 中间件 (认证/错误处理)
│   │   ├── routes/        # 路由
│   │   ├── lib/           # 工具库 (Prisma)
│   │   └── utils/         # 工具函数
│   ├── prisma/
│   │   ├── schema.prisma  # 数据模型
│   │   └── seed.ts        # 种子数据
│   └── package.json
├── docker-compose.yml      # Docker 编排
├── Dockerfile.server       # 后端 Docker 镜像
├── Dockerfile.client       # 前端 Docker 镜像
└── README.md
```

## 快速开始 (本地开发)

### 1. 安装依赖

```bash
# 后端
cd server && npm install

# 前端
cd client && npm install
```

### 2. 初始化数据库

```bash
cd server
npx prisma generate      # 生成 Prisma Client
npx prisma db push       # 同步数据库
npx tsx prisma/seed.ts   # 初始化种子数据
```

### 3. 启动开发服务器

```bash
# 终端 1: 启动后端 (端口 3000)
cd server && npm run dev

# 终端 2: 启动前端 (端口 5173)
cd client && npm run dev
```

### 4. 访问系统

- 前端: http://localhost:5173
- 后端 API: http://localhost:3000/api
- 默认管理员: `admin` / `admin123`

## Docker 部署

### 开发环境 (快速启动)

```bash
# 使用 docker-compose 一键启动
docker-compose up -d

# 初始化数据库
docker exec -it enterprise-server npx prisma db push
docker exec -it enterprise-server npx tsx prisma/seed.ts
```

### 生产环境

```bash
# 1. 创建环境变量文件
cp server/.env.production .env

# 2. 修改 .env 中的敏感信息
#    - DB_PASSWORD: 数据库密码
#    - JWT_SECRET: JWT 密钥
#    - JWT_REFRESH_SECRET: 刷新令牌密钥
#    - CORS_ORIGIN: 前端域名

# 3. 启动服务
docker-compose -f docker-compose.yml --env-file .env up -d

# 4. 初始化数据库
docker exec -it enterprise-server npx prisma db push
docker exec -it enterprise-server npx tsx prisma/seed.ts
```

## 云服务器部署建议

1. 复制项目到服务器
2. 安装 Docker 和 Docker Compose
3. 修改 `server/.env.production` 密钥
4. 运行 `docker-compose up -d`
5. 配置 Nginx 反向代理 (可选，如需 HTTPS)
6. 配置防火墙开放 80 和 443 端口

## API 接口

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 认证 | POST | /api/auth/login | 登录 |
| 认证 | GET | /api/auth/profile | 获取用户信息 |
| 用户 | GET | /api/users | 用户列表 |
| 用户 | POST | /api/users | 创建用户 |
| 用户 | PUT | /api/users/:id | 更新用户 |
| 用户 | DELETE | /api/users/:id | 删除用户 |
| 角色 | GET | /api/roles | 角色列表 |
| 角色 | POST | /api/roles | 创建角色 |
| 角色 | POST | /api/roles/:id/permissions | 分配权限 |
| 部门 | GET | /api/departments | 部门列表 |
| 权限 | GET | /api/permissions/tree | 权限树 |

## Git 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 代码重构
chore: 构建/工具变更
```
