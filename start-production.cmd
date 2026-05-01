@echo off
cd /d "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\apps\web"
set NODE_ENV=production
set NODE_OPTIONS=--max-old-space-size=2048
"C:\Program Files\nodejs\node.exe" "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\node_modules\next\dist\bin\next" start
