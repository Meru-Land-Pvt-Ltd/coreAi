FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/backend/package.json ./apps/backend/package.json

RUN npm install

COPY . .

WORKDIR /app/apps/backend

RUN npx prisma generate --schema prisma/schema.prisma
RUN npm run build

EXPOSE 8787

CMD ["npm", "start"]