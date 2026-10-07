# Notas Fiscais do Estoque — Estruturação e Recomendação

Ferramenta web (PWA) hospedada no VPS via Easypanel para **registrar, consultar e etiquetar**
as notas fiscais (NF-e / DANFE) dos produtos em estoque.

> Pasta do projeto: `appNotasFiscais/` (separada do `appPlanilhas` e do `roboControlev1`).

---

## 1. Resumo da recomendação (TL;DR)

| Tema | Decisão recomendada |
|---|---|
| **Tipo de app** | Um único app web **PWA** (instala no Android e no iPhone pela "Tela de Início"), responsivo para celular e desktop |
| **Stack** | **Node.js + Express + PostgreSQL**, a mesma que você já usa no `appPlanilhas`. Front em HTML/JS puro, sem etapa de build |
| **Arquivos** | Disco do VPS, em um **volume persistente do Easypanel** montado em `/data` |
| **Hospedagem** | Easypanel: 1 serviço **App** (GitHub → Nixpacks) + 1 serviço **PostgreSQL** |
| **Acesso** | 3 níveis: **Público** (quem tem o link vê), **Operador** (envia notas, com PIN), **Admin** (dashboard completo) |
| **Link da nota** | `https://SEU-DOMINIO/n/7KQ2M9XAB3`: código aleatório gerado uma vez e **nunca alterado** |
| **Identificação da nota** | **Chave de acesso de 44 dígitos** (é o que está embaixo do código de barras do DANFE) |
| **Leitura de dados** | Ordem de prioridade: XML → texto do PDF → (fase 2) OCR → só a chave (que já traz CNPJ, nº, série, mês/ano) |
| **Etiquetas** | PDF A4 gerado pelo servidor: 4, 8 ou 16 por folha, com QR Code, link, chave e código de barras |
| **Domínio** | Pode começar com DuckDNS, mas **antes de imprimir em volume** defina o domínio definitivo (veja a seção 3.1) |

Por que não usar uma ferramenta pronta (NocoDB, Directus, Appsmith, Google Forms)? O link público
imutável, as etiquetas em PDF com QR e código de barras, a leitura do DANFE e a tela ultra-simples
para leigos **precisariam ser programados de qualquer jeito**. Um app próprio e pequeno, na stack
que você já conhece e já publica no Easypanel, sai mais simples de manter.

---

## 2. Arquitetura

```
 ┌────────────── Celular (PWA) / Desktop ──────────────┐
 │  /enviar   → tela do operador (3 passos)            │
 │  /n/:slug  → página pública da nota                 │
 │  /admin    → dashboard                              │
 └───────────────────────┬─────────────────────────────┘
                         │ HTTPS (obrigatório p/ PWA e câmera)
            ┌────────────▼────────────┐
            │ Easypanel (Traefik)     │  ← SSL automático (Let's Encrypt)
            └────────────┬────────────┘
            ┌────────────▼────────────────────────────┐
            │ App Node.js (Express)                   │
            │  • API REST + páginas estáticas (PWA)   │
            │  • Leitura de XML/PDF (parse)           │
            │  • Geração do PDF de etiquetas          │
            └──────┬───────────────────────┬──────────┘
                   │                       │
         ┌─────────▼────────┐   ┌──────────▼──────────────┐
         │ PostgreSQL       │   │ Volume /data            │
         │ (dados/metadados)│   │  uploads/AAAA/MM/<id>/  │
         └──────────────────┘   └─────────────────────────┘

 (Fase 3, opcional) WhatsApp → Evolution API → n8n → POST /api/notas
```

---

## 3. Pontos de atenção antes de começar

### 3.1 Domínio, IP e o link "para sempre"
- O QR Code impresso **contém o domínio**. Se o domínio deixar de funcionar, todas as etiquetas
  impressas param de abrir.
- **O DuckDNS não esconde o IP.** Ele só deixa o endereço com um nome bonito. Qualquer pessoa
  que faça `ping seu.duckdns.org` vê o IP do VPS.
