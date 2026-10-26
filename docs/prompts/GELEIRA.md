# GELEIRA — Perfis de gostos e amizades por afinidade (prompt de desenvolvimento)

> Cola este prompt numa sessão com acesso ao repositório do Txillapp. Ele assume o monólito modular atual (NestJS + PostgreSQL + React/Vite PWA), os testes de integração existentes e as regras de trabalho do projeto.

---

## 0. Missão

Constrói a **Geleira**: a prateleira pessoal de gostos de cada utilizador do Txillapp. Em Moçambique a *geleira* é onde se guarda o que se bebe e se come para estar sempre fresco; aqui é a secção do perfil onde cada pessoa junta **bebidas, comidas, petiscos e doces** de que gosta, **classifica o quanto gosta** de cada um e, a partir disso, o Txillapp **sugere malta com a mesma vibe**.

Duas ideias a segurar em simultâneo:
1. **Diversão e identidade** — ver a geleira de alguém diz "quem é" em 3 segundos. Copy de rua, engraçada, nunca infantil.
2. **Ligação entre pessoas** — a geleira alimenta as sugestões de amizade ("Vocês dois adoram Laurentina e matapa 🍻"). É a razão de existir, não um enfeite.

## 1. Regras inegociáveis (lê antes de escrever código)

- **Privacidade primeiro.** Gostos são dados pessoais. Tudo é opcional, editável e apagável. Cada item tem visibilidade (`todos` | `seguidores` | `só eu`) e existe uma definição global "usar a minha geleira para sugerir malta" (`ligada` por omissão, desligável a qualquer momento). Itens "só eu" **nunca** aparecem a outros, nem como "motivo" de uma sugestão.
- **Álcool e menores.** Existe `identity.users.birth_date`. Menores de 18 anos: categorias alcoólicas **não existem** para eles (não podem adicionar, não veem, não entram em sugestões), e nunca são sugeridos a adultos com base em itens alcoólicos. Linguagem neutra: nada que incentive consumo excessivo; sem "quantas cervejas", sem desafios de beber.
- **Restrições alimentares** (vegetariano, halal, sem álcool, alergias) são dados sensíveis: privados por omissão, nunca usados nas sugestões sem consentimento explícito, nunca mostrados em "motivos".
- **Autorização no servidor.** O cliente nunca decide quem vê o quê. Reutiliza `canView`/`blockedBetween`/regras de privacidade em `social/visibility.ts`. Bloqueados nunca se veem, nem na comparação nem nas sugestões.
- **Sem dark patterns.** Não gamificar até à compulsão; sem contadores de "perdeste X pontos"; sem notificações push por causa de geleiras (só o que o utilizador já escolheu).
- **Conteúdo livre moderado.** Itens sugeridos pelos utilizadores passam por normalização, deteção de duplicados, filtro de linguagem e pela fila de moderação existente (`/admin`). Só entram no catálogo público depois de aprovados; até lá só o autor os vê.

## 2. Modelo de domínio (propõe e justifica migrações SQL `0033+`)

- **`taste.items`** (catálogo): `id` (UUIDv7), `slug` único, `name` (pt-MZ), `kind` (`bebida` | `comida` | `petisco` | `doce`), `category` (ex.: cerveja, vinho, refrigerante, sumo, chá/café, água de côco, prato de rua, marisco, grelhados…), `emoji`, `attributes` (jsonb: `alcoholic` bool, `sweet`, `spicy`, `region`…), `status` (`curated` | `pending` | `rejected`), `created_by` (nulo se curado), `popularity` (calculada), `created_at`. Índices para pesquisa (trigramas) e para o Elasticsearch (já integrado, ver `search/search-index.ts`).
- **`taste.user_items`**: `user_id`, `item_id`, `rating` 1–5 (a escala visual é a **escala de gelo ❄️**: 1 "morno" … 5 "gelada de rachar"), `favorite` bool, `note` (≤120 chars, opcional), `position` (ordenação manual), `visibility`, `created_at`, `updated_at`. PK `(user_id, item_id)`. Limite razoável por pessoa (ex.: 200).
- **`taste.user_settings`** (ou colunas em `identity.users`): `geleira_matching` (bool), `geleira_visibility_default`, `dietary` (jsonb privado).
- **`taste.similarity`** (cache): `user_id`, `other_id`, `score`, `common_count`, `top_common` (ids), `computed_at`; guarda no máximo os N melhores por pessoa.
- Seeds idempotentes com **150+ itens curados** a sério para Moçambique (Laurentina, 2M, Manica, Tonic/Fanta/Coca-Cola, Sumol, Mafura, vinho, whisky, ginjinha, cajueiro/cerveja de milho tradicional, café, chá, água de côco, sumo de maracujá; matapa, xima com caril, camarão ao piri-piri, frango à zambeziana, peixe grelhado, caril de amendoim, mucapata, bolinhos, pão com chouriço, rissóis, pastéis de nata, gelados…). Ícones/emoji consistentes.

