FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Arquivos enviados e temporários ficam em /data (monte um Volume do Easypanel aqui)
ENV DATA_DIR=/data \
    PORT=3000 \
    TZ=America/Sao_Paulo
RUN mkdir -p /data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
