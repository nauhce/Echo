#!/bin/zsh
echo "正在停止 Echo..."

pids=$(lsof -ti tcp:5177)
if [ -n "$pids" ]; then
  kill $pids
  echo "已停止占用 5177 端口的 Echo 服务。"
else
  echo "没有发现正在运行的 Echo 服务。"
fi

echo
read "?按回车退出..."
