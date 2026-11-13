.PHONY: run test docker
run:
	./run.sh
test:
	. .venv/bin/activate && python -m pytest -q && node --check static/app.js && node --check static/chat.js && node --check static/sw.js
docker:
	docker build -t astrotwin . && docker run --rm -p 8000:8000 astrotwin
