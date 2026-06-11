.PHONY: dev dev-backend dev-frontend build up down

dev-backend:
	cd backend && .venv/bin/python main.py

dev-frontend:
	npm --workspace frontend run dev

dev:
	make -j2 dev-backend dev-frontend

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down
