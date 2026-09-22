# YSEM Frontend（新前端工程）

独立的前端工程，与仓库内既有 `client/`（旧前端）并存、互不影响。
当前已通过 Vite 开发服务器代理接入后端 API，包含认证、权限 / 数据范围、共享主数据与客户模块的实际实现。

## 技术栈

版本取自 `frontend/package.json`：

| 依赖 | 版本 |
| --- | --- |
| react / react-dom | ^18.3.1 |
| typescript | ^5.6.0 |
| vite | ^5.4.0 |
| @vitejs/plugin-react | ^4.3.1 |
| antd（Ant Design） | ^6.5.3 |
| react-router-dom | ^6.26.0 |
| axios | ^1.20.0 |
| zustand | ^5.0.15 |

类型包：`@types/react ^18.3.8`、`@types/react-dom ^18.3.0`。
运行环境：Node v20.18（仓库根目录 `start.sh` 固定使用该版本）。

## 常用命令

```bash
npm install      # 安装依赖
npm run dev      # 开发服务器（Vite）
npm run build    # tsc -b && vite build（类型检查 + 产物输出到 dist/）
npm run preview  # 预览 dist/ 构建产物
```

- 开发服务器端口在 `vite.config.ts` 中固定为 **5001**，并启用 `strictPort`：端口被占用时**明确报错退出**，不会静默切换到其他端口（避免与 macOS 系统常驻服务占用的端口冲突）。
- `package.json` 中**没有 lint 脚本**（如需 lint，请另行引入 ESLint 等工具）。
- `node_modules/`、`dist/` 由 `frontend/.gitignore` 忽略，不纳入版本库。

## 开发服务器与后端联通

| 项 | 值 |
| --- | --- |
| 前端开发服务器 | `http://localhost:5001` |
| 后端 API | `http://localhost:3000/api` |
| 代理规则 | `/api` → `http://localhost:3000`（`changeOrigin: true`），配置于 `vite.config.ts` |

前端所有请求统一使用相对路径 `/api`：`src/api/request.ts` 中的 axios 实例 `baseURL = '/api'`，超时 15 秒。

以上仅为本工程已验证存在的代理契约；后端服务自身的启动方式不在本工程范围内。

## 目录结构

```text
frontend/
├── index.html              # Vite 入口 HTML（引用 /src/main.tsx 与 /favicon.svg）
├── package.json
├── package-lock.json
├── vite.config.ts          # 端口 5001（strictPort）+ /api 代理 → :3000
├── tsconfig.json           # project references（→ tsconfig.app.json / tsconfig.node.json）
├── tsconfig.app.json       # include: ["src"]，strict
├── tsconfig.node.json
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx            # React 入口（挂载 App，引入 index.css）
    ├── App.tsx             # AntdApp + BrowserRouter + 路由；启动时恢复认证状态
    ├── index.css
    ├── api/
    │   ├── request.ts      # 唯一 axios 实例：Authorization、401 单次 refresh + retry、错误提取
    │   ├── auth.ts         # login / refresh / profile / logout / changePassword
    │   ├── customers.ts    # 客户读端点 + create / update
    │   ├── upload.ts       # POST /upload（图片，≤ 10MB）
    │   └── masterData.ts   # 共享字典的 GET 端点
    ├── auth/
    │   ├── permissionUtils.ts   # 权限 / 数据范围纯函数
    │   ├── useCurrentUser.ts    # Current User 选择器
    │   ├── usePermission.ts     # permissions / isAdmin / hasPerm
    │   ├── useDataScope.ts      # dataScope（ALL | DEPT | SELF）
    │   └── PermissionGate.tsx   # 最小权限门组件（见「已知事项」）
    ├── components/
    │   └── RequireAuth.tsx      # 登录态路由守卫
    ├── hooks/
    │   ├── useCustomers.ts      # 客户 API 的稳定引用（无缓存）
    │   └── useMasterData.ts     # 主数据消费入口
    ├── layouts/
    │   ├── AppLayout.tsx        # Sider + Header + Content(Outlet) + Footer
    │   ├── AppHeader.tsx        # 折叠开关、当前用户、登出
    │   └── AppMenu.tsx          # 权限过滤菜单 + 路由高亮
    ├── pages/
    │   ├── Login.tsx
    │   ├── Dashboard.tsx
    │   ├── Placeholder.tsx      # 菜单派生占位页
    │   ├── NotFound.tsx
    │   └── customers/
    │       ├── CustomerListPage.tsx
    │       ├── CustomerDetailPage.tsx
    │       ├── CustomerFilterBar.tsx
    │       ├── CustomerFormModal.tsx
    │       ├── CustomerStats.tsx
    │       ├── CustomerTable.tsx
    │       ├── constants.ts     # 标签 / 选项 / 常量
    │       └── returnTo.ts      # 列表 ↔ 详情 返回路径记忆
    ├── router/
    │   ├── index.tsx            # 路由表
    │   └── menu.tsx             # 菜单树定义 + 权限过滤 / 选中态纯函数
    ├── stores/
    │   ├── useAuthStore.ts      # 会话与 Current User
    │   └── useMasterDataStore.ts# 主数据 TTL 缓存
    ├── types/
    │   ├── auth.ts
    │   ├── customer.ts
    │   └── masterData.ts
    └── utils/
        ├── format.ts            # 展示层格式化（空值统一 '-'）
        ├── masterData.ts        # 渠道树等纯函数
        └── response.ts          # 响应信封解包 + 形状校验
```

