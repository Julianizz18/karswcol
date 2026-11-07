FROM node:20-alpine

# Misma estructura que el repo (server/ y client/ hermanos): index.js sirve
# el cliente desde src/../../client, es decir /app/client.
WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/src ./src
COPY client /app/client

ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
