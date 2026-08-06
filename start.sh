#!/bin/bash
# YSEM 应用启动脚本
set -e

NODE_BIN="/Users/stra/.workbuddy/binaries/node/versions/20.18.0/bin"
export PATH="$NODE_BIN:$PATH"

echo "========================================="
echo "  YSEM 企业管理系统 - 启动脚本"
echo "========================================="

# Step 1: 检查 Node 版本
echo ""
echo "[1/4] 检查 Node.js 版本..."
node -v

# Step 2: 初始化数据库
echo ""
echo "[2/4] 初始化数据库..."
cd /Users/stra/CodeBuddy/ysem/server

if [ ! -f prisma/dev.db ]; then
    echo "  → 生成 Prisma Client..."
    npx prisma generate
    echo "  → 同步数据库 Schema..."
    npx prisma db push
    echo "  → 导入种子数据（管理员账号: admin / admin123）..."
    npx tsx prisma/seed.ts
    echo "  ✓ 数据库初始化完成"
else
    echo "  ✓ 数据库已存在，跳过初始化"
fi

# Step 3: 启动后端服务（单一实例保护，避免重复 watch 进程堆积导致 CPU 飙高）
echo ""
echo "[3/4] 启动后端服务（端口 3000）..."

# 端口占用检测：若 3000 已被占用，说明已有实例在跑，直接退出避免叠加
if lsof -ti :3000 >/dev/null 2>&1; then
  echo "  ⚠ 端口 3000 已被占用，后端实例可能已在运行。"
  echo "    如需重启请先停止旧进程："
  echo "    kill \$(lsof -ti :3000) ; kill \$(lsof -ti :5173)"
  echo "    跳过后端启动。"
else
  nohup npx tsx watch --clear-screen=false src/index.ts > /tmp/ysem-server.log 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > /tmp/ysem-server.pid
  echo "  ✓ 后端服务已启动 (PID: $SERVER_PID)"
fi

# Step 4: 启动前端服务
echo ""
echo "[4/4] 启动前端服务（端口 5173）..."
cd /Users/stra/CodeBuddy/ysem/client

if lsof -ti :5173 >/dev/null 2>&1; then
  echo "  ⚠ 端口 5173 已被占用，前端实例可能已在运行。"
  echo "    如需重启请先停止旧进程：kill \$(lsof -ti :5173)"
  echo "    跳过前端启动。"
else
  nohup npx vite --host > /tmp/ysem-client.log 2>&1 &
  CLIENT_PID=$!
  echo "$CLIENT_PID" > /tmp/ysem-client.pid
  echo "  ✓ 前端服务已启动 (PID: $CLIENT_PID)"
fi

echo ""
echo "========================================="
echo "  🚀 应用启动完成！"
echo "========================================="
echo "  前端地址: http://localhost:5173"
echo "  后端 API:  http://localhost:3000/api"
echo "  管理员账号: admin / admin123"
echo ""
echo "  查看日志:"
echo "    后端: tail -f /tmp/ysem-server.log"
echo "    前端: tail -f /tmp/ysem-client.log"
echo ""
echo "  停止服务:"
echo "    kill \$(cat /tmp/ysem-server.pid) \$(cat /tmp/ysem-client.pid)"
echo "========================================="
