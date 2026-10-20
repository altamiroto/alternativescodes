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
  as não impressas marcadas. A lista fica **guardada na conta** (`usuarios.lote_ids`), então vale em qualquer
  aparelho com o mesmo e-mail. **Não some ao imprimir:** fica com o aviso "✅ Esta lista já foi
  impressa" e o selo "impressa em …" em cada nota. Notas adicionadas depois **entram na mesma lista**
  (só as ainda não impressas vêm marcadas). A lista só esvazia quando a pessoa toca em
  **🧹 Começar lista nova**.
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
| **1 por folha · nota completa** | A4 inteira | — | o **DANFE completo** de cada nota (o PDF enviado ou obtido no Meu Danfe); sem DANFE, uma página com todos os dados conhecidos |

**Conteúdo — o que vai na etiqueta é escolhido na hora de imprimir** (seletor "📝 Na etiqueta" na
barra de impressão; o app lembra a última escolha; `?campos=` na URL do PDF):
- **Sempre:** chave de acesso com código de barras (maior quando está sozinha), **nº da nota, série
  e data de emissão**, frase "Consulte a
  autenticidade em www.nfe.fazenda.gov.br/portal…", e no canto, discreto: QR do sistema, nº do
  registro e link em letra miúda.
- **Opcionais (padrão: nenhum):** Fornecedor e CNPJ · Destinatário · Produtos
  (quantidade e descrição) · Valor total · Protocolo · Observação.
- Os blocos são desenhados de cima para baixo; o espaço da chave é reservado primeiro e **o que não
  couber fica de fora** (comum nas etiquetas de 8 e 16 por folha). Produtos ocupam o espaço que
  sobra, com "+ N itens (ver nota completa pelo QR)".

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
- **iPhone com o app instalado:** o iOS abre PDFs dentro do próprio app, sem barra do Safari (sem
  compartilhar/imprimir e sem voltar). Nesse caso (`navigator.standalone`), o PDF das etiquetas e os
  links de arquivos (`/f/...`, DANFE) são baixados pelo app e aparece o botão **🖨️ Imprimir**, que
  abre a tela de compartilhar do iPhone com o arquivo (Imprimir, Salvar em Arquivos…). Android,
  computador e o iPhone pelo Safari continuam abrindo o PDF em outra aba.
- **Leitura dos números da chave (OCR)**, ao mesmo tempo que o código de barras: quando as barras não
  leem de cara (amassado, borrado, pouca luz), o app lê os 44 números impressos. Usa o Tesseract.js
  no próprio celular (sem enviar a imagem para fora), carregado só quando a câmera abre (~7 MB na
  primeira vez, depois fica no cache), servido do `node_modules` em `/vendor/ocr/`.
  - Recorta o quadro guia, passa para preto e branco com limiar local (aguenta sombra e pouca luz),
    põe margem branca e alterna 4 ajustes de tratamento entre as tentativas.
  - Depois do preto e branco, apaga manchas grandes demais para serem letras (borda da etiqueta,
    fundo escuro, linhas de tabela) e, em metade das tentativas, as barras do código de barras.
  - Só aceita a chave quando o **dígito verificador** fecha, **UF, mês, modelo e o CNPJ (ou CPF) do
    emitente** são válidos (dígitos verificadores próprios) e **duas leituras recentes** dão a mesma
    chave. Procura a chave dentro de uma linha (ou duas seguidas), nunca juntando o texto todo.
    Letras lidas no lugar de números (O→0, B→8…) são corrigidas fora das posições do CNPJ.
- **🖼️ Foto da galeria** (na tela do leitor): procura o código de barras na foto (em pé e deitada) e,
  se não achar, os números (9 combinações de giro, tamanho e modo de leitura). A rotação gravada na
  foto é respeitada.
