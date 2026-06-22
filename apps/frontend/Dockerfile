FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN npm install

COPY . .
WORKDIR /app/apps/frontend
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "dev"]
