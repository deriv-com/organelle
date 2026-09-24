.PHONY: dev build test typecheck lint db db-down migrate seed check

dev:
	NODE_ENV=development npm run dev

build:
	npm run build

test:
	npm test

typecheck:
	npm run typecheck

lint:
	npm run lint

db:
	docker compose up -d db

db-down:
	docker compose down

migrate:
	npm run db:migrate

seed:
	npm run db:seed:demo

check:
	npm run format:check
	npm run typecheck
	npm run lint
	npm test
	npm run check:references
	npm run check:licenses
	npm audit --omit=dev --audit-level=high
