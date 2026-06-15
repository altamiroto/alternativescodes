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

# Criar arquivo de versão com a data do build (para controle na interface)
RUN echo $(date +'%d/%m %H:%M') > /app/public/version.txt

# A porta padrão que o servidor Express usa
EXPOSE 3737

# Comando para iniciar
CMD [ "npm", "start" ]
