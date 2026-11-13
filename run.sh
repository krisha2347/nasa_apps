#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements-dev.txt
python -m pytest -q
echo "AstroTwin running at http://localhost:8000  (API docs: /docs)"
uvicorn app.main:app --reload --port 8000
