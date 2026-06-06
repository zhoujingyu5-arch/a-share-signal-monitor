#!/bin/zsh

cd "$(dirname "$0")" || exit 1

echo "========================================"
echo " 全球交易系统 2.0"
echo "========================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js 18 或更高版本："
  echo "https://nodejs.org/"
  echo
  read "?按回车键关闭窗口..."
  exit 1
fi

if curl -fsS --max-time 2 "http://localhost:5173/" >/dev/null 2>&1; then
  echo "服务已经在运行，正在打开网页..."
  open "http://localhost:5173/"
  exit 0
fi

echo "正在启动本地服务..."
echo "网页地址：http://localhost:5173"
echo
echo "请保持此窗口开启。关闭窗口后，网页将停止运行。"
echo "需要停止服务时，在此窗口按 Control + C。"
echo

(sleep 2; open "http://localhost:5173/") &
npm start

echo
read "?服务已停止。按回车键关闭窗口..."
