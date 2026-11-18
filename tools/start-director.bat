@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
echo [AI Sisters v4.1] 正在启动 dsh-pet 破壁剧场增强伴侣脚本...
node "tools\sisters-director.mjs" %*
pause
