# Build Windows EXE

1. Install 64-bit Python 3.11 or newer on Windows. Python 3.12 is the most conservative choice for packaging.
2. From this project directory, create a virtual environment:

   ```bat
   py -3.12 -m venv .venv
   .venv\Scripts\activate
   ```

   If you use another installed Python version, replace `py -3.12` with that version.

3. Run:

   ```bat
   build_windows.bat
   ```

   The script automatically uses `.venv\Scripts\python.exe` when it exists, so activating the environment is optional after `.venv` has been created.

4. The desktop app will be created at:

   ```text
   dist\LifeOS Focus.exe
   ```

The app serves the dashboard UI from `web/`, starts the local Flask API in the background, and opens the UI in a desktop WebView window. On Windows, pywebview uses Microsoft Edge WebView2; current Windows 10/11 installations normally already include it.
