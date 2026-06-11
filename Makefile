.PHONY: dev dev-backend dev-frontend build up down

dev-backend:
	cd backend && python3 main.py

dev-frontend:
	cd frontend && npm run dev

dev:
	make -j2 dev-backend dev-frontend

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down
