#!/bin/bash
# YSEM 应用启动 / 停止 / 重启脚本
# 用法:
#   ./start.sh          启动（默认，等同 start）
#   ./start.sh start    启动前后端
#   ./start.sh stop     停止前后端（按 PID 文件 + 端口兜底清理）
#   ./start.sh restart  先 stop 再 start

NODE_BIN="/Users/stra/.workbuddy/binaries/node/versions/20.18.0/bin"
export PATH="$NODE_BIN:$PATH"

SERVER_PID_FILE="/tmp/ysem-server.pid"
CLIENT_PID_FILE="/tmp/ysem-client.pid"
SERVER_PORT=3000
CLIENT_PORT=5173

ROOT_DIR="/Users/stra/CodeBuddy/ysem"

# 按端口兜底杀掉占用进程（PID 文件丢失或失效时仍能清理）
kill_by_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti ":$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    # 同时杀掉进程组，避免 tsx watch 的子进程残留
    kill -9 $pids 2>/dev/null || true
  fi
}

# 按 PID 文件停止对应进程（tsx watch 会 fork 子进程，需连其子进程一起清理）
stop_by_pidfile() {
  local pidfile="$1"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile" 2>/dev/null)
    if [ -n "$pid" ]; then
      # 先按 PID 杀自身
      kill -9 "$pid" 2>/dev/null || true
      # 再杀其所有子进程（tsx fork 出的 node 子进程），避免残留
      local children
      children=$(pgrep -P "$pid" 2>/dev/null)
      if [ -n "$children" ]; then
        kill -9 $children 2>/dev/null || true
      fi
    fi
    rm -f "$pidfile"
  fi
}

do_stop() {
  echo "========================================="
  echo "  YSEM 停止服务"
  echo "========================================="
  echo ""
  echo "→ 停止后端服务..."
  stop_by_pidfile "$SERVER_PID_FILE"
  kill_by_port "$SERVER_PORT"
  echo "  ✓ 后端已停止"

  echo "→ 停止前端服务..."
  stop_by_pidfile "$CLIENT_PID_FILE"
  kill_by_port "$CLIENT_PORT"
  echo "  ✓ 前端已停止"

  # 端口兜底二次确认（覆盖 PID 文件之外的历史遗留进程）
  kill_by_port "$SERVER_PORT"
  kill_by_port "$CLIENT_PORT"

  sleep 1
  echo ""
  echo "  ✓ 所有服务已停止"
  echo "========================================="
}

do_start() {
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
  cd "$ROOT_DIR/server"

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
  echo "[3/4] 启动后端服务（端口 $SERVER_PORT）..."

  # 端口占用检测：若已被占用，说明已有实例在跑，直接退出避免叠加
  if lsof -ti ":$SERVER_PORT" >/dev/null 2>&1; then
    echo "  ⚠ 端口 $SERVER_PORT 已被占用，后端实例可能已在运行，跳过启动。"
    echo "    如需重启请执行: ./start.sh restart"
  else
    cd "$ROOT_DIR/server"
    nohup npx tsx watch --clear-screen=false src/index.ts > /tmp/ysem-server.log 2>&1 &
    SERVER_PID=$!
    echo "$SERVER_PID" > "$SERVER_PID_FILE"
    echo "  ✓ 后端服务已启动 (PID: $SERVER_PID)"
  fi

  # Step 4: 启动前端服务
  echo ""
  echo "[4/4] 启动前端服务（端口 $CLIENT_PORT）..."
  cd "$ROOT_DIR/client"

  if lsof -ti ":$CLIENT_PORT" >/dev/null 2>&1; then
    echo "  ⚠ 端口 $CLIENT_PORT 已被占用，前端实例可能已在运行，跳过启动。"
    echo "    如需重启请执行: ./start.sh restart"
  else
    nohup npx vite --host > /tmp/ysem-client.log 2>&1 &
    CLIENT_PID=$!
    echo "$CLIENT_PID" > "$CLIENT_PID_FILE"
    echo "  ✓ 前端服务已启动 (PID: $CLIENT_PID)"
  fi

  echo ""
  echo "========================================="
  echo "  🚀 应用启动完成！"
  echo "========================================="
  echo "  前端地址: http://localhost:$CLIENT_PORT"
  echo "  后端 API:  http://localhost:$SERVER_PORT/api"
  echo "  管理员账号: admin / admin123"
  echo ""
  echo "  查看日志:"
  echo "    后端: tail -f /tmp/ysem-server.log"
  echo "    前端: tail -f /tmp/ysem-client.log"
  echo ""
  echo "  服务管理:"
  echo "    停止:   ./start.sh stop"
  echo "    重启:   ./start.sh restart"
  echo "========================================="
}

case "${1:-start}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  *)
    echo "用法: $0 {start|stop|restart}"
    exit 1
    ;;
esac
