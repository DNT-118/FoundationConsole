# =============================================
#  Foundation Console 一键安装脚本（Windows）
#  用法：右键"以管理员身份运行" PowerShell，然后：
#    cd 发布包目录
#    powershell -ExecutionPolicy Bypass -File install.ps1
#  功能：安装依赖 → 生成主密钥 → 注册开机自启（任务计划程序）→ 防火墙放行 → 启动
# =============================================

param(
  [string]$InstallDir = "C:\pfc",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=============================================="
Write-Host "  Foundation Console 安装（Windows）"
Write-Host "  源目录：$AppDir"
Write-Host "  安装到：$InstallDir"
Write-Host "  端口：$Port"
Write-Host "=============================================="

# ---------- 1. 检测 Node ----------
# 直接尝试调用（兼容应用执行别名 / nvm 符号链接等 Get-Command 解析不到的情况）
$nodeFull = ""
try { $nodeFull = (& node --version 2>$null).Trim() } catch { }

# 兜底：常见安装路径
if (-not $nodeFull) {
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "$env:ProgramFiles(x86)\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) {
      try { $nodeFull = (& $c --version 2>$null).Trim() } catch { }
      if ($nodeFull) {
        $env:PATH = "$(Split-Path $c);$env:PATH"
        break
      }
    }
  }
}

if (-not $nodeFull) {
  Write-Host "错误：未找到 Node.js。"
  Write-Host "  当前 PATH：$env:PATH"
  Write-Host "  请安装 Node.js LTS：https://nodejs.org/ （安装后重新打开 PowerShell）"
  exit 1
}

# 解析主版本号（Trim 换行 + 正则校验，避免类型转换失败）
$nodeMajor = 0
if ($nodeFull -match '^v?(\d+)') {
  $nodeMajor = [int]$Matches[1]
}
if ($nodeMajor -eq 0) {
  Write-Host "错误：无法解析 Node 版本（输出：'$nodeFull'）"
  exit 1
}
if ($nodeMajor -lt 18) {
  Write-Host "错误：需要 Node >= 18（当前 $nodeFull），请升级：https://nodejs.org/"
  exit 1
}
Write-Host "==> Node $nodeFull 就绪"

# ---------- 2. 检查管理员权限（任务计划程序需要） ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "错误：请以管理员身份运行 PowerShell（任务计划程序注册需要管理员权限）"
  exit 1
}

# ---------- 3. 复制到安装目录 ----------
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
Write-Host "==> 复制文件到 $InstallDir …"
Copy-Item -Path "$AppDir\server" -Destination $InstallDir -Recurse -Force
Copy-Item -Path "$AppDir\dist" -Destination $InstallDir -Recurse -Force
if (Test-Path "$AppDir\certs") { Copy-Item -Path "$AppDir\certs" -Destination $InstallDir -Recurse -Force }

# ---------- 4. 安装后端依赖（nodemailer） ----------
Write-Host "==> 安装后端依赖…"
if (-not (Test-Path "$InstallDir\server\node_modules\nodemailer")) {
  Push-Location "$InstallDir\server"
  npm install --omit=dev 2>&1 | Out-Null
  Pop-Location
  if (-not (Test-Path "$InstallDir\server\node_modules\nodemailer")) {
    Write-Host "错误：nodemailer 安装失败，请手动执行："
    Write-Host "  cd $InstallDir\server"
    Write-Host "  npm install"
    exit 1
  }
}

# ---------- 5. 主密钥 ----------
$keyFile = "$InstallDir\server\data\master.key"
if (Test-Path $keyFile) {
  Write-Host "==> 使用已有主密钥（$keyFile）"
} else {
  New-Item -ItemType Directory -Path "$InstallDir\server\data" -Force | Out-Null
  $key = -join ((48..73) + (97..122) + (48..57) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
  Set-Content -Path $keyFile -Value $key -NoNewline
  Write-Host "==> 已生成主密钥 → $keyFile（请妥善备份！）"
}

# ---------- 6. SSL 证书检测 ----------
$certOk = (Test-Path "$InstallDir\certs\cert.pem") -and (Test-Path "$InstallDir\certs\key.pem")
if ($certOk) {
  Write-Host "==> 检测到 SSL 证书 → HTTPS 模式"
} else {
  Write-Host "==> 未检测到 SSL 证书 → HTTP 模式（生产建议：cert.pem + key.pem 放入 certs\）"
}

# ---------- 7. 生成启动脚本 + 注册开机自启（任务计划程序，系统账户） ----------
$batFile = "$InstallDir\start.bat"
$bat = "@echo off`r`ncd /d `"$InstallDir`"`r`nset PORT=$Port`r`nnode server\server.js`r`n"
Set-Content -Path $batFile -Value $bat -Encoding ASCII
Write-Host "==> 已生成启动脚本：$batFile"

$taskName = "FoundationConsole"
schtasks /Create /F /TN $taskName /TR "`"$batFile`"" /SC ONSTART /RU SYSTEM /RL HIGHEST | Out-Null
Write-Host "==> 已注册开机自启：任务计划程序 → $taskName（系统启动时自动运行）"

# ---------- 8. 防火墙放行 ----------
netsh advfirewall firewall delete rule name="FoundationConsole" | Out-Null
netsh advfirewall firewall add rule name="FoundationConsole" dir=in action=allow protocol=TCP localport=$Port | Out-Null
Write-Host "==> 防火墙已放行 TCP $Port"

# ---------- 9. 立即启动 ----------
schtasks /Run /TN $taskName | Out-Null
Start-Sleep -Seconds 2
Write-Host ""
Write-Host "=============================================="
Write-Host "  安装完成！"
Write-Host "  访问：http://服务器IP:$Port"
Write-Host "  首个注册用户自动成为管理员"
Write-Host "  查看运行状态：任务计划程序 → $taskName"
Write-Host "  手动停止：schtasks /End /TN $taskName"
Write-Host "  手动启动：schtasks /Run /TN $taskName"
Write-Host "  启动脚本：$batFile"
Write-Host "  主密钥：$keyFile"
Write-Host "=============================================="
