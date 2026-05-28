@echo off
REM ============================================================
REM  Lazy Extension — запуск візуальних тестів у браузері.
REM
REM  Відкриває visual-tests\index.html у браузері за замовчуванням.
REM  Жодного сервера не потрібно — все працює через file://.
REM
REM  Якщо хочеш відкрити саме в Chrome — розкоментуй блок нижче.
REM ============================================================

REM --- Варіант 1 (за замовчуванням): default browser ---
start "" "%~dp0visual-tests\index.html"

REM --- Варіант 2 (опційно): примусово Chrome ---
REM start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "%~dp0visual-tests\index.html"
