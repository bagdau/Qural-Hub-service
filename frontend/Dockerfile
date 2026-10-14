# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM alpine:3.20 AS cert
RUN apk add --no-cache openssl && mkdir /certs && openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -keyout /certs/server.key -out /certs/server.crt     -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" && chmod 644 /certs/server.key

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY nginx/app-server.conf /etc/nginx/app-server.conf
COPY --chmod=755 nginx/10-certs.sh /docker-entrypoint.d/10-certs.sh
COPY --from=cert /certs /opt/default-certs
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080 8443