## 页面与路由

路由定义见 `src/router/index.tsx`：

| 路由 | 组件 | 说明 |
| --- | --- | --- |
| `/login` | `pages/Login.tsx` | 不使用应用外壳；已登录访问时重定向 `/dashboard` |
| `/` | — | `Navigate` 重定向到 `/dashboard` |
| `/dashboard` | `pages/Dashboard.tsx` | 工作台：当前用户 / 数据范围 + 主数据数据层验证区 |
| `/data/customers` | `pages/customers/CustomerListPage.tsx` | 客户列表（真实页面） |
| `/data/customers/:id` | `pages/customers/CustomerDetailPage.tsx` | 客户详情（真实页面） |
| 其余菜单路径 | `pages/Placeholder.tsx` | 由 `router/menu.tsx` 的 `APP_MENU` 派生；尚未实现的菜单项渲染占位页 |
| `*` | `pages/NotFound.tsx` | 未知路径（在应用外壳内） |

除 `/login` 外的路由均包裹在 `RequireAuth` → `AppLayout` 之下的认证外壳中。

## 应用能力（当前实现）

### 认证 Authentication

- `pages/Login.tsx`：`POST /api/auth/login` → 写入 token 会话 → `GET /api/auth/profile` → 跳转 `/dashboard`。
- `components/RequireAuth.tsx`：启动恢复期间显示 Loading（不误跳登录页）；未登录重定向 `/login`（携带来源路径）；已登录渲染子内容。
- `stores/useAuthStore.ts`：持有 `accessToken` / `refreshToken` / `tokenExpiresAt` / `user` / `ready`；token 持久化在 `localStorage`（键名 `ysem.accessToken`、`ysem.refreshToken`、`ysem.tokenExpiresAt`）；`initialize()` 在应用启动时通过 profile 恢复会话。
- `api/auth.ts`：`login`、`refresh`、`profile`、`logout`、`changePassword` 五个后端实际存在的端点。
- `api/request.ts`：请求拦截器自动附加 `Authorization: Bearer <token>`；响应 401 时触发**单次** refresh 锁并重试一次，refresh 失败则清理本地认证状态并跳转 `/login`。

### 授权与数据范围 Authorization

- `auth/permissionUtils.ts`：纯函数层（不请求 API、不访问 `window` / `localStorage`）。admin 仅由 `user.role.code === 'admin'` 判定；权限码为**精确匹配**（不做前缀 / 通配符匹配），与后端 `requirePerm` 语义一致。
- `auth/usePermission.ts`：暴露 `permissions` / `isAdmin` / `hasPerm`。
- `auth/useDataScope.ts`：暴露 `dataScope`（`ALL` | `DEPT` | `SELF`，取值只来自后端 `user.role.dataScope`）。数据范围仅用于 UI 提示、默认筛选与页面行为；后端 `roleScope` / `applyScope` 始终是最终权威。
- `auth/PermissionGate.tsx`：最小权限门组件（有权限渲染 children，否则渲染 `null`；仅 UI 层控制，不构成安全边界）。
- 菜单侧：`router/menu.tsx` 的菜单树按权限码过滤（子项全部不可见时整组隐藏）。菜单权限**只决定菜单是否显示**，不代表用户可以访问全部对应 API。

### API 层

统一通过 `api/request.ts` 的 axios 实例请求，响应信封为 `{ code, message, data }`；`utils/response.ts` 提供 `unwrapResponse` / `unwrapArray` / `unwrapPage` / `unwrapPageWithExtras`，形状不符时抛 `ResponseShapeError`（不静默降级为空数组）。

