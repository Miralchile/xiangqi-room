#!/bin/zsh

set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
USER_ID="$(id -u)"
AGENT_DIR="$HOME/Library/LaunchAgents"
APP_LABEL="com.miral.xiangqi-room"
TUNNEL_LABEL="com.miral.xiangqi-tunnel"
APP_PLIST="$AGENT_DIR/$APP_LABEL.plist"
TUNNEL_PLIST="$AGENT_DIR/$TUNNEL_LABEL.plist"
CPOLAR_LOG="$ROOT/logs/cpolar.log"

show_error() {
  local message="$1"
  print -u2 -- "$message"
  if [[ "${XIANGQI_NO_DIALOG:-0}" != "1" ]]; then
    osascript - "$message" <<'APPLESCRIPT'
on run argv
  display dialog (item 1 of argv) with title "中国象棋启动失败" buttons {"确定"} default button "确定" with icon stop
end run
APPLESCRIPT
  fi
  exit 1
}

NODE_BIN="$(command -v node 2>/dev/null || true)"
CPOLAR_BIN="$(command -v cpolar 2>/dev/null || true)"
[[ -x "$NODE_BIN" ]] || show_error "未找到 Node.js，请先安装 Node.js 24 或更高版本。"
[[ -x "$CPOLAR_BIN" ]] || show_error "未找到 cpolar，请先安装并登录 cpolar。"
[[ -f "$ROOT/deploy/local/$APP_LABEL.plist" ]] || show_error "缺少本地服务配置文件。"
[[ -f "$ROOT/deploy/local/$TUNNEL_LABEL.plist" ]] || show_error "缺少 cpolar 配置文件。"
[[ -f "$HOME/.cpolar/cpolar.yml" ]] || show_error "cpolar 尚未登录，请先在终端执行：cpolar authtoken 你的令牌"

mkdir -p "$AGENT_DIR" "$ROOT/logs" "$ROOT/data"
sed -e "s|__PROJECT_ROOT__|$ROOT|g" -e "s|__NODE_BIN__|$NODE_BIN|g" \
  "$ROOT/deploy/local/$APP_LABEL.plist" > "$APP_PLIST"
sed -e "s|__PROJECT_ROOT__|$ROOT|g" -e "s|__CPOLAR_BIN__|$CPOLAR_BIN|g" \
  "$ROOT/deploy/local/$TUNNEL_LABEL.plist" > "$TUNNEL_PLIST"

start_agent() {
  local label="$1"
  local plist="$2"
  if launchctl print "gui/$USER_ID/$label" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$USER_ID/$label"
  else
    launchctl bootstrap "gui/$USER_ID" "$plist"
  fi
}

print -- "正在启动本地象棋服务..."
start_agent "$APP_LABEL" "$APP_PLIST" || show_error "本地象棋服务启动失败，请查看 logs/server-error.log。"

for attempt in {1..20}; do
  if curl -fsS --max-time 1 http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS --max-time 2 http://127.0.0.1:3000/healthz >/dev/null 2>&1 || show_error "本地服务未能在 3000 端口启动。"

print -- "正在连接 cpolar 中国区公网隧道..."
: > "$CPOLAR_LOG"
start_agent "$TUNNEL_LABEL" "$TUNNEL_PLIST" || show_error "cpolar 隧道启动失败，请查看 logs/cpolar-error.log。"

PUBLIC_URL=""
for attempt in {1..60}; do
  PUBLIC_URL="$(curl -fsS --max-time 1 http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -o 'https://[^" ]*' | head -n 1)"
  if [[ -z "$PUBLIC_URL" && -f "$CPOLAR_LOG" ]]; then
    PUBLIC_URL="$(grep -o 'https://[a-zA-Z0-9.-]*\.cpolar\.cn' "$CPOLAR_LOG" | tail -n 1)"
  fi
  [[ -n "$PUBLIC_URL" ]] && break
  sleep 1
done

[[ -n "$PUBLIC_URL" ]] || show_error "60 秒内未取得 cpolar 公网地址。请确认当前网络可连接 cpolar，然后再次双击启动脚本。"

print -- "部署完成：$PUBLIC_URL"
print -- "公网地址已复制到剪贴板。"

if [[ "${XIANGQI_NO_DIALOG:-0}" == "1" ]]; then
  print -- "$PUBLIC_URL"
  exit 0
fi

osascript - "$PUBLIC_URL" <<'APPLESCRIPT'
on run argv
  set publicURL to item 1 of argv
  set the clipboard to publicURL
  set answer to display dialog ("部署完成。公网网址已复制：" & return & return & publicURL & return & return & "切换网络后可再次运行本脚本以获取新网址。") with title "中国象棋" buttons {"仅复制", "打开网站"} default button "打开网站"
  if button returned of answer is "打开网站" then open location publicURL
end run
APPLESCRIPT
