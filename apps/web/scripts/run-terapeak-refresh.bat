@echo off
cd /d "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\apps\web"
"C:\Program Files\nodejs\npx.cmd" tsx scripts/terapeak-research-refresh.ts --limit 50 >> "%USERPROFILE%\.hadley-bricks\terapeak-refresh.log" 2>&1
