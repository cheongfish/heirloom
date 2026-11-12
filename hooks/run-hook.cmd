: << 'CMDBLOCK'
@echo off
REM Polyglot hook wrapper (pattern from Superpowers' run-hook.cmd).
REM Windows: cmd.exe runs this block, finds Git Bash and runs the named hook script.
REM Unix: the shell treats this block as a no-op heredoc and runs the part below.
REM Usage: run-hook.cmd <hook-name>

if "%~1"=="" exit /b 0
setlocal
set "HOOK_DIR=%~dp0"
set "BASH_EXE="
if exist "C:\Program Files\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"
if not defined BASH_EXE if defined LOCALAPPDATA if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "BASH_EXE=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
REM Without bash the hook is skipped; Heirloom then works only through manual handoff.
if not defined BASH_EXE exit /b 0
"%BASH_EXE%" "%HOOK_DIR%%~1"
exit /b %ERRORLEVEL%
CMDBLOCK

# Unix: run the named hook script with bash. $BASH avoids a PATH lookup.
case "$0" in
  */* | *\\*) SCRIPT_DIR="${0%[/\\]*}" ;;
  *) SCRIPT_DIR="." ;;
esac
HOOK_NAME="${1:-}"
[ -n "$HOOK_NAME" ] || exit 0
shift

if [ -n "${BASH:-}" ]; then
  shell="$BASH"
elif command -v bash > /dev/null 2>&1; then
  shell="bash"
else
  exit 0
fi

exec "$shell" "${SCRIPT_DIR}/${HOOK_NAME}" "$@"