## 3. Funcionalidades

### 3.1 A minha Geleira (no perfil)
- Secção "A minha geleira ❄️" no perfil: prateleiras por `kind`, cartões com emoji, nome e a escala de gelo; favoritos em destaque no topo; "ver tudo".
- **Adicionar**: pesquisa com sugestões em tempo real (Elasticsearch com fallback PostgreSQL, tolerante a acentos e gralhas), filtros por tipo, "mais populares na malta". Se não existe: **"Sugerir novo item"** (nome, tipo, categoria) → fica `pending`, o autor já o vê na sua geleira.
- **Classificar**: toque nos ❄️ 1–5 (alvo ≥44 px, acessível por teclado e leitor de ecrã), alterar a qualquer momento, marcar favorito, nota curta, reordenar, remover, mudar visibilidade por item.
- **Onboarding "Enche a tua geleira"**: após registar (e para contas existentes, uma só vez, **dispensável**), escolhe 5–10 itens de cartões grandes e classifica; guarda ao tocar, sem formulário longo.
- Copy no tom do projeto (ver `docs/`/memória: engraçado, rua, sem infantilizar). Mensagens de erro e vazio com personalidade.

### 3.2 Ver a geleira de outra pessoa
- Só mostra o que o espectador pode ver (por item), respeitando perfil privado/bloqueios.
- **"Entre nós"**: bloco comparativo "Temos 7 gostos em comum" com os itens partilhados e a diferença de nota ("tu ❄️❄️❄️❄️, ela ❄️❄️❄️❄️❄️"), só com itens visíveis para ambos.

### 3.3 Malta com a tua vibe (amigos por gostos)
Substitui/estende `Suggestions` ("Bora conhecer malta nova? 🤝") com uma fonte nova `geleira`, sem apagar as existentes (grafo social).
- **Similaridade**: usa as notas **centradas na média de cada pessoa** (para não confundir "gosta de tudo" com afinidade), similaridade do cosseno com **encolhimento** (shrinkage) pelo nº de itens em comum, exigindo **mínimo de 3 itens em comum** e dando peso extra a favoritos em comum e a itens raros (IDF). Penaliza discordância forte (um ama, o outro 1❄️).
- **Combinar com o grafo**: bónus por amigos em comum/seguidores mútuos e atividade recente; **excluir** bloqueados, já seguidos, pedidos pendentes, dispensados, contas privadas que não aceitam sugestões (`suggestable`), contas eliminadas e a combinação menor↔adulto em regra geral (ver §1, tratar com cuidado e documentar a decisão).
- **Explicável**: cada sugestão traz 1–3 "motivos" legíveis ("Os dois adoram Laurentina e matapa"), **só com itens visíveis para o espectador**.
- **Cold start**: pouca geleira → faz perguntas rápidas em vez de sugestões fracas.
- **Desempenho**: pré-calcular `taste.similarity` em segundo plano (fila, recalcula a pessoa quando a geleira muda de forma relevante + varrimento periódico); a API só lê. Define o orçamento (ex.: p95 < 150 ms) e prova-o.
- **Medir**: eventos `geleira_open`, `geleira_item_add`, `geleira_rate`, `geleira_match_shown`, `geleira_match_follow` (usa `lib/analytics.ts`); métrica de sucesso = % de sugestões seguidas e se a conexão se mantém 7 dias. Acrescenta ao painel `/admin/stats`.

### 3.4 Extras de baixo risco (só depois do essencial estar sólido)
Geleira da malta (itens em alta por cidade/bairro, sem expor pessoas), partilhar a minha geleira como story/imagem, "o que beber hoje" aleatório entre os meus favoritos.

## 4. API (REST, prefixo `/api/v1`, JWT)

`GET /geleira/catalog?q&kind&cursor` · `GET /geleira/popular` · `POST /geleira/items` (sugerir novo) · `GET /users/:username/geleira` · `GET /users/:username/geleira/common` · `GET /geleira/me` · `PUT /geleira/me/items/:itemId` (`rating`, `favorite`, `note`, `visibility`) · `DELETE /geleira/me/items/:itemId` · `PATCH /geleira/me/order` · `GET/PUT /geleira/me/settings` · `GET /suggestions/people?source=geleira`. Validação com zod, limites de pedidos (`@Throttle`), idempotência nos PUT, paginação por cursor, erros em português. Tudo coberto por autorização no servidor.

