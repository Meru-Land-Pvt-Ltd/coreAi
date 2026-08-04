FROM node:22-slim
WORKDIR /app

COPY package*.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci --ignore-scripts \
  && npm rebuild sharp --foreground-scripts

COPY . .

RUN npm run build:shared

WORKDIR /app/apps/backend

RUN npx prisma generate --schema prisma/schema.prisma
# tsc on this codebase needs more heap than Node's in-container default.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

EXPOSE 8787

CMD ["npm", "start"]
