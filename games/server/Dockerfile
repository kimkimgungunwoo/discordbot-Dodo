FROM node:22-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ .
COPY shared/ /app/shared/
CMD ["npx", "tsx", "src/index.ts"]
