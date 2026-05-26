@echo off
setlocal

if exist ".venv\Scripts\python.exe" (
  set "PYTHON=.venv\Scripts\python.exe"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    set "PYTHON=py -3"
  ) else (
    set "PYTHON=python"
  )
)

%PYTHON% -m pip install -r requirements.txt
if errorlevel 1 exit /b 1

%PYTHON% -m PyInstaller --noconfirm --clean lifeos_focus.spec
if errorlevel 1 exit /b 1

echo Built dist\LifeOS Focus.exe
