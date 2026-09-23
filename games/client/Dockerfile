FROM node:22-alpine AS build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ .
COPY shared/ /app/shared/
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/client/dist /srv
COPY client/Caddyfile /etc/caddy/Caddyfile
