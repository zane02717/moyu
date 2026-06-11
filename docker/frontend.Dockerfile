FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY frontend ./frontend
RUN npm run build:frontend

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
