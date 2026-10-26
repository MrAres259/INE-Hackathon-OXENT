@echo off
rem ============================================================================
rem  ATALAYA - despliegue publico tolerante a fallos (Windows / CMD)
rem
rem  Uso:  deploy.cmd [accion] [puerto]
rem    install   (default) Prepara, compila, publica y deja la app como servicio:
rem              tarea "ATALAYA" (arranca con Windows, se relanza si falla) y
rem              tarea "ATALAYA-Watchdog" (cada 5 min reinicia todo si no responde).
rem    start     Levanta la app en segundo plano sin instalar tareas.
rem    stop      Detiene la app (modo mantenimiento: el vigilante no la revive).
rem    restart   Detiene y vuelve a levantar.
rem    status    Estado del supervisor, de las tareas y salud de la app.
rem    rebuild   Recompila el frontend y reinstala (usar tras actualizar el codigo).
rem    uninstall Quita las tareas programadas y detiene la app.
rem    logs      Ultimas lineas de los logs.
rem    watchdog  (uso interno de la tarea ATALAYA-Watchdog)
rem
rem  Tolerancia a fallos, por capas:
rem    1. Supervisor (backend\atalaya\ops\supervisor.py): reinicia API, web o
rem       borde Caddy si su proceso muere o falla la salud 3 veces seguidas.
rem    2. Tarea "ATALAYA" (SYSTEM): arranca con la maquina y relanza el
rem       supervisor si termina con error.
rem    3. Tarea "ATALAYA-Watchdog": si /api/health falla 3 veces seguidas,
rem       reinicia supervisor y servicios (cubre un supervisor colgado).
rem
rem  Solo se publica el puerto del borde Caddy (default 8080). El puerto 80 lo
rem  usa otra aplicacion de esta maquina y se rechaza.
rem ============================================================================
setlocal EnableExtensions EnableDelayedExpansion

rem Relanzamiento elevado: ejecuta la accion y deja la ventana abierta para leer el resultado.
if /i "%~3"=="--elevated" (
    call "%~f0" %1 %2
    echo.
    pause
    exit /b
)

set "SELF=%~f0"
cd /d "%~dp0"
set "ROOT=%CD%"
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "CACHE=%ROOT%\data\cache"
set "LOGS=%CACHE%\logs"
set "PORTFILE=%CACHE%\deploy_port.txt"
set "MAINT=%CACHE%\maintenance.flag"
set "SERVE=%ROOT%\scripts\serve_public.ps1"
set "TASK=ATALAYA"
set "WDTASK=ATALAYA-Watchdog"
set "PS=powershell -NoProfile -ExecutionPolicy Bypass"

if not exist "%LOGS%" mkdir "%LOGS%" >nul 2>&1

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=install"
set "PORT=%~2"
if "%PORT%"=="" if defined ATALAYA_PORT set "PORT=%ATALAYA_PORT%"
if "%PORT%"=="" if exist "%PORTFILE%" set /p PORT=<"%PORTFILE%"
if "%PORT%"=="" set "PORT=8080"

if /i "%ACTION%"=="watchdog" goto :watchdog
if /i "%ACTION%"=="status"   goto :status
if /i "%ACTION%"=="logs"     goto :logs

call :require_admin %*
if errorlevel 2 exit /b 0
if errorlevel 1 exit /b 1

if /i "%ACTION%"=="install"   goto :install
if /i "%ACTION%"=="rebuild"   goto :install
if /i "%ACTION%"=="start"     goto :start
if /i "%ACTION%"=="stop"      goto :stop
if /i "%ACTION%"=="restart"   goto :restart
if /i "%ACTION%"=="uninstall" goto :uninstall

echo [-] Accion desconocida: %ACTION%
echo     Uso: deploy.cmd [install^|start^|stop^|restart^|status^|rebuild^|uninstall^|logs] [puerto]
exit /b 1

rem ---------------------------------------------------------------- install / rebuild
:install
call :banner "Despliegue publico de ATALAYA en el puerto %PORT%"
call :preflight || exit /b 1
del /q "%MAINT%" >nul 2>&1
> "%PORTFILE%" echo %PORT%

set "REBUILD_FLAG="
if /i "%ACTION%"=="rebuild" set "REBUILD_FLAG=-Rebuild"
rem Una sola instancia: si ya hay supervisor o tarea en marcha, se detienen antes de reinstalar
rem (si no, la tarea relanzaria cada minuto un segundo supervisor que sale con codigo 3).
schtasks /End /TN "%TASK%" >nul 2>&1
call :stop_supervisor

echo [*] Instalando la tarea "%TASK%" y levantando la app...
%PS% -File "%SERVE%" -Port %PORT% -Install %REBUILD_FLAG%
if errorlevel 1 (
    echo [-] serve_public.ps1 fallo. Revisa "%LOGS%\supervisor.log".
    exit /b 1
)

echo [*] Instalando el vigilante "%WDTASK%" (cada 5 minutos)...
schtasks /Create /TN "%WDTASK%" /TR "\"%SELF%\" watchdog %PORT%" /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F >nul
if errorlevel 1 (
    echo [!] No se pudo crear la tarea "%WDTASK%". La app sigue supervisada por la capa 1 y 2.
) else (
    echo [+] Vigilante instalado.
)

