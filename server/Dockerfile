FROM node:22-alpine

# Misma estructura que el repo (server/ y client/ hermanos): index.js sirve
# el cliente desde src/../../client, es decir /app/client.
WORKDIR /app/server

COPY server/package*.json ./
# --ignore-scripts: ninguna dependencia necesita scripts de instalación, así
# un paquete comprometido no puede ejecutar código al construir la imagen.
RUN npm ci --omit=dev --ignore-scripts

COPY server/src ./src
COPY client /app/client

ENV PORT=3000 \
    NODE_ENV=production
EXPOSE 3000

# Sin privilegios de root: si alguien comprometiera el proceso, no tendría
# permisos sobre el contenedor (la imagen oficial trae el usuario "node").
USER node

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "src/index.js"]
