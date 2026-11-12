# Pagamentos e conteúdo das pessoas (UGC) nas lojas

Regras: Apple App Review 3.1.1, 3.1.3, 3.2.2 e anti-steering; 1.1.4 e 1.2 (UGC). Google Play: política de Pagamentos
e política de Conteúdo gerado pelos utilizadores.

O canal vem de `src/lib/distribution.ts` (`CHANNEL`). O que se compra em cada canal está em `src/lib/storeRules.ts`
(`purchaseRulesFor`) e em `src/lib/purchases.ts` (`PURCHASES`). Testes: `apps/mobile/tests/storeRules.test.mjs`.

- **`play` e `appstore`:** não há nada digital que se compre por fora da loja, nem botões ou textos que mandem comprar
  noutro sítio.
- **`web` e `beta` (APK do site):** fica tudo como estava.

## 1. Pagamentos

| O que se compra / gasta | Onde na app | Regra da Apple | Regra do Google | O que fizemos (lojas) |
|---|---|---|---|---|
| **Comprar / recarregar Txills** (moeda virtual; M-Pesa, e-Mola, cartão, teste) | Definições › Txills e pagamentos › «Pedidos e pagamentos» (`/orders`) | 3.1.1: moeda virtual só com IAP. Anti-steering: não se pode mandar comprar fora | Pagamentos: bens digitais só com o Play Billing (Moçambique não tem faturação alternativa) | **Tirado.** `/orders` passa para `/wallet`. Sai a linha das Definições, sai da pesquisa e o subtítulo passa a «Carteira e presentes». A Ajuda já não diz «podes recarregar». O cofre já não diz «Carrega a carteira primeiro» |
| **Histórico de pedidos de recarga** | `/orders` | Mostra compras feitas fora (preços em MT): conta como steering | Idem | **Tirado**, com o ecrã |
| **Levantar Txills / converter em dinheiro** | Não existe (os Txills não se trocam por dinheiro) | — | — | Nada a fazer. O Gerir › Txills diz «ainda não está disponível», sem ligação |
| **Presentes / brindes com Txills** (publicações, perfil, chat «Presentes», carteira «Presentear alguém») | `GiftSheet`, carteira, chat | 3.1.1: pode-se dar gorjetas a criadores **com moeda comprada por IAP**. Gastar o saldo que já se tem é permitido | Idem (gastar o saldo não é uma compra) | **Fica.** Usa só o saldo que já existe (500 de boas-vindas, convites, presentes recebidos). Não há botão para comprar mais |
| **Bombar** (destacar um evento ou uma publicação de um local; publicidade paga dentro da app) | Gerir › Bombar (`VenueBoost`) | 3.1.1: funcionalidade digital (a Apple exigiu IAP nos «boosts» da Meta). Os Txills podem vir de compras fora | Funcionalidade digital: Play Billing | **Criar campanhas: tirado.** Na secção veem-se as campanhas ativas e passadas, com o relatório, e podem parar-se (devolução). Sai o «M-Pesa · Brevemente». Sai da Ajuda a pergunta «Como bombo o meu local?». **Ver destaques no feed e no mapa fica** (mostrar anúncios é permitido) |
| **Pagar com Txills nos locais** (bens e serviços físicos: bebidas, comida, entrada) | Página do local › «Pagar com Txills» (`VenuePaySheet`) | 3.1.1 / 3.1.3(e): bens e serviços físicos **não** podem usar IAP. Pagar com pontos que já se tem é como um cartão de fidelização | Pagamentos: bens físicos isentos do Play Billing | **Fica.** Os Txills gastos são os que já se tem (nenhum se compra na app). Ver a decisão 2 do relatório: com IAP, os Txills comprados na loja **não** podem servir para bens físicos |
| **Cofre dos TxillGroups** (pôr Txills, pagar a um local, devolver) | Grupo › Cofre (`PotPanel`) | Entre pessoas (P2P) e pagamento de bens físicos: fora do IAP. Não se compra nada | P2P isento | **Fica.** Só sai o «Carrega a carteira primeiro» |
| **Despesas do grupo** (quem pagou o quê, em MT) | Grupo › Plano › Despesas | Só faz as contas; não há pagamento na app | — | **Fica** |
| **Encomendas (orders)** | É o mesmo `/orders` (pedidos de recarga de Txills); não há encomendas de bens | ver «Comprar Txills» | — | **Tirado** (ver acima) |
| **Verificação (selo)** | Definições › Conta › Verificação | Grátis: não há nada a pagar | — | **Fica** (grátis) |
| **SuperTxill (IA)** | Mensagens / Pesquisa | Grátis | — | **Fica** |
| **Convites que dão Txills** | Convites | Recompensas sem compra: permitidas (sem pedir avaliações nem downloads de outras apps, 3.2.2) | Idem | **Fica** |

### O que falta para ligar a compra das lojas (StoreKit e Play Billing)

1. **Produtos nas lojas.** Os pacotes de Txills passam a consumíveis (App Store Connect e Play Console), com os mesmos
   ids de `payments.packages`. O Bombar pode ser um consumível por pacote (1, 3 e 7 dias), ou pagar-se com Txills
   comprados por IAP.
2. **A app.** Usar `expo-iap` ou `react-native-iap`, com o plugin do Expo e um build novo (no Android também a permissão
   `com.android.vending.BILLING`). O ecrã de compra é outro: os preços vêm da loja e compra-se com `requestPurchase`.
   `PURCHASES.buyTxills` só passa a `true` nas lojas quando o IAP estiver ligado, e só com os pacotes da loja.
