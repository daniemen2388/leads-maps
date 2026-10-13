@echo off
cd /d "%~dp0"
start "" http://localhost:4580
node server.mjs
