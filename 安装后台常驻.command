#!/bin/zsh

set -e
cd "$(dirname "$0")"

LABEL="com.zhoujy.global-signal-monitor"
PLIST_SOURCE="$PWD/$LABEL.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents"
launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
cp "$PLIST_SOURCE" "$PLIST_TARGET"
launchctl bootstrap "$DOMAIN" "$PLIST_TARGET"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo
echo "全球交易系统后台服务已安装。"
echo "地址：http://localhost:5173"
echo "服务会在登录后自动启动，并在意外退出时自动重启。"
echo
open "http://localhost:5173/"
read "?按回车键关闭窗口..."