- **Recomendado:** registrar um domínio próprio (ex.: `.com.br` no registro.br, cerca de R$ 40/ano)
  e colocá-lo no **Cloudflare (plano grátis) com proxy ativado (nuvem laranja)**. Aí sim o IP
  fica oculto e o domínio é estável. Outra opção sem abrir portas é o *Cloudflare Tunnel*.
- O app foi pensado para **responder em qualquer domínio configurado**: o caminho `/n/<código>`
  não depende do host. Se um dia você trocar de domínio, basta manter o antigo apontando para o
  VPS e cadastrado no Easypanel, e as etiquetas antigas continuam funcionando.

### 3.2 "Número da DANFE" = chave de acesso (44 dígitos)
- O identificador único de uma NF-e é a **chave de acesso**: 44 caracteres em grupos de 4,
  impressos logo abaixo do código de barras do DANFE.
- O **número da nota** (ex.: 123456) **não é único**, porque fornecedores diferentes repetem
  números. O app aceita esse caso como "registro manual", mas deve orientar a pessoa a usar a chave.
- A chave sozinha já informa muita coisa (detalhes na seção 7).
- **Ninguém precisa digitar os 44 dígitos.** O app terá o botão **"Escanear código de barras"**,
  que usa a câmera do celular.

### 3.3 Se houver o XML, ele é melhor que o PDF
O XML da NF-e traz **todos** os dados de forma exata: emitente, valor, itens, datas. Muitos
fornecedores mandam PDF e XML juntos por e-mail ou WhatsApp. O app aceita os dois arquivos.

### 3.4 HTTPS é obrigatório
Sem HTTPS, o celular não instala o PWA e não libera a câmera. O Easypanel emite o certificado
sozinho quando o domínio aponta para o VPS e as portas 80 e 443 estão abertas.

---

## 4. Perfis de acesso

| Perfil | Como entra | O que pode |
|---|---|---|
| **Público** | Só com o link ou QR Code (`/n/<código>`) | Ver dados da nota, abrir/baixar PDF/XML, ver fotos/vídeos, ler comentários, copiar a chave |
| **Operador** | PIN de 6 dígitos, pedido **uma única vez** e lembrado no aparelho por 1 ano | Enviar notas novas; na página pública aparece um botão extra **"Adicionar fotos/comentário"** |
| **Admin** | Usuário e senha (`/admin`) | Tudo: editar campos, trocar/remover arquivos, suspender link, excluir (lixeira), gerar etiquetas, exportar, gerenciar operadores, ver auditoria |

- Cada operador tem o próprio PIN, criado pelo admin, para o sistema registrar **quem enviou** cada nota.
- O link público usa um código aleatório de 10 caracteres (cerca de 10¹⁵ combinações), então não é
  possível "chutar" links de outras notas. As páginas levam `noindex` para não aparecer no Google.
- O admin pode **suspender** o acesso público de uma nota sem mudar o link. Ao reativar, o mesmo
  QR volta a funcionar.

---

## 5. Fluxos de uso

### 5.1 Envio pelo operador (o mais simples possível)

```
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│  NOVA NOTA              │   │  FOTOS / VÍDEOS         │   │         ✅              │
│                         │   │  (opcional)             │   │  Nota registrada!       │
│ ┌─────────────────────┐ │   │                         │   │       Nº 0042           │
│ │ 📄 Tenho o PDF      │ │   │ [ 📷 Tirar foto     ]   │   │                         │
│ │    da nota          │ │ → │ [ 🖼️ Escolher da    ]   │ → │ [ Enviar outra nota ]   │
│ └─────────────────────┘ │   │ [    galeria        ]   │   │ [ Ver registro      ]   │
│ ┌─────────────────────┐ │   │                         │   │                         │
│ │ 🔢 Só tenho o código│ │   │ Comentário (opcional)   │   └─────────────────────────┘
│ │    / chave          │ │   │ [__________________]    │
│ └─────────────────────┘ │   │                         │
│                         │   │ [     ✔ ENVIAR      ]   │
└─────────────────────────┘   └─────────────────────────┘
```

- **"Tenho o PDF"** abre o seletor de arquivos e aceita PDF e XML. Se encontrar a chave no PDF,
  mostra "Nota de FORNECEDOR X, nº 123456" para a pessoa confirmar.
