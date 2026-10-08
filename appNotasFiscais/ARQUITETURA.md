# Notas Fiscais do Estoque: Arquitetura e Decisões

Ferramenta web (PWA) hospedada no VPS via Easypanel para **registrar, consultar e etiquetar**
as notas fiscais (NF-e / DANFE) dos produtos em estoque.

- Como publicar: [`README_DEPLOY.md`](README_DEPLOY.md)
- Status: **Fase 1 implementada** (seção 10).

---

## 1. Decisões tomadas

| Tema | Decisão |
|---|---|
| **Stack** | Node.js 22 + Express + PostgreSQL. Front em HTML/JS puro, sem etapa de build. Mesma linha do `appPlanilhas` |
| **Banco** | Usa o **Postgres já existente** (compartilhado com outros sistemas). Tudo fica no schema próprio `DB_SCHEMA` (padrão `notas_fiscais`), criado automaticamente com as tabelas na inicialização. Se o banco não existir, também é criado |
| **App** | PWA instalável no Android e no iPhone, pensado primeiro para celular e funcionando no desktop |
| **Domínio** | **DuckDNS**. O endereço público vem de `PUBLIC_BASE_URL`, nunca do endereço por onde alguém acessou |
| **Quem envia** | **Qualquer pessoa com o link principal.** Identificação **só pelo e-mail** (o nome é pedido apenas na primeira vez). Com o mesmo e-mail, a pessoa vê as mesmas notas em qualquer aparelho. O aparelho lembra o login (cookie de 2 anos + cópia local) |
| **Função principal** | **Imprimir a etiqueta quase completa da nota para colar no produto, no lugar da nota inteira.** Não existe "só registrar": toda nota adicionada entra na **fila de impressão**, que é a tela inicial |
| **Quem imprime** | Cada pessoa cadastrada vê e imprime **as notas que ela adicionou**. O admin vê todas. `IMPRESSAO_SO_ADMIN=true` restringe a impressão ao admin |
| **Compartilhar** | Não existe nas telas: o objetivo é registrar e imprimir |
| **Quem só tem o link da nota** | **Só visualiza.** Não edita nem acrescenta nada. Errou? Faz um **novo registro** |
| **Administrador** | Usuário/senha (variáveis de ambiente). Edita, remove arquivos, suspende o link, lixeira, etiquetas, exporta, **busca por produto**, bloqueia usuários |
| **Nota repetida** | Permitida (é o "fazer de novo"). O app **avisa** que a chave já foi registrada |
| **Etiquetas** | Papel A4 comum, **preto e branco**, com linhas de corte, presas com fita. Estilo **etiqueta de transportadora**: dados da NF-e em destaque, QR do sistema **médio e discreto** no canto |
| **Valor da nota** | **Não aparece** na etiqueta, na página pública nem na tela de envio. Fica só no painel do admin. Quem precisar abre o PDF ou consulta pela chave |
| **Status de conferência** | Sem campo próprio: vai no **comentário** (que sai como "Observação" na etiqueta) |
| **Arquivos extras** | Fotos, vídeos e outros, **até 10 MB cada**, até 10 por envio. Fotos grandes são reduzidas no próprio celular |

---

## 2. Arquitetura

```
 Celular (PWA) / Desktop
   /            → minhas notas + imprimir (tela inicial)
   /nova        → adicionar nota fiscal (cadastro na 1ª vez)
   /n/:código   → página pública da nota (só leitura)
   /admin       → painel
   /instalar    → como instalar no Android / iPhone
        │ HTTPS (Let's Encrypt automático do Easypanel)
 ┌──────▼──────────────────────────────────────┐
 │ App Node.js (Express): API + páginas        │
 │  • leitura de XML / texto do PDF            │
 │  • etiquetas A4 em PDF (PDFKit + bwip-js)   │
 └──────┬─────────────────────────┬────────────┘
   PostgreSQL (schema notas_fiscais)   Volume /data/uploads/AAAA/MM/<id>/
```

---

## 3. Fluxos

```
 Minhas notas (/) ──➕ Adicionar nota fiscal──▶ Adicionar nota (/nova)
      ▲                                              │
      └────────── ✔ Adicionar nota / ← Voltar ───────┘
 Repete quantas vezes quiser e, no fim: 🖨️ Gerar PDF (todas as marcadas juntas)
```

### Minhas notas (`/`, tela inicial)
- Mostra **as notas que a própria pessoa adicionou**. O admin logado vê as de todos.
- No topo, o botão grande **➕ Adicionar nota fiscal**.
- Aba **"Para imprimir agora"** (padrão): as notas que a pessoa adicionou desde a última lista,
  todas marcadas. A lista fica **guardada na conta** (`usuarios.lote_ids`), então vale em qualquer
  aparelho com o mesmo e-mail. **Não some ao imprimir:** fica com o aviso "✅ Esta lista já foi
  impressa" para reimprimir se precisar. Recomeça quando ela adiciona uma nota depois de imprimir
  ou toca em **🧹 Começar lista nova**.
