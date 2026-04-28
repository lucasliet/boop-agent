FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-fund --no-audit

COPY . .

EXPOSE 3456

CMD ["npx", "tsx", "server/index.ts"]