- **"Só tenho o código"** oferece duas opções: **[📷 Escanear código de barras]** ou o campo de
  digitação com máscara `0000 0000 …`. A chave é validada na hora pelo dígito verificador, e um
  erro de digitação aparece em vermelho com a mensagem "confira os números".
- **Nota repetida:** se a chave já existir, o app avisa "Essa nota já foi registrada em 03/10 por
  Maria" e oferece **adicionar as fotos ao registro existente** em vez de duplicar.
- Botões grandes, texto grande, no máximo 3 telas, sem menus. A tela de sucesso deixa claro que
  terminou.
- As fotos são **comprimidas no próprio celular** antes do envio. Uma foto de 6 MB vira cerca de
  1 MB, o envio fica rápido e o limite de 10 MB não é estourado.
- Arquivo acima de 10 MB mostra o aviso amigável "Esse vídeo é grande demais (máx. 10 MB, ~15 s)".

**Enviar um PDF que chegou pelo WhatsApp:**
- **Android:** o PWA instalado aparece no menu **"Compartilhar"** (*Web Share Target*). A pessoa
  toca no PDF no WhatsApp, depois em Compartilhar e em "Notas Estoque", e pronto.
- **iPhone:** o iOS não permite que um PWA apareça no "Compartilhar". O caminho é salvar o PDF em
  "Arquivos" e escolher pelo app. Se isso for difícil para a equipe, a **Fase 3 (bot de WhatsApp)**
  resolve: basta encaminhar o PDF para o número do estoque.

### 5.2 Página pública (`/n/<código>`)
- Cabeçalho: **NF nº 123.456 · Série 1**, emitente, CNPJ, data de emissão e valor total, quando
  esses dados forem conhecidos.
- Chave formatada com botão **"Copiar"**, mais o código de barras desenhado na tela (dá para ler
  com um leitor no balcão).
- Botões **"Ver PDF"** e **"Baixar XML"**, quando existirem.
- Galeria de fotos e vídeos, comentários com data e autor, e a data do registro.
- Botão "Consultar na SEFAZ", que copia a chave e abre o portal oficial.

### 5.3 Dashboard do admin
- Lista com **busca** (chave, número, CNPJ, emitente, comentário) e **filtros**: período, operador,
  "sem PDF", "dados incompletos", **"etiqueta ainda não impressa"**, status.
- Edição dos campos, troca e remoção de arquivos, botão **"Reprocessar leitura"**, suspensão do
  link público e lixeira (exclusão reversível).
- Seleção múltipla e botão **"Gerar etiquetas"**, com escolha do layout (4/8/16) e da **posição
  inicial na folha** (para aproveitar folha de etiqueta adesiva já usada pela metade).
- Exportação CSV/Excel, cadastro de operadores (nome + PIN, ativar/desativar) e auditoria
  (quem fez o quê e quando).
- Status opcional de conferência: *Recebida → Conferida → Com divergência*.

---

## 6. Etiquetas em PDF (A4 = 210 × 297 mm)

| Layout | Grade | Tamanho de cada etiqueta | Conteúdo |
|---|---|---|---|
| **4 por folha** (padrão) | 2 × 2 | 105 × 148,5 mm (A6) | Completo |
| **8 por folha** | 2 × 4 | 105 × 74,25 mm | QR + dados principais + código de barras |
| **16 por folha** | 2 × 8 | 105 × 37,1 mm | QR + nº NF + emitente + chave (sem código de barras) |

**Por que não há código de barras na de 16?** O Code 128 da chave (44 dígitos) tem cerca de 300
módulos. Com 0,3 mm por módulo, ele ocupa cerca de 89 mm de largura e precisa de pelo menos 10 mm
de altura para ser lido. Não sobra espaço com QR e texto em 37 mm de altura. Essa opção pode ser
ligada no admin, mas fica apertada.

Esboço da etiqueta **4 por folha (105 × 148 mm)**:

