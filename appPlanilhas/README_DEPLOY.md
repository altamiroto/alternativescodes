# 🚀 Guia de Deploy — Planilha Offline v4

## Pré-requisitos no VPS

- Node.js 18+ (`node -v`)
- PostgreSQL 14+ rodando
- Banco de dados criado para o app
- Porta liberada no firewall (ex: 3737)

---

## 1. Transferir arquivos para o VPS

```bash
# Via SCP (rode no seu PC):
scp server.js schema.sql usuario@seu-vps:/home/usuario/planilha-app/

# Ou via Git se você usar repositório
```

---

## 2. Instalar dependências

```bash
cd /home/usuario/planilha-app
npm init -y
npm install express pg multer cors dotenv
```

---

## 3. Criar arquivo `.env`

```bash
nano .env
```

Cole e edite com seus dados:
```env
# Banco de dados
DATABASE_URL=postgresql://usuario:senha@localhost:5432/nome_do_banco

# Ou use variáveis individuais (comente DATABASE_URL acima):
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=planilhas
# DB_USER=meu_usuario
# DB_PASS=minha_senha
# DB_SSL=false

# Servidor
PORT=3737

# Token de autenticação (MUDE ISSO! Use algo difícil)
AUTH_TOKEN=meu-token-super-secreto-2024

# Pasta de uploads
UPLOADS_DIR=/home/usuario/planilha-app/uploads
```

---

## 4. Criar tabelas no PostgreSQL

```bash
# Substitua com seu usuário e banco:
psql -U meu_usuario -d nome_do_banco -f schema.sql

# Se precisar de senha:
PGPASSWORD=minha_senha psql -U meu_usuario -d nome_do_banco -f schema.sql
```

---

## 5. Testar manualmente

```bash
node server.js
# Deve mostrar: ✅ PostgreSQL conectado
# Deve mostrar: 🚀 Servidor rodando na porta 3737
```

Teste em outro terminal:
```bash
curl http://localhost:3737/api/health
# {"status":"ok","ts":"..."}
```

---

## 6. Rodar em produção com PM2

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar o servidor
pm2 start server.js --name planilha-server

# Salvar para reiniciar automaticamente após reboot
pm2 save
pm2 startup
# Siga as instruções que aparecerem

# Ver logs
pm2 logs planilha-server
```

---

## 7. Configurar Nginx como proxy reverso (recomendado)

```nginx
# /etc/nginx/sites-available/planilha
server {
    listen 80;
    server_name seu-dominio.com.br;

    # Redireciona para HTTPS (opcional mas recomendado)
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name seu-dominio.com.br;

    # Certificado SSL (use Certbot: sudo certbot --nginx)
    ssl_certificate     /etc/letsencrypt/live/seu-dominio.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seu-dominio.com.br/privkey.pem;

    # Proxy para o Node.js
    location /api/ {
        proxy_pass         http://localhost:3737;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }

    location /files/ {
        proxy_pass         http://localhost:3737;
        # Limite de tamanho para uploads
        client_max_body_size 50M;
    }

    # Servir o app HTML diretamente (opcional)
    location / {
        root /home/usuario/planilha-app/public;
        try_files $uri $uri/ =404;
    }
}
```

```bash
# Ativar e testar:
sudo ln -s /etc/nginx/sites-available/planilha /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 8. SSL gratuito com Certbot

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d seu-dominio.com.br
```

---

## 9. Configurar o App no celular

Abra `planilhasOffline.html` → aba **Config** → preencha:

| Campo | Valor |
|---|---|
| URL do Servidor | `https://seu-dominio.com.br` |
| Token de Acesso | O mesmo do `.env` |

Salve e toque em **Testar Conexão**. Se aparecer ✅, está tudo certo!

---

## 10. Firewall (se não usar Nginx)

```bash
# Liberar porta diretamente (só se não usar Nginx):
sudo ufw allow 3737/tcp
sudo ufw reload
```

---

## 📁 Estrutura final de pastas no VPS

```
/home/usuario/planilha-app/
├── server.js
├── schema.sql
├── .env              ← nunca commitar!
├── package.json
├── node_modules/
├── uploads/          ← fotos e arquivos dos usuários
└── public/
    └── planilhasOffline.html   ← opcional: servir pelo Nginx
```

---

## 🔧 Comandos úteis

```bash
# Ver processos PM2
pm2 list

# Reiniciar servidor após editar server.js
pm2 restart planilha-server

# Ver últimos logs
pm2 logs planilha-server --lines 50

# Backup do banco
pg_dump -U meu_usuario nome_do_banco > backup_$(date +%Y%m%d).sql

# Ver tamanho da pasta uploads
du -sh /home/usuario/planilha-app/uploads/
```

---

## ⚠️ Segurança

1. **Troque o `AUTH_TOKEN`** por algo longo e aleatório:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Use HTTPS** (Certbot é gratuito)
3. **Não exponha a porta 5432** do PostgreSQL externamente
4. **Faça backup** periódico do banco e da pasta `uploads/`
