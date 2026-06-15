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

# Criar arquivo de versão pegando o hash do último commit no GitHub
RUN apk add --no-cache git && \
    git ls-remote https://github.com/altamiroto/alternativescodes.git HEAD | cut -c 1-7 > /app/public/version.txt || echo "erro" > /app/public/version.txt

# A porta padrão que o servidor Express usa
EXPOSE 3737

# Comando para iniciar
CMD [ "npm", "start" ]