- Aba **"Notas antigas"**: todas as outras notas da pessoa, **nenhuma marcada**, com os selos
  "não impressa" ou "impressa em …" e uma busca. Ela marca só o que quiser reimprimir.
- Cada nota da lista (nas duas abas) mostra emissão, **valor**, quantidade e nomes dos produtos.
  Os botões **👁️ Ver registro** (abre ali mesmo: chave, fornecedor, destinatário, protocolo,
  produtos, comentário, fotos, DANFE/XML e link para a página do registro) e **📄 DANFE** abrem o
  PDF. Quem registrou vê o valor; a etiqueta e a página pública continuam sem valor.
- **Barra fixa embaixo:** tamanho (4 grandes, 8 médias ou 16 pequenas por folha A4, e o app lembra
  a escolha) e o botão **🖨️ Gerar PDF (N)**. O PDF abre em outra aba e as notas ficam marcadas
  como impressas.
- Primeira vez no aparelho: pede o **e-mail** (e o nome, só se o e-mail for novo) e mostra as notas
  dela. "Não é você?" troca a pessoa.

### Adicionar nota fiscal (`/nova`)
- No topo, o botão **← Minhas notas**. Embaixo, **Cancelar e voltar para minhas notas**.
1. **A nota**, com dois botões grandes:
   - "Tenho o PDF da nota": aceita PDF e/ou XML da **mesma** nota. Se o PDF não trouxer a chave no
     texto, o app usa a chave do nome do arquivo.
   - "Só tenho o código da nota": **ler o código de barras com a câmera** ou digitar a chave com
     máscara, validada na hora.
2. **Fotos e vídeos** (opcional).
3. **Comentário** (opcional).
4. **✔ Adicionar nota:** salva e volta para "Minhas notas", com a nota nova já marcada e o aviso
   "Nota #0005 adicionada".

- **Android:** com o app instalado, ele aparece no menu de compartilhamento do sistema. Basta tocar
  no PDF que chegou no WhatsApp e escolher Notas.
- **iPhone:** salvar o PDF em Arquivos e escolher pelo app (instruções em `/instalar`).
- A API também aceita várias notas num mesmo envio (até 20, agrupando PDF + XML pela chave), mas a
  tela trabalha com uma nota por vez.

### Página pública (`/n/<código>`)
Mostra NF-e nº/série, fornecedor, CNPJ, emissão, destinatário, protocolo, chave com código de
barras e botão copiar, aviso de consulta no Portal da NF-e, PDF/XML, fotos, vídeos, comentário e
quem registrou e a **lista de produtos** (quantidade e descrição). **Sem valor.**

### Painel (`/admin`)
- **Busca:** produto, chave, nº, fornecedor, CNPJ, comentário, quem enviou ou #registro. A busca
  ignora acentos e mostra o trecho onde o termo apareceu.
- **Filtros:** etiqueta não impressa, dados incompletos, sem chave, link suspenso, lixeira e período.
- **Detalhe:** edição dos campos, **lista de produtos** (quando veio XML), "Ler PDF/XML de novo",
  arquivos (adicionar, remover, restaurar), suspender/reativar link, lixeira e histórico.
- **Etiquetas:** selecionar várias notas, escolher 4, 8 ou 16 por folha e gerar o PDF.
- **Outros:** exportar CSV e bloquear/desbloquear usuários.

---

## 4. Etiquetas (A4 = 210 × 297 mm, preto e branco)

| Layout | Tamanho | QR do sistema | Código de barras |
|---|---|---|---|
| 4 por folha | 105 × 148,5 mm | 24 mm | 0,30 mm/barra, 20 mm de altura |
| 8 por folha | 105 × 74,25 mm | 18 mm | 0,30 mm/barra, 10 mm |
| 16 por folha | 105 × 37,1 mm | 14 mm | 0,25 mm/barra, 7,5 mm |

**Conteúdo**, em ordem de destaque:
1. NF-e Nº + série + emissão.
2. Emitente e CNPJ.
3. Destinatário.
4. Código de barras + chave de acesso.
5. Protocolo de autorização.
6. **Produtos** (quantidade e descrição, sem valores): até ~10 linhas na grande, resumo de 1 a 2
   linhas na média e nenhum na pequena; "+ N itens" quando não cabe tudo.
7. Observação.
8. "Consulte a autenticidade em www.nfe.fazenda.gov.br/portal com a chave de acesso."
9. No canto, discreto: QR do sistema, nº do registro e link em letra miúda.

**Testado:** todos os QR Codes foram lidos mesmo em imagem de 150 dpi borrada (simulando foto ruim).
O código de barras precisa de uma leitura de perto, e por isso a chave também vai impressa em números.

