FROM node:24-slim
WORKDIR /srv
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
RUN node db.js
EXPOSE 3000
CMD ["node", "server.js"]