| 模块 | 覆盖的后端端点 |
| --- | --- |
| `api/auth.ts` | `POST /api/auth/login`、`POST /api/auth/refresh`、`GET /api/auth/profile`、`POST /api/auth/logout`、`PUT /api/auth/password` |
| `api/customers.ts` | `GET /customers/my`、`/public`、`/all`、`/:id`、`/report`；`POST /customers`、`PUT /customers/:id` |
| `api/upload.ts` | `POST /api/upload`（`multipart/form-data`，字段名 `file`；仅 `image/*` 且 ≤ 10MB）；返回的 `data.url` 可直接用于 `<Image src>` 与 `coverImage` |
| `api/masterData.ts` | `GET /api/customer-types/active`、`/channels/tree`、`/customers/countries`、`/certificates`、`/product/taxonomy/crafts`、`/product/taxonomy/audiences`、`/product/taxonomy/categories`、`/products/options`、`/users/select` |

### 状态管理 State

- `stores/useAuthStore.ts`：会话状态与 Current User（唯一来源 `GET /api/auth/profile`）。
- `stores/useMasterDataStore.ts`：主数据字典的统一 store；每个数据集持有 `{ data, loading, error, loadedAt }`，TTL 缓存 10 分钟，并发调用共享 in-flight promise，并在认证用户变化时清空（`sessionUserId` 会话边界）。

### 共享主数据 Master Data

- `api/masterData.ts`：上述 9 个字典端点的封装，**不改变后端语义**（不过滤、不放宽可见性）。
- `hooks/useMasterData.ts`：页面消费入口，提供只读投影（缺省为 `[]`）、加载 / 刷新 / 清空，以及按需的单数据集加载；会话切换时自动清空缓存。
- `utils/masterData.ts`：`filterActiveChannels`（渠道树 ACTIVE 收敛，父级非 ACTIVE 时整枝丢弃）、`flattenChannels`、`countChannels` 等纯函数。

### 客户模块 Customer Module

| 能力 | 实现 | 说明 |
| --- | --- | --- |
| Customer List | `CustomerListPage.tsx` | 视图 `my` / `public` / `all`（`all` 仅 admin 可选）；状态由 URL 查询参数驱动（`view` / `type` / `keyword` / `page` / `pageSize`）；请求经 `hooks/useCustomers.ts` → `api/customers.ts`；同一查询的并发请求做 in-flight 去重 |
| Customer Filter | `CustomerFilterBar.tsx` | 关键字、国家/地区、客户类型等筛选条件 |
| Customer Statistics | `CustomerStats.tsx` | 列表页统计展示（`/my`、`/all` 附带的 stats / ownerStats 字段）；`GET /customers/report` 已在 API 层封装 |
| Customer Detail | `CustomerDetailPage.tsx` | `/data/customers/:id`，只读展示客户信息、归属、活动时间线、商机与销售订单；404 以 Result 呈现；`returnTo.ts` 负责列表 ↔ 详情的返回路径记忆 |
| Customer Form | `CustomerFormModal.tsx` | create / edit 复用同一表单：`POST /api/customers`、`PUT /api/customers/:id`；封面图经 `POST /api/upload` 上传后以 URL 形式提交 |

客户模块的边界（与当前后端契约一致）：

- 客户列表页的视图可见性（admin 才有「全部客户」）是 **UI 视图选择**，不是安全授权；数据范围与可见性始终由后端决定，前端不对客户数据做过滤。
- 归属（owner）写入受限：create 仅支持「归当前用户」或「公海」，edit 仅支持「保持」或「移入公海」，**不支持指定其他用户**。
- 客户意向等级不可写，由后端从关联商机派生。
- 未封装的客户能力：claim / release / transfer / tags / import。

## 项目整体启动

仓库根目录的 `start.sh` 已包含本工程的启动步骤：以 `npx vite` 在 **5001** 端口启动 `frontend/`，日志输出到 `/tmp/ysem-frontend.log`，并支持 `./start.sh stop|restart` 一并停止。该脚本同时也管理后端与旧前端 `client/`（其细节以脚本本身为准）；本工程自身不负责启动后端。

```bash
# 仅启动本工程
cd frontend
npm install
npm run dev        # http://localhost:5001
```

## 已知事项

- **未配置 lint**：`package.json` 中没有 lint 脚本；如需静态检查请另行引入 ESLint 等工具。
- **端口固定 5001 且 strictPort**：被占用时 Vite 会明确报错退出，可执行 `./start.sh stop` 释放端口后重启。
- **`auth/PermissionGate.tsx` 当前没有消费方**：组件已实现并导出，但业务页面尚未使用它；页面级权限控制目前由菜单过滤与各页面的 `usePermission` / `useDataScope` 承担。
- **owner 指派受限**：`GET /api/users/select` 不作为合法的 owner 候选源（返回集不含数据范围收敛、且含非 ACTIVE 用户），客户归属因此仅支持上文列出的 self / public / keep 选项。
- **`Dashboard` 的 Master Data 区域不是业务 UI**：仅用于确认主数据数据层（各字典条数、渠道 ACTIVE 收敛、缓存与刷新）可用。
