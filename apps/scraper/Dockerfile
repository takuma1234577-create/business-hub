FROM node:22-slim

# Chromiumインストール
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-ipafont-gothic fonts-ipafont-mincho \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 3002
CMD ["node", "dist/server.js"]