```
┌───────────────────────────────────────────┐
│ NF 123.456 · Série 1            Reg. #0042│
│ FORNECEDOR EXEMPLO LTDA                   │
│ CNPJ 12.345.678/0001-90                   │
│ Emissão 05/10/2026        Valor R$ 1.234,56│
│                                           │
│            ┌─────────────┐                │
│            │  ▓▓ QR ▓▓   │  ~40 mm        │
│            │  ▓▓CODE▓▓   │                │
│            └─────────────┘                │
│   seu-dominio.com.br/n/7KQ2M9XAB3         │
│                                           │
│ ║│║║│║│║║║│║│║║│║║│║║│║║│║║║│║║│║│║      │  Code 128, ~89 × 15 mm
│ 3526 1012 3456 7800 0190 5500 1000 1234   │
│ 5610 0000 0016                            │
│ Registrado em 07/10/2026                  │
└───────────────────────────────────────────┘
```

Esboço da etiqueta **8 por folha (105 × 74 mm)**:

```
┌───────────────────────────────────────────┐
│ ┌────────┐ NF 123.456 · Série 1    #0042  │
│ │  QR    │ FORNECEDOR EXEMPLO LTDA        │
│ │ ~28mm  │ CNPJ 12.345.678/0001-90        │
│ └────────┘ 05/10/2026 · R$ 1.234,56       │
│ seu-dominio.com.br/n/7KQ2M9XAB3           │
│ ║│║║│║│║║║│║│║║│║║│║║│║║│║║║│║║│║│║      │
│ 3526 1012 3456 7800 0190 5500 1000 ...    │
└───────────────────────────────────────────┘
```

Regras:
- Quando a nota tem **só a chave**, a etiqueta usa os dados extraídos da própria chave (CNPJ,
  nº, série, mês/ano) e omite emitente e valor.
- O QR leva só a URL curta (cerca de 42 caracteres, QR versão 3–4, correção de erro "M"), o que
  garante leitura fácil mesmo em 25 mm.
- O código de 10 caracteres usa alfabeto **sem letras ambíguas** (Crockford: sem I, L, O, U), para
  ser fácil digitar o link impresso se o QR estiver danificado.
- O admin tem **margens de calibração** (deslocamento X/Y em mm) para acertar a impressão em
  papel adesivo.
- O app marca "etiqueta impressa em DD/MM", e a nota sai do filtro "não impressas".
- O PDF é gerado **no servidor** (PDFKit + bwip-js), então sai idêntico em qualquer celular ou
  impressora.

---

## 7. Chave de acesso: estrutura e validação

```
 35  2610  12345678000190  55  001  000123456  1  00000001  6
 │    │         │          │    │       │      │      │     └ DV (dígito verificador)
 │    │         │          │    │       │      │      └ código numérico aleatório
 │    │         │          │    │       │      └ tipo de emissão
 │    │         │          │    │       └ número da NF (9)
 │    │         │          │    └ série (3)
 │    │         │          └ modelo: 55 = NF-e, 65 = NFC-e
 │    │         └ CNPJ do emitente (14)
 │    └ ano/mês de emissão (AAMM)
 └ código da UF (35 = SP)
```

Validação do dígito verificador (módulo 11, pesos 2 a 9 da direita para a esquerda):

```js
function dvChave(c43) {
  let soma = 0, peso = 2;
  for (let i = c43.length - 1; i >= 0; i--) {
    soma += (c43.charCodeAt(i) - 48) * peso;   // dígito: '0'..'9' → 0..9
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
// válida se: chave.length === 44 && dvChave(chave.slice(0, 43)) === Number(chave[43])
```

> ⚠️ **CNPJ alfanumérico:** a Receita passou a emitir CNPJs com letras a partir de 2026. A
> validação deve aceitar `[0-9A-Z]` nas posições do CNPJ (7–20). O `charCodeAt − 48` acima já
> cobre esse caso. **Confirme na Nota Técnica vigente** antes de fechar a regra. Por isso o
> código de barras usa **Code 128 no modo automático**, que aceita letras, e não o subconjunto C
> fixo, que só aceita números.

---

## 8. Leitura de dados (parse)

Pipeline executado no envio, e de novo pelo botão "Reprocessar":

