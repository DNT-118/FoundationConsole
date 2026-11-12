#!/usr/bin/env bash
# Foundation Console 一键安装脚本（Debian/Ubuntu 服务器）
# 用法：bash install.sh   （在发布包根目录执行）
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="pfc"
DEFAULT_MASTER_KEY="$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)"

echo "=============================================="
echo "  Foundation Console 安装"
echo "  目录：$APP_DIR"
echo "=============================================="

# ---------- 1. 检测 Node ----------
if ! command -v node >/dev/null 2>&1; then
  echo "==> 未检测到 Node.js，尝试安装 Node 22（与 package.json engines 对齐）…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "错误：需要 Node >= 22（当前 $(node -v)）"
  exit 1
fi
echo "==> Node $(node -v) 就绪"

# ---------- 2. 安装依赖 ----------
if [ -d "$APP_DIR/server/node_modules" ]; then
  echo "==> 依赖已存在"
else
  echo "==> 安装后端依赖（nodemailer）…"
  (cd "$APP_DIR/server" && npm install --omit=dev 2>/dev/null || true)
  # 若 server 目录无独立依赖，从根目录复制 node_modules 中的 nodemailer
  if [ ! -d "$APP_DIR/server/node_modules/nodemailer" ]; then
    echo "==> 尝试从根 node_modules 复用…"
    [ -d "$APP_DIR/node_modules" ] || (cd "$APP_DIR" && { npm ci --omit=dev 2>/dev/null || npm install --omit=dev; })
  fi
fi

# ---------- 3. 主密钥 ----------
if [ -z "$PFC_MASTER_KEY" ]; then
  if [ -f "$APP_DIR/.pfc_key" ]; then
    PFC_MASTER_KEY="$(cat "$APP_DIR/.pfc_key")"
    echo "==> 使用已有主密钥（.pfc_key）"
  else
    PFC_MASTER_KEY="$DEFAULT_MASTER_KEY"
    echo "$PFC_MASTER_KEY" > "$APP_DIR/.pfc_key"
    chmod 600 "$APP_DIR/.pfc_key"
    echo "==> 已生成主密钥 → .pfc_key（请妥善备份！）"
  fi
fi

# ---------- 4. SSL 证书 ----------
if [ -f "$APP_DIR/certs/cert.pem" ] && [ -f "$APP_DIR/certs/key.pem" ]; then
  echo "==> 检测到 SSL 证书（certs/）→ HTTPS 模式"
else
  echo "==> 未检测到 SSL 证书 → HTTP 模式（生产建议配置证书：certs/cert.pem + certs/key.pem）"
  echo "    可用 certbot 获取：certbot certonly --standalone -d 你的域名 --email 你的邮箱"
fi

# ---------- 5. systemd 服务 ----------
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
echo "==> 写入 systemd 服务：$SERVICE_FILE"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Foundation Console Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/env node $APP_DIR/server/server.js
Environment=PFC_MASTER_KEY=$PFC_MASTER_KEY
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

sleep 1
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "==> ✅ 服务已启动"
else
  echo "==> ⚠️ 服务启动失败，查看日志：journalctl -u $SERVICE_NAME -n 50"
  exit 1
fi

echo ""
echo "=============================================="
echo "  安装完成"
echo "  访问：http://服务器IP:3000  （或 https://域名）"
echo "  首个注册用户自动成为管理员"
echo "  日志：journalctl -u $SERVICE_NAME -f"
echo "  主密钥：$APP_DIR/.pfc_key"
echo "=============================================="
