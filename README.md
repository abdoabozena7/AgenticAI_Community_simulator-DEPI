# AgenticAI Community Simulator (DEPI)

A full-stack social simulation app with a FastAPI backend and a Vite + React frontend.

**Repo layout**
- `backend/`: FastAPI server, simulation engine, DB access, and API routes.
- `frontend/`: Vite + React UI.
- `tests/`: Selenium smoke test.

**Prerequisites**
- Python 3.x
- Node.js (LTS recommended)
- MySQL or MariaDB (XAMPP-compatible)

**Quick start (local)**
1. Backend setup
```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

copy backend\.env.example backend\.env
```

2. Create the database and schema
```
# Create DB named agentic_simulator, then run the schema
# backend\app\core\db_schema.sql
```

3. Run the backend (from `backend/`)
```
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

4. Frontend setup and run (from `frontend/`)
```
cd frontend
npm install
npm run dev
```

The frontend expects the backend at the URLs in `frontend/.env`:
- `VITE_API_URL=http://localhost:8000`
- `VITE_WS_URL=ws://localhost:8000`

**Selenium smoke test**
The smoke test lives at `tests/selenium_smoke.py`. It requires a browser driver.

Config options:
- `BROWSER=chrome|firefox`
- `DRIVER_PATH=path\to\chromedriver_or_geckodriver.exe`
- `CHROME_BINARY=path\to\chrome.exe`
- `FIREFOX_BINARY=path\to\firefox.exe`
- `WINDOW_SIZE=1400,900`
- `HEADLESS=1|0`
- `TIMEOUT=25`
- `SCREENSHOT_DIR=path\to\screenshots`

Run:
```
python tests\selenium_smoke.py
```

Note: `selenium` is a test-only dependency and is not currently listed in `requirements.txt`.

**Backend environment**
Use `backend/.env.example` as a reference. It includes MySQL connection info, JWT config, and bootstrap users.

**Useful files**
- `backend/app/core/db_schema.sql`: database schema
- `backend/.env.example`: backend environment template
- `frontend/.env`: frontend environment file





cd d:\projects\Ai\AgenticAI_Community_simulator-DEPI
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload


cd frontend

npm install 
npm run dev