1. **XML enviado?** Lê com `fast-xml-parser` e traz todos os campos com exatidão. `origem = xml`.
2. **PDF com texto?** Extrai o texto com `pdfjs-dist` e aplica regex para:
   - chave: 44 dígitos, com ou sem espaços entre os grupos de 4;
   - emitente (bloco "IDENTIFICAÇÃO DO EMITENTE"), CNPJ, data de emissão, "VALOR TOTAL DA NOTA",
     destinatário.
   - `origem = pdf_texto`.
3. **PDF escaneado (só imagem)?** *Fase 2:* OCR com Tesseract (`ocrmypdf` no container).
4. **Só a chave?** Decompõe a chave (seção 7). `origem = chave`.
5. Registra `parse_status = completo | parcial | so_chave`. No dashboard, "parcial" fica destacado
   para o admin completar à mão.

Os DANFEs variam muito de layout entre emissores, então o parse do PDF é tratado como **"melhor
esforço"**. O que for lido aparece para o operador confirmar e o admin pode corrigir sempre.

---

## 9. Modelo de dados (PostgreSQL)

```sql
CREATE TABLE operadores (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  pin_hash    TEXT NOT NULL,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admins (
  id          SERIAL PRIMARY KEY,
  usuario     TEXT UNIQUE NOT NULL,
  senha_hash  TEXT NOT NULL
);

CREATE TABLE notas (
  id                 SERIAL PRIMARY KEY,               -- nº do registro (#0042)
  slug               TEXT UNIQUE NOT NULL,             -- código do link público — NUNCA muda
  chave              TEXT UNIQUE,                      -- 44 caracteres (pode ser nula em registro manual)
  modelo             TEXT, serie TEXT, numero TEXT, uf TEXT,
  emitente_cnpj      TEXT, emitente_nome TEXT,
  destinatario_cnpj  TEXT, destinatario_nome TEXT,
  data_emissao       DATE,
  valor_total        NUMERIC(14,2),
  origem_dados       TEXT,   -- xml | pdf_texto | ocr | chave | manual
  parse_status       TEXT,   -- completo | parcial | so_chave
  status             TEXT NOT NULL DEFAULT 'recebida', -- recebida | conferida | divergencia
  publico_ativo      BOOLEAN NOT NULL DEFAULT TRUE,
  etiqueta_impressa_em TIMESTAMPTZ,
  criado_por         INT REFERENCES operadores(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ                        -- lixeira
);

CREATE TABLE arquivos (
  id            SERIAL PRIMARY KEY,
  nota_id       INT NOT NULL REFERENCES notas(id),
  tipo          TEXT NOT NULL,   -- nota_pdf | nota_xml | anexo
  nome_original TEXT,
  caminho       TEXT NOT NULL,   -- relativo a /data/uploads (nome gerado, nunca o original)
  mime          TEXT,
  tamanho       BIGINT,
  sha256        TEXT,
  enviado_por   INT REFERENCES operadores(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE comentarios (
  id          SERIAL PRIMARY KEY,
  nota_id     INT NOT NULL REFERENCES notas(id),
  autor       TEXT,
  texto       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auditoria (
  id          BIGSERIAL PRIMARY KEY,
  quem        TEXT,
  acao        TEXT,              -- criou | editou | anexou | suspendeu | excluiu | imprimiu ...
  nota_id     INT,
  detalhes    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Arquivos no disco: `/data/uploads/AAAA/MM/<nota_id>/<uuid>.<ext>`.

---

## 10. Rotas (API)

**Público**
- `GET  /n/:slug`: página pública
- `GET  /api/public/:slug`: dados da nota em JSON
- `GET  /f/:slug/:arquivoId`: arquivo (confere se a nota está ativa)

**Operador** (cookie de sessão após o PIN)
- `POST /api/operador/login` `{ pin }`
- `POST /api/notas` (multipart: `nota` [PDF/XML], `chave`, `anexos[]`, `comentario`) devolve
  `{ slug, url, duplicada }`
- `POST /api/notas/:slug/anexos`: adiciona fotos ou comentário a uma nota existente

**Admin**
- `POST   /api/admin/login`
- `GET    /api/admin/notas?q=&de=&ate=&status=&sem_etiqueta=&parcial=`
- `PATCH  /api/admin/notas/:id` · `DELETE /api/admin/notas/:id` (lixeira) · `POST /api/admin/notas/:id/restaurar`
- `POST   /api/admin/notas/:id/reprocessar`
- `DELETE /api/admin/arquivos/:id`
- `POST   /api/admin/etiquetas` `{ ids[], layout: 4|8|16, inicio: 1..N, offsetX, offsetY }` devolve `application/pdf`
- `GET    /api/admin/export.csv`
- `GET/POST/PATCH /api/admin/operadores`

**URL correta (requisito 11):** o app usa a variável `PUBLIC_BASE_URL`
(ex.: `https://notas.seudominio.com.br`) para montar QR Codes e links. Ela é a fonte da verdade,
porque o QR impresso não pode depender de "por onde o admin acessou". Sem a variável, o app cai no
domínio da requisição (`X-Forwarded-Host`/`X-Forwarded-Proto` do Traefik, com
`app.set('trust proxy', true)`).