call :check_health 60
if errorlevel 1 (
    echo [-] La app no respondio en http://127.0.0.1:%PORT%/api/health.
    exit /b 1
)
call :summary
exit /b 0

rem ---------------------------------------------------------------- start (sin tareas)
:start
call :banner "Inicio de ATALAYA en segundo plano (sin tareas programadas)"
call :preflight || exit /b 1
del /q "%MAINT%" >nul 2>&1
> "%PORTFILE%" echo %PORT%
%PS% -File "%SERVE%" -Port %PORT%
if errorlevel 1 exit /b 1
call :summary
exit /b 0

rem ---------------------------------------------------------------- stop
:stop
call :banner "Deteniendo ATALAYA (modo mantenimiento)"
> "%MAINT%" echo detenido manualmente %DATE% %TIME%
call :stop_supervisor
echo [+] Detenida. El vigilante no la revivira hasta "deploy.cmd start" o "deploy.cmd install".
echo     Al reiniciar Windows la tarea "%TASK%" la levanta de nuevo (usa "uninstall" para evitarlo).
exit /b 0

rem ---------------------------------------------------------------- restart
:restart
call :banner "Reiniciando ATALAYA"
call :stop_supervisor
del /q "%MAINT%" >nul 2>&1
schtasks /Query /TN "%TASK%" >nul 2>&1
if errorlevel 1 (
    %PS% -File "%SERVE%" -Port %PORT%
) else (
    schtasks /Run /TN "%TASK%" >nul
)
call :check_health 240
if errorlevel 1 (
    echo [-] La app no respondio tras reiniciar.
    exit /b 1
)
call :summary
exit /b 0

rem ---------------------------------------------------------------- uninstall
:uninstall
call :banner "Desinstalando ATALAYA"
schtasks /Delete /TN "%WDTASK%" /F >nul 2>&1 && echo [+] Tarea "%WDTASK%" eliminada.
%PS% -File "%SERVE%" -Uninstall
del /q "%MAINT%" >nul 2>&1
echo [+] ATALAYA desinstalada. La regla de firewall se conserva (quitala en "Firewall de Windows" si ya no la necesitas).
exit /b 0

rem ---------------------------------------------------------------- status
:status
call :banner "Estado de ATALAYA (puerto %PORT%)"
%PS% -File "%SERVE%" -Status
echo.
for %%T in ("%TASK%" "%WDTASK%") do (
    schtasks /Query /TN %%T >nul 2>&1
    if errorlevel 1 (
        echo  Tarea %%~T: no instalada
    ) else (
        for /f "tokens=2 delims=:" %%S in ('schtasks /Query /TN %%T /FO LIST ^| findstr /b /c:"Status"') do echo  Tarea %%~T:%%S
    )
)
if exist "%MAINT%" echo  Modo mantenimiento: ACTIVO (detenida a proposito)
call :check_health 1
if errorlevel 1 (
    echo  Salud: SIN RESPUESTA en http://127.0.0.1:%PORT%/api/health
    exit /b 1
)
echo  Salud: OK en http://127.0.0.1:%PORT%/api/health
exit /b 0

rem ---------------------------------------------------------------- logs
:logs
for %%L in (supervisor backend frontend edge watchdog) do (
    if exist "%LOGS%\%%L.log" (
        echo ===== %%L.log =====
        %PS% -Command "Get-Content -LiteralPath '%LOGS%\%%L.log' -Tail 25"
        echo.
    )
)
exit /b 0

rem ---------------------------------------------------------------- watchdog (tarea cada 5 min)
:watchdog
set "WDLOG=%LOGS%\watchdog.log"
if exist "%MAINT%" exit /b 0
rem Gracia de arranque: no actuar si el supervisor se inicio hace menos de 5 minutos.
set "AGE=999999"
if exist "%CACHE%\supervisor.pid" (
    for /f %%A in ('%PS% -Command "[int]^(^(Get-Date^)-^(Get-Item -LiteralPath '%CACHE%\supervisor.pid'^).LastWriteTime^).TotalSeconds"') do set "AGE=%%A"
)
if !AGE! LSS 300 exit /b 0
set /a FAILS=0
for /L %%i in (1,1,3) do (
    call :probe
    if errorlevel 1 (
        set /a FAILS+=1
        if %%i LSS 3 ping -n 21 127.0.0.1 >nul
    ) else (
        exit /b 0
    )
)
>> "%WDLOG%" echo [%DATE% %TIME%] /api/health fallo !FAILS! veces seguidas en :%PORT%; reiniciando ATALAYA
schtasks /End /TN "%TASK%" >nul 2>&1
call :stop_supervisor >> "%WDLOG%" 2>&1
ping -n 6 127.0.0.1 >nul
schtasks /Query /TN "%TASK%" >nul 2>&1
if errorlevel 1 (
    >> "%WDLOG%" echo [%DATE% %TIME%] tarea %TASK% no existe; lanzando supervisor en segundo plano
    %PS% -File "%SERVE%" -Port %PORT% >> "%WDLOG%" 2>&1
) else (
    schtasks /Run /TN "%TASK%" >> "%WDLOG%" 2>&1
)
exit /b 0