3. **A API.** Um `POST /payments/iap/apple` e um `POST /payments/iap/google` que validam o recibo:
   - Apple: App Store Server API (JWS da transação) e as notificações do servidor v2, para os reembolsos;
   - Google: Play Developer API `purchases.products.get`, depois `acknowledge` / `consume`, e RTDN (Pub/Sub) para os
     reembolsos e as anulações.
   Credita com a mesma idempotência de `WalletService.credit` (a chave é o id da transação). Um reembolso tira os Txills
   (ou deixa o saldo negativo ou bloqueado).
4. **Dois saldos.** Os Txills comprados por IAP não podem pagar bens físicos nos locais (Apple 3.1.1). É preciso marcar a
   origem de cada movimento (`iap` / `externo` / `grátis`) e não deixar gastar os `iap` em `venue_payment`, nem no cofre
   que paga locais. Ver a decisão 2 do relatório.
5. **Os textos.** Os Termos (ponto 5: «Podes recarregar Txills em Definições → Pedidos e pagamentos») e a Privacidade
   (pagamentos) têm de dizer que, nas lojas, a compra é feita pela loja. Isto fica para o guardião.
6. **Testes.** Sandbox da Apple e testadores de licença do Google. Nos e2e da API, recibos falsos (validador injetado,
   como o `IMAGE_CLASSIFIER`).

## 2. Conteúdo das pessoas (UGC)

| Requisito (Apple 1.2 / Google UGC) | Onde | Estado |
|---|---|---|
| Denunciar publicações | Menu ⋯ da publicação › Denunciar | ✔ Já existia. Agora a publicação também sai do feed de quem denunciou |
| Denunciar comentários | Segurar o comentário › Denunciar | ✔ Já existia. Agora sai da lista (e das respostas) de quem denunciou |
| Denunciar **mimos** | Mimo de outra pessoa › ⋯ › «Denunciar mimo» | **Novo** na app (a API já aceitava). Passa ao mimo seguinte, e este deixa de aparecer a quem denunciou (também na bandeja) |
| Denunciar **comentários de mimos** | Comentários do mimo › bandeira | **Novo** (app + API: tipo `story_comment`, migração 0125) |
| Denunciar **Zás** | A ver um Zás › bandeira | **Novo** (app + API: tipo `instant`). A moderação vê a foto pela rota de revisão, com registo, enquanto a queixa estiver aberta |
| Denunciar mensagens (a dois e TxillGroups) | Segurar a mensagem › Denunciar mensagem | ✔ Já existia (com prova). Agora fica escondida para quem denunciou (como «Apagar para mim») |
| Denunciar perfis | Perfil › ⋯ › Denunciar @ | **Corrigido:** a app mandava o @ em vez do id, a API (que pede um uuid) recusava, e a denúncia **falhava sempre** |
| Denunciar locais | Página do local › bandeira | **Novo** na app (a API já aceitava) |
| Bloquear pessoas | Perfil › ⋯ › Bloquear; Definições › Privacidade › Bloqueados; pedidos de mensagem | ✔ Já existia |
| Filtro de conteúdo ofensivo | API `safety/text-filter.service.ts`: recusa ameaças, incentivo ao suicídio e ódio em publicações, comentários, mensagens, mimos, notas, Zás, perfil… Fotos e vídeos: modelo NSFW local (rejeita a partir de 0,85; a partir de 0,5 vai para a fila). Backoffice: regras de texto (insulto, sexual, burla) que assinalam | ✔ Já existia |
| Ação sobre as denúncias em menos de 24 h | Backoffice › Moderação › Fila de queixas (gravidade, lote, remover, avisar, suspender, auditoria) | ✔ A ferramenta existe, já com os tipos novos. **As 24 h dependem de haver gente a ver a fila** (ver o relatório). A app diz «com o objetivo de decidir em menos de 24 horas» |
| Contacto público para denúncias | Ajuda e Sobre: suporte@txillapp.com; Termos, último ponto | ✔ Já existia (a Ajuda passa a dizê-lo na pergunta sobre denúncias) |
| Termos aceites, com «tolerância zero» | Registo: caixa obrigatória «Li e aceito os Termos» | ⚠ A caixa existe, mas os Termos **não dizem «tolerância zero»** nem proíbem nudez ou sexo explícito de adultos (só «nudez de menores»). Fica para o guardião (não se mexeu no `legalText`) |
| Sexo explícito e nudez proibidos | Modelo NSFW no servidor (fotos e vídeos); motivo de denúncia «Nudez ou conteúdo sexual» | ✔ Na técnica; ⚠ nos Termos (ver acima) |
| Partes 18+ (álcool na geleira; Bombar) | API `geleira.service.ts`: o álcool só aparece a quem tem 18 anos ou mais (pela data de nascimento); o Bombar só aparece a maiores de 18 | ✔ Já existia. Idade mínima da conta: 15 anos |
| O conteúdo denunciado fica escondido para quem denunciou | API: `notReportedBy` (`social/visibility.ts`) nos comentários, nos comentários de mimos, nos mimos (bandeja e mimos da pessoa) e nos Zás; feed (`feed_impressions.hidden`); mensagens (`message_hidden`). App: `ReportSheet.onReported` tira-o logo do ecrã | **Novo** (e2e em `moderation/report-ugc.e2e.spec.ts`) |