## 5. Frontend (mobile-first, PWA)

Componentes: `GeleiraShelf`, `TasteCard`, `IceRating` (acessível), `AddTasteSheet` (com `visibleStyle`/teclado iOS), `CommonTastes`, `VibeSuggestions`. Rotas: secção no perfil + ecrã próprio `/geleira`. Ícones SVG do `Icon.tsx` (emoji só como imagem do item). Contraste WCAG 2.2 AA, `prefers-reduced-motion`, estados de carga/erro/vazio, sem saltos de layout, imagens via `lib/media.ts`. Testa em viewport de telemóvel e em 320 px de largura.

## 6. Dados, segurança e conformidade

Atualiza: exportar dados (`account/export.service.ts`), eliminar conta (apagar `taste.*` do utilizador e recalcular vizinhos), política de privacidade (`pages/Legal.tsx`), `README`. Rever risco de **perfilamento** (não inferir religião/saúde a partir de gostos), de **assédio por sugestões** (limitar quem pode ser sugerido a quem) e de **enumeração** (ninguém deve conseguir descobrir geleiras escondidas por tentativa).

## 7. Testes obrigatórios (Jest de integração, base de testes, `--runInBand`)

- Privacidade: item "só eu" invisível a todos (incluindo seguidores e em "Entre nós"); privado/bloqueado; mudar visibilidade tem efeito imediato.
- Menores: sem categorias alcoólicas, sem sugestões cruzadas indevidas.
- Catálogo: duplicados, normalização de acentos, item sugerido fica `pending` e só o autor o vê; moderação aprova/rejeita.
- Similaridade: casos de ouro (matrizes pequenas com resultado esperado), mínimo de comuns, centragem, shrinkage, IDF; determinismo.
- Sugestões: exclui seguidos/bloqueados/dispensados/eliminados; motivos só com itens visíveis.
- Desempenho: teste de carga com 10 000 utilizadores sintéticos dentro do orçamento definido.
- Limites (200 itens), validação, idempotência, eliminar conta limpa tudo.

## 8. Como trabalhar

1. **Primeiro propõe** (curto): modelo de dados, algoritmo e ecrãs; lista decisões em aberto com a tua recomendação. Só avança depois do OK.
2. Entrega em **fatias verticais** que funcionem de ponta a ponta: (a) catálogo + minha geleira; (b) ver geleira de outros + "Entre nós"; (c) sugestões por afinidade + medição.
3. Corre `npm test`, `tsc` e `npm run build` a cada fatia; **vê o resultado no browser em tamanho de telemóvel** antes de dizer que está pronto e diz o que **não** verificaste.
4. Segue as convenções do repo (comentários curtos em português, copy no tom do Txillapp, SQL com migrações numeradas, sem segredos no código). **Não mates processos** em execução. **Pede autorização antes de descarregar ficheiros** (modelos, imagens). Commits em português, em nome de **Erasmo Buque (dombuque)**, **sem assinatura de IA**.
5. No fim: resumo honesto do que ficou feito, medido e por fazer.

## 9. Critérios de aceitação

- [ ] Consigo montar a minha geleira em < 60 s, classificar cada item e mudar a visibilidade por item.
- [ ] Vejo a geleira de outra pessoa apenas no que ela deixa e o "Entre nós" só com o que ambos veem.
- [ ] Recebo sugestões de malta com motivos corretos; dispensar/bloquear/seguir atualiza-as.
- [ ] Menores nunca veem nem entram em fluxos de álcool.
- [ ] Pesquisa de itens tolera acentos e gralhas; novos itens passam por moderação.
- [ ] Exportar/eliminar conta cobre a Geleira; a política de privacidade menciona-a.
- [ ] Todos os testes passam; p95 das sugestões dentro do orçamento; WCAG AA nos ecrãs novos.

## 10. Decisões em aberto (responde com a tua recomendação antes de codar)

1. Escala: 1–5 ❄️ (recomendado) ou 0–10? Incluir "não gosto"/negativo?
2. A sugestão entre menores e adultos: bloquear sempre (recomendado) ou só filtrar por itens alcoólicos?
3. Localização (cidade/bairro) para "Geleira da malta": usar o local que a pessoa já escolhe nas publicações ou pedir cidade no perfil?
4. Catálogo inicial: quem cura os 150+ itens e as traduções (pt-MZ)?
5. Mostrar a geleira também no cartão de perfil das sugestões ou só no perfil completo?