rem ============================================================================ subrutinas

:banner
echo ==========================================================
echo  %~1
echo ==========================================================
exit /b 0

:require_admin
rem Devuelve 0 si ya es administrador; 2 si relanzo elevado; 1 si no pudo.
net session >nul 2>&1
if not errorlevel 1 exit /b 0
echo [*] Se requieren permisos de administrador; solicitando elevacion...
%PS% -Command "Start-Process -FilePath '%SELF%' -ArgumentList '%ACTION% %PORT% --elevated' -Verb RunAs -WorkingDirectory '%ROOT%'" >nul 2>&1
if errorlevel 1 (
    echo [-] No se obtuvieron permisos de administrador. Abre CMD "como administrador".
    exit /b 1
)
exit /b 2

:preflight
echo [*] Verificando requisitos...
if "%PORT%"=="80" (
    echo [-] El puerto 80 lo usa otra aplicacion de esta maquina. Usa otro, p. ej. 8080.
    exit /b 1
)
where python >nul 2>&1 || (echo [-] No se encontro python en el PATH. Instala Python 3.12. & exit /b 1)
where node >nul 2>&1 || (echo [-] No se encontro node en el PATH. Instala Node.js. & exit /b 1)
where npm.cmd >nul 2>&1 || (echo [-] No se encontro npm en el PATH. & exit /b 1)
where curl.exe >nul 2>&1 || (echo [-] No se encontro curl.exe ^(viene con Windows 10/Server 2019 o superior^). & exit /b 1)

python -c "import fastapi, uvicorn, sse_starlette, opensearchpy, pandas, pyarrow, httpx, dotenv" >nul 2>&1
if errorlevel 1 (
    echo [*] Instalando dependencias de Python ^(backend\requirements.txt^)...
    python -m pip install -r "%BACKEND%\requirements.txt" || (echo [-] Fallo pip install. & exit /b 1)
)
if not exist "%FRONTEND%\node_modules\next\package.json" (
    echo [*] Instalando dependencias del frontend ^(npm ci^)...
    pushd "%FRONTEND%"
    call npm.cmd ci --no-audit --no-fund
    if errorlevel 1 (
        popd
        echo [-] Fallo npm ci.
        exit /b 1
    )
    popd
)
if not exist "%ROOT%\data\build\units.parquet" (
    echo [-] Faltan los datos del modelo ^(data\build\units.parquet^).
    echo     Genera el pipeline primero: powershell -ExecutionPolicy Bypass -File scripts\build_all.ps1
    exit /b 1
)
if not exist "%ROOT%\frontend\public\geo\tiles.json" (
    echo [-] Faltan las teselas del mapa ^(frontend\public\geo\tiles.json^).
    echo     Generalas: cd tools\geo ^&^& node --max-old-space-size=6144 build_geo.mjs --tiles-only
    exit /b 1
)
if not exist "%BACKEND%\.env" (
    echo [!] No existe backend\.env: la app funcionara con datos en memoria y sin asistente LLM.
    echo     Plantilla: backend\.env.example
)
echo [+] Requisitos OK.
exit /b 0

:stop_supervisor
if exist "%CACHE%\supervisor.pid" (
    %PS% -File "%SERVE%" -Stop
) else (
    echo [*] No hay supervisor en ejecucion.
)
exit /b 0

:probe
rem 0 = /api/health responde 200; 1 = falla.
set "HC=000"
for /f %%C in ('curl.exe -s -o nul -m 10 -w "%%{http_code}" "http://127.0.0.1:%PORT%/api/health" 2^>nul') do set "HC=%%C"
if "%HC%"=="200" exit /b 0
exit /b 1

:check_health
rem %1 = segundos maximos de espera.
set /a WAITMAX=%~1
set /a WAITED=0
:check_health_loop
call :probe
if not errorlevel 1 exit /b 0
if !WAITED! GEQ !WAITMAX! exit /b 1
ping -n 3 127.0.0.1 >nul
set /a WAITED+=2
goto :check_health_loop

:summary
set "PUBLIC_URL=%ATALAYA_PUBLIC_URL%"
if "%PUBLIC_URL%"=="" (
    for /f %%I in ('curl.exe -s -m 5 https://api.ipify.org 2^>nul') do set "PUBLIC_URL=http://%%I:%PORT%"
)
if "%PUBLIC_URL%"=="" set "PUBLIC_URL=http://46.250.172.193:%PORT%"
echo.
echo ==========================================================
echo  ATALAYA en linea y supervisada
echo ==========================================================
echo  Local:    http://localhost:%PORT%
echo  Publica:  %PUBLIC_URL%
echo.
echo  Si la URL publica no abre desde internet, permite TCP %PORT% de entrada
echo  en el security group de la ECS ^(consola de Huawei Cloud^).
echo  Estado:   deploy.cmd status      Logs: deploy.cmd logs
echo  Detener:  deploy.cmd stop        Quitar: deploy.cmd uninstall
echo ==========================================================
exit /b 0