> A etiqueta **não é um documento fiscal**: ela reproduz os dados da NF-e. O que dá validade
> (garantia, troca) é a **chave de acesso**, que qualquer pessoa consulta no Portal Nacional da NF-e,
> e o PDF/XML original guardado no registro.

---

## 5. Chave de acesso

```
 35 2610 12345678000190 55 001 000123456 1 00000001 6
 UF AAMM CNPJ emitente  mod série  número tpEmis cNF DV
```
- DV em módulo 11, com pesos 2 a 9 da direita para a esquerda.
- **CNPJ alfanumérico** (2026+): as posições do CNPJ aceitam `[0-9A-Z]` e cada caractere vale
  ASCII − 48. *Confirmar na Nota Técnica vigente.*
- O leitor da câmera aceita o código de barras do DANFE e também o **QR da NFC-e** (`?p=CHAVE|...`).

---

## 6. Leitura dos dados

1. **XML:** todos os campos, **lista de produtos** (descrição, código, EAN, NCM, quantidade) e protocolo.
2. **PDF com texto:** chave, emitente (canhoto "RECEBEMOS DE ..."), data de emissão, protocolo,
   valor e **produtos da tabela do DANFE** (melhor esforço: código, descrição, NCM, CST, CFOP, UN, QTD).
   O **texto inteiro** é guardado para a busca por produto.
3. **Só a chave:** UF, mês/ano, CNPJ, modelo, série e número.
4. **PDF escaneado (imagem):** o arquivo é guardado e a leitura automática fica para a Fase 2 (OCR).

Resultado: `parse_status` = `completo` (chave + emitente + data) | `parcial` | `so_chave` | `sem_chave`.

---

## 7. Modelo de dados

Veja [`schema.sql`](schema.sql). Ele é aplicado automaticamente ao iniciar, dentro do schema
`DB_SCHEMA`, com trava para duas instâncias não rodarem ao mesmo tempo:
- `usuarios`: nome, e-mail, bloqueado.
- `notas`: `slug` (código do link, **imutável**), chave, dados da NF-e, `protocolo`, `itens` (JSONB),
  `texto_busca`, `comentario`, `publico_ativo`, `etiqueta_impressa_em`, `deleted_at` (lixeira).
- `arquivos`: tipo (nota_pdf, nota_xml ou anexo), caminho no volume, mime, tamanho, sha256.
- `auditoria`: quem, ação, nota e detalhes.

O link `/n/<código>` usa 10 caracteres aleatórios do alfabeto Crockford (sem I, L, O, U). O código
é impossível de adivinhar, fácil de digitar e aceita minúsculas e O→0.

---

## 8. Segurança
- Cookies assinados (HMAC) com `httpOnly` e `SameSite=Lax`. A senha do admin é comparada em tempo
  constante.
- *Rate limit* no cadastro, no envio e no login.
- O tipo real do arquivo é conferido pelo conteúdo, não pela extensão. Os arquivos são servidos com
  `nosniff` e anexos não visuais vão como download.
- `noindex` e `robots.txt` bloqueiam buscadores.
- Exclusões são reversíveis (lixeira) e tudo fica na auditoria.

---

## 9. Estrutura

```
appNotasFiscais/
├── server.js            rotas (páginas, API pública, API admin)
├── schema.sql
├── src/  chave.js · parse.js · etiquetas.js · storage.js · auth.js · db.js · env.js
├── public/
│   ├── enviar.html · nota.html · admin.html · instalar.html
│   ├── css/ · js/ · icons/ · manifest.json · sw.js
│   └── vendor/          leitor de código de barras para iPhone (zxing-wasm, sem CDN)
├── test/                npm test
├── Dockerfile · .env.example · README_DEPLOY.md
```

---

## 10. Roadmap

**Fase 1: feita**
- [x] Cadastro aberto (nome + e-mail) e envio de PDF/XML ou chave (câmera ou digitação)
- [x] Anexos até 10 MB, comentário e aviso de nota repetida
- [x] Leitura de XML e PDF com texto, mais **busca por produto** no painel
- [x] Página pública só leitura, com link imutável
- [x] Painel completo e etiquetas 4/8/16 em preto e branco, estilo transportadora
- [x] PWA (ícone, Compartilhar do Android, instruções do iPhone)
- [x] Dockerfile, guia do Easypanel e testes automáticos

**Fase 2**
- [ ] OCR para PDF escaneado
- [ ] Fila offline (enviar quando voltar o sinal)
- [ ] Relatórios (notas por fornecedor/mês)

**Fase 3**
- [ ] Bot de WhatsApp: encaminhar o PDF para o número do estoque, que responde com o link
      (Evolution API + n8n, que você já usa no `roboControlev1`)
- [ ] Download automático do XML na SEFAZ pela chave (*Distribuição DF-e* com certificado A1)