---

## 11. Bibliotecas sugeridas

| Uso | Biblioteca |
|---|---|
| Servidor / banco / upload | `express`, `pg`, `multer` (limite 10 MB/arquivo, até 10 arquivos por envio) |
| Segurança | `helmet`, `express-rate-limit`, `bcryptjs`, `express-session` + `connect-pg-simple` |
| Validação de tipo real do arquivo | `file-type` (confere pelos bytes, não pela extensão) |
| Parse | `pdfjs-dist` (texto do PDF), `fast-xml-parser` (XML NF-e) |
| Etiquetas | `pdfkit` (PDF A4) + `bwip-js` (QR Code e Code 128) |
| Miniaturas (opcional) | `sharp` |
| Front: leitura do código de barras | `BarcodeDetector` nativo (Chrome/Android) com *fallback* `zxing-wasm` (iPhone) |
| Front: compressão de foto | Canvas do navegador (sem biblioteca) |

---

## 12. PWA (Android e iOS)
- `manifest.json` com nome "Notas Estoque", ícones 192/512 px (PNG, porque o iOS não aceita ícone
  SVG), `display: standalone`, `start_url: /enviar`, e `share_target` para PDF/XML/imagens
  (Android).
- `sw.js`: cache da "casca" do app para abrir rápido. Na *Fase 2*, uma **fila offline** (IndexedDB)
  guarda o envio sem sinal e manda sozinho quando a internet volta, como já foi feito no
  `appPlanilhas`.
- Página `/instalar` com passo a passo ilustrado:
  - **Android/Chrome:** botão "Instalar app", que usa o prompt nativo.
  - **iPhone/Safari:** "toque em Compartilhar e depois em *Adicionar à Tela de Início*" (o iOS não
    tem botão automático).

---

## 13. Deploy no Easypanel (passo a passo)

1. **Projeto:** criar o projeto `estoque`.
2. **Banco:** adicionar o serviço **PostgreSQL** e copiar a *Internal Connection URL*.
3. **App:** adicionar o serviço **App** com origem **GitHub** `altamiroto/alternativescodes`,
   *Build Path* `/appNotasFiscais` e builder **Nixpacks** (como o `appPlanilhas`).
4. **Variáveis de ambiente:**
   ```env
   DATABASE_URL=postgres://...            # URL interna do passo 2
   PUBLIC_BASE_URL=https://notas.seudominio.com.br
   SESSION_SECRET=<64 caracteres aleatórios>
   ADMIN_USER=admin
   ADMIN_PASSWORD=<senha inicial — trocar no 1º login>
   DATA_DIR=/data
   MAX_FILE_MB=10
   TZ=America/Sao_Paulo
   PORT=3000
   ```
5. **Mounts:** criar o **Volume** `notas-data` montado em **`/data`**.
   ⚠️ **Sem isso, todos os arquivos somem a cada deploy.**
6. **Domains:** cadastrar o domínio (DuckDNS ou próprio), HTTPS ligado, porta 3000. Se no futuro
   trocar de domínio, **adicione** o novo e mantenha o antigo.
7. **DuckDNS (se usar):** criar o subdomínio e apontar para o IP do VPS. Portas 80/443 abertas no
   firewall.
8. **Primeiro acesso:** entrar em `/admin`, trocar a senha, cadastrar os operadores e testar o envio
   pelo celular.

