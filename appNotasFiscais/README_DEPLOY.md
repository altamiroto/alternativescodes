# 🚀 Publicar no Easypanel: Notas do Estoque

Tempo estimado: 15 minutos. Você só precisa do painel do Easypanel e do DuckDNS.

---

## 1. DuckDNS (endereço do app)

1. Entre em <https://www.duckdns.org>, crie um subdomínio (ex.: `minhasnotas`) e coloque o **IP do VPS**.
2. O endereço final fica `https://minhasnotas.duckdns.org`.
3. No firewall do VPS, as portas **80** e **443** precisam estar abertas (o Easypanel usa para o HTTPS).

> ⚠️ **Esse endereço vai impresso no QR Code das etiquetas.** Escolha um nome definitivo antes de
> imprimir. Se um dia trocar, mantenha o antigo funcionando (passo 5) e as etiquetas velhas continuam valendo.

---

## 2. Banco de dados

No projeto do Easypanel: **+ Service → Postgres**. Nome sugerido: `notas-db`.
Depois de criado, copie a **Internal Connection URL** (algo como `postgres://postgres:SENHA@estoque_notas-db:5432/estoque`).

---

## 3. App

**+ Service → App**, nome `notas`.

**Source → GitHub**
| Campo | Valor |
|---|---|
| Owner / Repository | `altamiroto` / `alternativescodes` |
| Branch | `main` (ou a branch publicada) |
| Build Path | `/appNotasFiscais` |

**Build** → **Dockerfile** (o arquivo já está na pasta).

**Environment** (cole e ajuste):
```env
DATABASE_URL=postgres://...cole a URL interna do passo 2...
PUBLIC_BASE_URL=https://minhasnotas.duckdns.org
SESSION_SECRET=um-texto-longo-e-aleatorio-com-mais-de-40-caracteres
ADMIN_USER=admin
ADMIN_PASSWORD=uma-senha-forte
DATA_DIR=/data
MAX_FILE_MB=10
TZ=America/Sao_Paulo
```

**Mounts** → **Add Volume**: nome `notas-data`, *Mount Path* **`/data`**.
> ⚠️ Sem esse volume, **todos os PDFs, fotos e vídeos somem a cada atualização**.

---

## 4. Domínio e HTTPS

**Domains → Add Domain**
| Campo | Valor |
|---|---|
| Host | `minhasnotas.duckdns.org` |
| HTTPS | ligado |
| Port | `3000` |

Clique em **Deploy**. Nos logs deve aparecer:
```
✅ Banco pronto
🚀 Servidor na porta 3000
```
Teste: `https://minhasnotas.duckdns.org/api/health` → `{"status":"ok",...}`

---

## 5. Usar

| Quem | Endereço | O que faz |
|---|---|---|
| Equipe que envia | `https://minhasnotas.duckdns.org/` | Cadastro (nome + e-mail, uma vez só) e envio das notas |
| Instalar no celular | `https://minhasnotas.duckdns.org/instalar` | Passo a passo Android / iPhone |
| Administrador | `https://minhasnotas.duckdns.org/admin` | Buscar (inclusive por produto), editar, etiquetas, exportar, bloquear usuários |
| Quem recebe o link/QR | `https://minhasnotas.duckdns.org/n/XXXXXXXXXX` | Só visualiza |

**Trocou de domínio?** Adicione o novo em *Domains*, troque o `PUBLIC_BASE_URL` e **não remova o antigo**.
O código de cada nota (`/n/XXXXXXXXXX`) nunca muda, então os dois endereços funcionam.

---

## 6. Backup (recomendado)

Tudo o que importa está em dois lugares: o **banco** e o **volume `/data`**.
- Banco: Easypanel → serviço `notas-db` → *Backups* (se disponível) ou `pg_dump` agendado.
- Arquivos: copie a pasta do volume (`/var/lib/docker/volumes/...notas-data.../_data`) para fora do VPS,
  por exemplo com `rclone` para o Google Drive.

---

## Rodar no computador (opcional, para testar)

```bash
cd appNotasFiscais
cp .env.example .env      # ajuste DATABASE_URL, DATA_DIR=./data, PORT=3000
npm install
npm test                  # testes da chave, leitura de PDF/XML e etiquetas
npm start                 # http://localhost:3000
```
