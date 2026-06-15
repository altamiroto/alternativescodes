FROM node:18-alpine

# Criar diretório do app
WORKDIR /app

# Copiar os arquivos de dependência
COPY package*.json ./

# Instalar dependências
RUN npm install --production

# Copiar o restante do código (server.js, etc)
COPY . .

# Criar pasta de uploads e dar permissões
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Usar usuário sem privilégios root para segurança
USER node

# Instalar git para que o Node consiga ler a versão com child_process
USER root
RUN apk add --no-cache git
USER node

# A porta padrão que o servidor Express usa
EXPOSE 3737

# Comando para iniciar
CMD [ "npm", "start" ]