- **↻ Virar**: a tela fica em pé (o manifest pede `portrait`; o iPhone ignora) e o quadro de leitura
  deita, com os ícones girados, para usar o celular de lado com o código comprido. A imagem é girada
  antes da leitura (testa os dois lados). Se o aparelho girar a tela sozinho, a tela do leitor usa
  um layout próprio para a horizontal (câmera à esquerda, instruções à direita).
- A área lida é um pouco maior que o quadro desenhado (8% de folga), porque é comum a nota encostar
  na borda. O código de barras é procurado na imagem sem filtro (o contraste atrapalha o leitor).
- Câmera: **🔦 Lanterna** e **🔍 Aproximar** (zoom 2×) quando o aparelho permite (Android; o iPhone
  não libera a lanterna para sites), foco contínuo, quadro guia maior, e o código de barras é
  procurado alternando a imagem inteira e o recorte ampliado do quadro.

---

## 6. Leitura dos dados

Ordem de prioridade:
1. **XML** (enviado ou obtido no Meu Danfe): todos os campos, produtos e protocolo — exato.
2. **Meu Danfe** ([meudanfe.com.br](https://meudanfe.com.br), API v2 paga) — `src/meuDanfe.js`:
   - Nota **sem XML e sem os dados** (só a chave, ou PDF sem produtos/valor) → `PUT /fd/add/{chave}`
     (R$ 0,03) e consulta o status a cada 2 s até `OK` (no máximo `MEUDANFE_ESPERA`, 30 s); depois
     `GET /fd/get/xml` e `GET /fd/get/da` (grátis): guarda o **XML oficial e o DANFE em PDF** e
     preenche todos os dados pelo XML. Qualquer data de emissão.
   - Nota **com XML e sem PDF** → `POST /fd/convert/xml-to-da` (grátis): gera e guarda o DANFE.
   - **Mesma chave em outra nota** com XML/PDF já guardados → só liga os arquivos (não chama a API).
   - Roda **só na hora**: ao adicionar, no "Ler PDF/XML de novo" do admin e no "1 por folha". Se
     falhar, mostra o motivo (não encontrada, sem saldo, Api-Key inválida, demorou…) e segue.
   - Regras da API respeitadas: uma requisição por vez (≥ 0,5 s entre elas), ≥ 1 s entre consultas
     de status e **não repete por 10 min uma chave que voltou "não encontrada"/erro** (insistir
     bloqueia a conta).
   - Sem `MEUDANFE_API_KEY`, fica desligado. A chave (e o XML, para gerar o PDF) vão para esse serviço.
   - (O consultadanfe.com, usado antes, foi removido: só aceita chamadas do próprio site no
     navegador e limitava o IP do VPS.)
3. **PDF com texto** (`src/parse.js`): chave, emitente, emissão, protocolo, valor e **produtos lidos
   pela posição do texto na página** (o valor também: o número abaixo de "VALOR/V. TOTAL DA NOTA",
   ou o "VALOR TOTAL: R$" do canhoto) — acha o cabeçalho da tabela (CÓDIGO, DESCRIÇÃO, NCM, CFOP, UN,
   QTD…), atribui cada texto à sua coluna, junta descrições quebradas em várias linhas e para nas
   "informações adicionais do produto". Funciona no layout clássico (MOC 7.0) e no novo
   (NT 2026.010, com "CST / CFOP", "QTD / UN" e NCM dentro da descrição), em fontes estreitas ou
   largas e em notas de várias páginas. Testado contra o XML de origem em 22 variações de DANFE
   (`test/fixtures`, dados fictícios) e num DANFE real.
4. **Só a chave**: UF, mês/ano, CNPJ, modelo, série e número. Se o nome do arquivo trouxer a chave
   (`NFE-3526…pdf`), ela é usada quando não aparece no texto do PDF.
5. **PDF escaneado (imagem)**: o arquivo é guardado; sem texto para ler (OCR fica para a Fase 2).

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
│                        (+ /vendor/ocr/: Tesseract.js servido do node_modules)
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