---

## 14. Segurança e backup
- Senhas e PINs guardados apenas como *hash* (bcrypt). *Rate limit* no login: 5 tentativas
  por minuto.
- Os arquivos **nunca** são salvos com o nome original e são servidos com `Content-Type` correto e
  `X-Content-Type-Options: nosniff`. Nada enviado é executado.
- `robots.txt` bloqueando tudo, mais `noindex` nas páginas públicas.
- Toda ação de admin vai para a tabela `auditoria`. A exclusão vai para a lixeira, nunca apaga
  direto.
- **Backup diário** com 2 partes, `pg_dump` do banco e cópia de `/data/uploads`, enviadas para fora
  do VPS (ex.: **rclone → Google Drive**). Um backup que fica só no próprio VPS não protege contra
  perda do VPS.

---

## 15. Estrutura de pastas do projeto

```
appNotasFiscais/
├── ARQUITETURA.md          ← este documento
├── README_DEPLOY.md        ← guia curto do Easypanel (Fase 1)
├── package.json
├── server.js               ← sobe o Express, rotas
├── schema.sql              ← criação das tabelas (roda sozinho no start)
├── src/
│   ├── db.js
│   ├── auth.js             ← sessão admin/operador
│   ├── chave.js            ← validar/decompor chave de acesso
│   ├── parse/
│   │   ├── xml.js
│   │   └── pdf.js
│   ├── etiquetas.js        ← layouts 4/8/16 (PDFKit + bwip-js)
│   └── storage.js          ← salvar/servir arquivos em /data
└── public/
    ├── manifest.json
    ├── sw.js
    ├── icons/
    ├── enviar.html         ← tela do operador
    ├── nota.html           ← página pública /n/:slug
    ├── admin.html          ← dashboard
    ├── instalar.html
    └── css/ js/
```

---

## 16. Roadmap em fases

**Fase 1: MVP (o essencial funcionando)**
- [ ] Envio: PDF/XML **ou** chave (digitada ou escaneada), anexos até 10 MB, comentário
- [ ] Validação da chave + bloqueio de duplicadas
- [ ] Parse de XML e de PDF com texto
- [ ] Página pública com link imutável
- [ ] Dashboard admin: lista, busca, edição, lixeira, suspensão do link
- [ ] Etiquetas 4/8/16 por folha, com posição inicial e calibração
- [ ] PWA instalável + página `/instalar`
- [ ] Deploy no Easypanel com volume e backup

**Fase 2: conforto**
- [ ] OCR para PDF escaneado
- [ ] Fila offline de envios (sem sinal)
- [ ] *Share Target* do Android refinado, miniaturas, exportação Excel
- [ ] Status de conferência e relatórios (notas por fornecedor/mês)

**Fase 3: automação**
- [ ] **Bot de WhatsApp:** o operador só **encaminha** o PDF (ou foto do código de barras) para o
      número do estoque, e o fluxo **Evolution API → n8n → `POST /api/notas`** responde com o link.
      Você já usa Evolution + n8n no `roboControlev1`. É a opção mais simples para leigos,
      principalmente no iPhone.
- [ ] **Download automático do XML na SEFAZ** pela chave (*NF-e Distribuição DF-e*), usando o
      **certificado digital A1** da empresa. Funciona para notas emitidas **contra o seu CNPJ** e,
      para receber o XML completo, normalmente exige a *manifestação do destinatário* ("ciência da
      operação"). Com isso, só a chave já bastaria para ter todos os dados.

---

## 17. Decisões que dependem de você
1. **Domínio definitivo:** DuckDNS ou domínio próprio + Cloudflare? (recomendado o segundo, antes
   de imprimir em volume)
2. **Operadores com PIN individual** (sabe quem enviou) ou **um PIN único da equipe**?
3. Quem tem o link público pode **só ver** (proposta) ou também **adicionar fotos**? (na proposta,
   adicionar só com PIN de operador)
4. Papel das etiquetas: **folha A4 comum** (recortar) ou **adesiva A4**? Se adesiva, qual modelo,
   para casar as medidas.
5. Vale incluir já na Fase 1 o **status de conferência** (recebida/conferida/divergência)?
