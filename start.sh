#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

echo "======================================"
echo "  Tamil Audio Transcriber"
echo "  Model: Systran/faster-whisper-large-v3"
echo "======================================"

# ── Python venv ────────────────────────────────
if [ ! -d "$ROOT/.venv" ]; then
  echo "[1/3] Creating Python virtual environment..."
  python3 -m venv "$ROOT/.venv"
fi

source "$ROOT/.venv/bin/activate"

echo "[2/3] Installing Python dependencies..."
pip install --upgrade pip
pip install -r "$BACKEND/requirements.txt"

echo "[3/3] Starting backend (FastAPI on http://localhost:8000)..."
echo ""
echo "  Backend  -> http://localhost:8000"
echo "  Frontend -> open frontend/index.html in your browser"
echo ""
echo "  NOTE: Systran/faster-whisper-large-v3 (~3 GB) will be"
echo "        downloaded on first run. Please be patient."
echo ""
echo "  Press Ctrl+C to stop."
echo "======================================"

# Open the frontend automatically
if command -v open &>/dev/null; then
  open "$FRONTEND/index.html"
elif command -v xdg-open &>/dev/null; then
  xdg-open "$FRONTEND/index.html"
fi

cd "$BACKEND"
python main.py
