FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm install

COPY . .
WORKDIR /app/apps/backend
RUN npm run build

EXPOSE 8787
CMD ["npm", "run", "dev"]
