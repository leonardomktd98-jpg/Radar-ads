# Ads Library Tracker

Ferramenta de mineração de produtos: acompanha automaticamente quantos anúncios
ativos cada anunciante tem na **Meta Ads Library**, dia a dia, e mostra tudo num
dashboard visual (sem planilha) com variação dia/semana/mês, sparklines e
gráficos por anunciante.

## Como funciona

```
você roda "npm run add" com o link da Ads Library
        │
        ▼
docs/data/libraries.json  (lista de anunciantes que você quer rastrear)
        │
        ▼
GitHub Actions roda todo dia (cron) + sob demanda (botão "Run workflow")
        │  abre cada link com um navegador headless (Playwright)
        │  lê o texto "~X resultados" que a Meta mostra
        ▼
docs/data/history.json  (histórico diário de contagem, por anunciante)
        │
        ▼
GitHub Pages serve docs/  →  dashboard lê os dois JSONs e desenha os gráficos
```

Não existe backend nem banco de dados — os dados moram no próprio repositório
como JSON, versionados no Git. Isso também te dá histórico automático "de graça"
(dá pra ver `git log` do arquivo se um dia quiser auditar).

## Limitações — leia antes de confiar 100% nisso

- **Isto não usa a API oficial da Meta.** A API oficial (Ad Library API) hoje
  exige verificação de identidade da Meta mesmo para anúncios não-políticos, o
  que você disse não ter ainda. Este projeto lê a mesma página pública que você
  vê no navegador, com um Chromium headless. Isso é **mais frágil**: se a Meta
  mudar o layout da página, o scraper pode parar de encontrar o número e vai
  reportar erro (o card fica com a badge "Erro na última coleta").
- Está numa **zona cinzenta dos Termos de Uso** da Meta (scraping automatizado).
  O workflow já inclui um atraso educado entre requisições e roda só 1x/dia por
  padrão para reduzir risco, mas não há garantia contra bloqueio de IP do runner
  do GitHub em uso muito intenso.
- Quando o número de anúncios é muito grande, a própria Meta **arredonda** (ex:
  "~7.000 resultados") — o dashboard marca isso com "~" e um aviso "aprox.".
- Se um dia você conseguir acesso à Ad Library API oficial, dá pra trocar só o
  `scraper/scrape.js` por uma chamada à API — o resto (dashboard, histórico,
  workflow) continua igual.

## Configuração inicial

### 1. Pré-requisitos
- [Node.js 20+](https://nodejs.org)
- Uma conta no GitHub

### 2. Rodar localmente (opcional, para testar antes de publicar)
```bash
npm install
npx playwright install --with-deps chromium
npm run scrape   # lê docs/data/libraries.json e atualiza docs/data/history.json
npm run dev      # sobe o dashboard em http://localhost:5173
```

### 3. Adicionar uma biblioteca de anúncios
Pegue o link da Ads Library **de um anunciante específico** (com
`view_all_page_id` na URL) e rode:
```bash
npm run add -- "Nome do produto" "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=123456789"
```
Isso adiciona a entrada em `docs/data/libraries.json`. Faça commit e push — o
resto é automático a partir daqui.

### 4. Publicar no GitHub
Já conectado a [leonardomktd98-jpg/Radar-ads](https://github.com/leonardomktd98-jpg/Radar-ads):
```bash
git push -u origin main
```

### 5. Habilitar permissão de escrita para o Actions
No GitHub: **Settings → Actions → General → Workflow permissions** → marque
**"Read and write permissions"** e salve. Sem isso o workflow não consegue
commitar o `history.json` atualizado.

### 6. Habilitar o GitHub Pages
**Settings → Pages → Source** → escolha **"Deploy from a branch"**, branch
`main`, pasta **`/docs`** (o dropdown do GitHub só permite `/ (root)` ou
`/docs` — por isso o dashboard mora em `docs/` e não em `site/`). Em 1–2
minutos seu dashboard fica disponível em
`https://leonardomktd98-jpg.github.io/Radar-ads/`.

### 7. Botão "Atualizar agora"
Já configurado em [docs/app.js](docs/app.js) (`REPO = "leonardomktd98-jpg/Radar-ads"`).
Ele leva direto para a aba Actions, onde clicando em **"Run workflow"** você
força uma atualização imediata de todas as bibliotecas cadastradas (sem
esperar o horário do cron).

### 8. Ajustar o horário da atualização automática
Em [.github/workflows/update.yml](.github/workflows/update.yml), a linha
```yaml
- cron: "0 12 * * *"
```
roda todo dia às 12:00 UTC (09:00 em Brasília). Mude o horário conforme
preferir (formato cron, sempre em UTC).

## O que o dashboard mostra
- Card por anunciante: número atual de anúncios, variação vs. ontem / 7 dias /
  30 dias (seta + valor absoluto + %), sparkline dos últimos 30 dias.
- Badge de erro quando a última coleta falhou (link/anunciante fora do ar,
  layout mudou, etc.) — assim você sabe quando checar manualmente.
- Clique em qualquer card para abrir o gráfico completo, com filtro de período
  (14/30/90 dias ou tudo) e alternância para visão em tabela.
- Busca e ordenação (nome, mais anúncios, maior alta/queda) na lista de cards.
- Tema claro/escuro (segue o sistema, com alternância manual).

## Estrutura do projeto
```
docs/                    → o dashboard (isso é o que vira o GitHub Pages)
  index.html, style.css, app.js
  data/libraries.json    → anunciantes cadastrados (você edita via npm run add)
  data/history.json      → histórico diário de contagem (o scraper escreve)
scraper/
  scrape.js              → visita cada biblioteca e atualiza o histórico
  add-library.js         → CLI para cadastrar uma nova biblioteca
  dev-server.js          → servidor local para "npm run dev"
.github/workflows/update.yml → roda o scraper por cron + sob demanda
```
