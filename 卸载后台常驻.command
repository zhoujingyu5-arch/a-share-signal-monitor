#!/bin/zsh

LABEL="com.zhoujy.global-signal-monitor"
PLIST_TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST_TARGET"

echo "后台常驻服务已卸载。"
read "?按回车键关闭窗口..."
