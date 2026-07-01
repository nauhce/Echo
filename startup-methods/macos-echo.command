#!/bin/zsh
cd "$(dirname "$0")/.." || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js："
  echo "https://nodejs.org/"
  echo
  read "?按回车退出..."
  exit 1
fi

echo "Echo 正在启动..."
echo "启动后浏览器会自动打开；如果没有打开，请访问 http://localhost:5177"
echo
node server.js

echo
echo "服务已停止。"
read "?按回车退出..."
