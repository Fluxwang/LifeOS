# Build Windows EXE

1. Install 64-bit Python 3.11 or newer on Windows.
2. From this project directory, run:

   ```bat
   build_windows.bat
   ```

3. The desktop app will be created at:

   ```text
   dist\LifeOS Focus.exe
   ```

The app serves the dashboard UI from `web/`, starts the local Flask API in the background, and opens the UI in a desktop WebView window. On Windows, pywebview uses Microsoft Edge WebView2; current Windows 10/11 installations normally already include it.
