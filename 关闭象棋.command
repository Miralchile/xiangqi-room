#!/bin/zsh

set -u

USER_ID="$(id -u)"

stop_agent() {
  local label="$1"
  launchctl bootout "gui/$USER_ID/$label" >/dev/null 2>&1 || true
}

stop_agent "com.miral.xiangqi-tunnel"
stop_agent "com.miral.xiangqi-room"

print -- "中国象棋本地服务与公网隧道已关闭。"

if [[ "${XIANGQI_NO_DIALOG:-0}" != "1" ]]; then
  osascript <<'APPLESCRIPT'
display dialog "本地象棋服务与 cpolar 公网隧道已关闭。" with title "中国象棋" buttons {"确定"} default button "确定"
APPLESCRIPT
fi
