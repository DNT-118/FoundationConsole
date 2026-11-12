#!/usr/bin/env bash
# 构建 Foundation Console 发布包：前端 dist/ + 混淆后的后端（server-dist/ → 包内 server/）。
# 发布包不包含任何运行数据（server/data/）；首次启动时自动创建数据目录与主密钥。
#
# 用法：
#   ./build-package.sh            # 安装依赖 → 测试 → 构建 → 混淆 → 打包
#   SKIP_TESTS=1 ./build-package.sh
#   SKIP_INSTALL=1 ./build-package.sh   # 已安装依赖时跳过 npm ci（CI 中使用）
# 产物：
#   release/fdc-v<版本>.tar.gz 及 release/fdc-v<版本>.tar.gz.sha256
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VERSION="${FDC_VERSION:-$(node -p "require('./package.json').version")}"
VERSION="${VERSION#v}"
NAME="fdc-v${VERSION}"
OUT_DIR="$ROOT_DIR/release"
PACKAGE_DIR="$OUT_DIR/$NAME"
ARCHIVE_PATH="$OUT_DIR/$NAME.tar.gz"

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  echo "==> [1/5] 安装锁定依赖"
  npm ci
  npm ci --prefix server
fi

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "==> [2/5] 运行测试"
  npm test
fi

echo "==> [3/5] 构建前端"
npm run build

echo "==> [4/5] 混淆后端并组装发布目录"
node server/obfuscate.js
rm -rf -- "$PACKAGE_DIR" "$ARCHIVE_PATH" "$ARCHIVE_PATH.sha256"
mkdir -p "$PACKAGE_DIR/docs"
cp -R dist "$PACKAGE_DIR/dist"
cp -R server-dist "$PACKAGE_DIR/server"
cp scripts/install.sh scripts/install.ps1 scripts/pfc.service "$PACKAGE_DIR/"   # 安装脚本需位于包根目录
cp README.md LICENSE NOTICE SECURITY.md .env.example "$PACKAGE_DIR/"
cp docs/*.md "$PACKAGE_DIR/docs/"
# 双重保险：发布包内绝不包含运行数据或私钥
rm -rf -- "$PACKAGE_DIR/server/data"
if find "$PACKAGE_DIR" \( -name 'master.key' -o -name '*.pem' -o -name 'users.json' -o -name 'sessions.json' \) | grep -q .; then
  echo "错误：发布目录中发现运行数据或密钥文件，已中止" >&2
  exit 1
fi

echo "==> [5/5] 生成压缩包与校验值"
tar -C "$OUT_DIR" --owner=0 --group=0 --numeric-owner -czf "$ARCHIVE_PATH" "$NAME"
(cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")

echo "完成："
echo "  $ARCHIVE_PATH"
echo "  $ARCHIVE_PATH.sha256"
