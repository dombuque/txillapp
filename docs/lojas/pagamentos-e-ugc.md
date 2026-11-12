# Pagamentos e conteúdo das pessoas (UGC) nas lojas

Regras: Apple App Review 3.1.1, 3.1.3, 3.1.5, 3.2.1(vii) e (viii), 3.2.2 e anti-steering; 1.1.4 e 1.2 (UGC). Google Play:
política de Pagamentos e política de Conteúdo gerado pelos utilizadores. Fontes e citações na secção 3.

O canal vem de `src/lib/distribution.ts` (`CHANNEL`). O que se compra em cada canal está em `src/lib/storeRules.ts`
(`purchaseRulesFor`) e em `src/lib/purchases.ts` (`PURCHASES` e `usePurchases()`). Testes:
`apps/mobile/tests/storeRules.test.mjs`.

- **`play` e `appstore`:** não há nada digital que se compre por fora da loja, nem botões ou textos que mandem comprar
  noutro sítio. A recarga com M-Pesa/e-Mola/cartão fica escondida até a carteira cumprir as regras (secção 4).
- **`web` e `beta` (APK do site):** fica tudo como estava.

**Decisão do dono (12/11/2026):** pagamentos locais (M-Pesa, e-Mola, cartão), **sem IAP**.

## 1. Pagamentos

| O que se compra / gasta | Onde na app | Regra da Apple | Regra do Google | O que fizemos (lojas) |
|---|---|---|---|---|
| **Comprar / recarregar Txills** (M-Pesa, e-Mola, cartão, teste) | Definições › Txills e pagamentos › «Pedidos e pagamentos» (`/orders`) | 3.1.1: moeda virtual só com IAP. Só escapa como **presente em dinheiro** entre pessoas (3.2.1(vii)) ou como dinheiro para **bens físicos** (3.1.3(e)). Anti-steering: não se pode mandar comprar fora | «Virtual currencies» vendidas na app pedem o Play Billing. Escapam os pagamentos entre pessoas e os bens físicos. Moçambique não tem «user choice billing» | **Escondido**, com dois interruptores para o ligar quando a carteira cumprir as regras (secção 4). `/orders` passa para `/wallet`. Sai a linha das Definições e da pesquisa, e o subtítulo passa a «Carteira e presentes». Na Ajuda e no cofre, nada manda recarregar |
| **Histórico de pedidos de recarga** | `/orders` | Mostra compras feitas fora (preços em MT) | Idem | **Escondido**, com o ecrã |
| **Levantar Txills / converter em dinheiro** | Não existe (os Txills não se trocam por dinheiro) | Sem levantar, um presente não é «dinheiro» que chega a quem recebe (3.2.1(vii)) | Idem (um «peer-to-peer payment» é dinheiro entre pessoas) | **É o que falta** para a recarga local ser aceitável (secção 4) |
| **Presentes / brindes com Txills** (publicações, perfil, chat «Presentes», carteira «Presentear alguém») | `GiftSheet`, carteira, chat | 3.2.1(vii): sem IAP só se o presente for opcional, 100% para quem recebe e não estiver ligado a conteúdo ou serviços digitais | FAQ: gorjeta 100% para o criador, sem desbloquear nada digital, conta como pagamento entre pessoas | **Fica.** O código não tira comissão: o movimento tem duas pernas, −N para quem dá e +N para quem recebe (`WalletService.transfer`). O presente não desbloqueia nada. Hoje usa só o saldo que já existe (boas-vindas, convites, presentes recebidos) |
| **Bombar** (destacar um evento ou uma publicação de um local; publicidade dentro da app) | Gerir › Bombar (`VenueBoost`) | 3.1.3(g): os «boosts» numa rede social têm de usar IAP | Funcionalidade digital: Play Billing | **Criar campanhas: tirado** (só no site, sem ligações nem chamadas para lá). Na app veem-se as campanhas do local, com o relatório, e podem parar-se. Sai da Ajuda a pergunta «Como bombo o meu local?». **Ver destaques fica** (mostrar anúncios é permitido) |
| **Pagar com Txills nos locais** (bens e serviços físicos: bebidas, comida, entrada) | Página do local › «Pagar com Txills» (`VenuePaySheet`) | 3.1.3(e): bens e serviços físicos **têm** de usar outro meio que não o IAP | Bens e serviços físicos: o Play Billing não se usa | **Fica.** Sem comissão (o local recebe tudo). O local também não consegue levantar (secção 4) |
| **Cofre dos TxillGroups** (pôr Txills, pagar a um local, devolver) | Grupo › Cofre (`PotPanel`) | Entre pessoas, e para pagar bens físicos | Pagamento entre pessoas | **Fica.** Já não diz «Carrega a carteira primeiro» |
| **Despesas do grupo** (quem pagou o quê, em MT) | Grupo › Plano › Despesas | Só faz as contas; não há pagamento na app | — | **Fica** |
| **Encomendas (orders)** | É o mesmo `/orders` (pedidos de recarga); não há encomendas de bens | ver «Comprar Txills» | — | **Escondido** |
| **Verificação (selo)** | Definições › Conta › Verificação | Grátis | — | **Fica** (não custa Txills) |
| **SuperTxill (IA)** | Mensagens / Pesquisa | Grátis | — | **Fica** |
| **Nível da geleira** | Perfil › Geleira | O saldo de Txills dá pontos ao nível (1 por cada 200, até 5): é um ganho digital ligado ao saldo | Idem | Hoje não há problema, porque nas lojas não se carregam Txills. **Com recarga, os Txills carregados não podem contar** (secção 4) |
| **Convites que dão Txills** | Convites | Recompensas sem compra: permitidas | «Earned or awarded points» sem Play Billing: permitido | **Fica** |

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
| Ação sobre as denúncias em menos de 24 h | Backoffice › Moderação › Fila de queixas (gravidade, lote, remover, avisar, suspender, auditoria) | ✔ A ferramenta existe, já com os tipos novos. **As 24 h dependem de haver gente a ver a fila.** A app diz «com o objetivo de decidir em menos de 24 horas» |
| Contacto público para denúncias | Ajuda e Sobre: suporte@txillapp.com; Termos, último ponto | ✔ Já existia (a Ajuda passa a dizê-lo na pergunta sobre denúncias) |
| Termos aceites, com «tolerância zero» | Registo: caixa obrigatória «Li e aceito os Termos» | ⚠ A caixa existe, mas os Termos **não dizem «tolerância zero»** nem proíbem nudez ou sexo explícito de adultos (só «nudez de menores»). Fica para o guardião (não se mexeu no `legalText`) |
| Sexo explícito e nudez proibidos | Modelo NSFW no servidor (fotos e vídeos); motivo de denúncia «Nudez ou conteúdo sexual» | ✔ Na técnica; ⚠ nos Termos (ver acima) |
| Partes 18+ (álcool na geleira; Bombar) | API `geleira.service.ts`: o álcool só aparece a quem tem 18 anos ou mais (pela data de nascimento); o Bombar só aparece a maiores de 18 | ✔ Já existia. Idade mínima da conta: 15 anos |
| O conteúdo denunciado fica escondido para quem denunciou | API: `notReportedBy` (`social/visibility.ts`) nos comentários, nos comentários de mimos, nos mimos (bandeja e mimos da pessoa) e nos Zás; feed (`feed_impressions.hidden`); mensagens (`message_hidden`). App: `ReportSheet.onReported` tira-o logo do ecrã | **Novo** (e2e em `moderation/report-ugc.e2e.spec.ts`) |

## 3. As regras confirmadas (12/11/2026)

**Apple — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)**

- **3.1.1:** «If you want to unlock features or functionality within your app, (by way of example: subscriptions,
  in-game currencies, …) you must use in-app purchase.» E também: «Apps may use in-app purchase currencies to enable
  customers to "tip" … digital content providers.»
- **3.1.3(e):** «If your app enables people to purchase physical goods or services that will be consumed outside of the
  app, you must use purchase methods other than in-app purchase…»
- **3.1.3(g):** «…buying advertisements to display in the same app (such as sales of "boosts" for posts in a social
  media app) must use in-app purchase.»
- **3.1.3 (anti-steering):** as apps destas exceções não podem, dentro da app, incentivar outro meio de pagamento que não
  o IAP, salvo na loja dos Estados Unidos.
- **3.1.3(b):** o que se compra noutra plataforma só se pode usar na app se também estiver à venda por IAP.
- **3.2.1(vii):** «Apps may enable individual users to give a monetary gift to another individual without using in-app
  purchase, provided that (a) the gift is a completely optional choice by the giver, and (b) 100% of the funds go to the
  receiver of the gift. However, a gift that is connected to or associated at any point in time with receiving digital
  content or services must use in-app purchase.»
- **3.2.1(viii)** e **5.1.1(ix):** as apps de gestão de dinheiro e de serviços financeiros devem ser submetidas pela
  entidade que presta o serviço, com as licenças necessárias em cada sítio onde estão disponíveis.
- **3.1.5:** só fala de criptomoedas; não se aplica (os Txills não são cripto).

**Google Play**

- **[Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738):** o Play Billing é
  obrigatório para «Items (such as virtual currencies, …)». Não se usa nos bens físicos, nos serviços físicos e nos
  «peer-to-peer payments». Fora dos países do programa, não se pode levar as pessoas a outro meio de pagamento.
- **[FAQ «Understanding Google Play's Payments policy»](https://support.google.com/googleplay/android-developer/answer/10281818):**
  - Gorjetas: «Do direct tips or contributions from user to creator require Play's billing system?» Se o valor vai todo
    para o criador e não desbloqueia nada digital (stickers, emblemas, emojis), «we regard this as a peer-to-peer payment».
  - Pontos: «Earned or awarded points can be issued in-app without using Google Play's billing system», mas «if these
    points (or other types of virtual currency) are sold in-app, Google Play's billing system must be used».
- **[User choice billing / alternative billing](https://support.google.com/googleplay/android-developer/answer/12570971):**
  só para o EEE, a Austrália, o Brasil, a Indonésia, o Japão, a África do Sul, o Reino Unido e os Estados Unidos.
  **Moçambique não está.**

## 4. Recarga local nas lojas: o que diz o código e o que falta

**O que encontrámos no código:**

- **Comissão:** nenhuma. Os presentes, os pagamentos a locais e o cofre são movimentos de duas pernas com o mesmo valor
  (`WalletService.transfer` / `move`), e quem recebe fica com 100%.
- **Levantar:** não existe. Os Termos dizem «não se trocam por dinheiro, não se levantam», e o Gerir › Txills diz
  «Converter Txills em dinheiro ainda não está disponível».
- **Taxa:** não é fixa. Os pacotes (`0050_pagamentos.sql`) são 500 Txills por 50 MT (10 por MT), 1 200 por 100 MT (12),
  3 000 por 230 MT (≈ 13) e 7 500 por 500 MT (15). Os pacotes maiores dão bónus, o que é a forma de uma moeda virtual,
  não de dinheiro.
- **Ganhos digitais pagos com Txills:**
  - o Bombar (já fora das lojas);
  - o nível da geleira, que conta o saldo;
  - os Termos prometem que os Txills «em breve vão servir também para pagar vibes».

  A verificação e o SuperTxill não custam Txills.

**Conclusão: com o desenho atual, as regras não permitem recarregar nas lojas.** Os Txills são uma moeda virtual que
não se levanta. O «dinheiro» que um presente leva nunca chega a quem recebe como dinheiro, por isso falha a condição
(b) da 3.2.1(vii) e a definição de pagamento entre pessoas do Google. Uma moeda virtual vendida dentro da app pede a
compra da loja (Apple 3.1.1; Google: «virtual currencies … sold in-app»). Por isso a recarga continua **escondida** nas lojas.

**O mínimo para a tornar aceitável:**

1. **Levantar o saldo** para M-Pesa ou e-Mola, para as pessoas e para os locais (que hoje também não recebem dinheiro).
   Quem recebe um presente tem de poder levantar 100% dele.
2. **1 Txill = 1 MT**, sem pacotes com bónus. A carteira mostra o saldo em MT («saldo» ou «dinheiro»), não uma moeda de
   jogo, e qualquer valor pode ser carregado.
3. **Nada digital pago com dinheiro carregado:**
   - o Bombar continua só no site (ou com um saldo à parte);
   - o nível da geleira deixa de contar os Txills, ou só conta os Txills ganhos;
   - nada de «vibes» pagas com dinheiro carregado.

   O mais simples é separar o saldo **ganho** (boas-vindas, convites: pontos, que podem continuar a pagar coisas
   digitais) do saldo **carregado ou recebido** (dinheiro: só presentes, cofre e locais).
4. **Presentes 100% para quem recebe**, opcionais e sem desbloquear nada digital: nem emblemas, nem destaque, nem posição.
   A publicação «X presenteou Y» é opcional e fica como está. Se o M-Pesa cobrar taxas, quem paga é a plataforma ou quem
   envia, e nunca sai do presente.
5. **Licença:** guardar dinheiro das pessoas e deixá-las transferi-lo é moeda eletrónica. É preciso a licença do Banco de
   Moçambique ou um parceiro licenciado (por exemplo, M-Pesa/e-Mola de ponta a ponta, sem saldo guardado no Txillapp).
   A Apple (3.2.1(viii), 5.1.1(ix)) pede que a app seja submetida pela entidade licenciada, numa conta de organização.
   **Isto é uma decisão jurídica do dono; não foi confirmado aqui.**
6. **Textos:** os Termos, a Privacidade e a Ajuda passam a descrever a carteira como dinheiro (carregar, enviar, pagar,
   levantar, prazos, reclamações). Isto fica para o guardião.

**Interruptores** (já no código; os dois têm de estar ligados para a recarga aparecer nas lojas):

- `STORE_TOPUP_READY` em `apps/mobile/src/lib/storeRules.ts`: hoje `false`. Passa a `true` só na versão que já tiver os
  pontos 1 a 4. Enquanto for `false`, a app nem pergunta ao servidor.
- `PAYMENTS_STORE_TOPUP` na API (por omissão `false`), que a app lê em `GET /payments/config` (`storeTopup`). Liga e
  desliga a recarga **sem versão nova**: se a revisão o pedir, põe-se a `false` e a recarga desaparece logo. Sem resposta
  do servidor, fica desligada.
- O Bombar nunca se paga nas lojas, com qualquer um dos interruptores.

Alternativa, se o dono mudar de ideias: o IAP (StoreKit e Play Billing), com pacotes consumíveis, validação dos recibos
na API (App Store Server API; Play Developer API com `acknowledge`/`consume` e RTDN) e um saldo «IAP» que não pode pagar
bens físicos.

## 5. Notes for App Review / Google Play review (English)

Paste into App Store Connect › App Review Information › Notes, and into the Play Console declarations, adapting to the
build that is submitted.

**For this build (top-up hidden; `STORE_TOPUP_READY = false`):**

> Txillapp is a social network for Mozambique. The app has no in-app purchases and sells nothing digital. "Txills" are
> free reward points: every new account gets 500, and users earn more by inviting friends. Txills cannot be bought,
> topped up or cashed out in this version of the app, and the app has no links or buttons that send users to buy
> anything elsewhere.
>
> Users can optionally send Txills they already have to people they follow, as a gift. 100% of the gift goes to the
> receiver: there is no commission, and a gift unlocks no content or features. Users can also spend Txills at
> participating physical venues (bars, restaurants, events) for goods and services consumed in the real world, or pool
> them in a group fund to pay a venue.
>
> Paid promotion of venues ("Bombar") cannot be bought in the app. Sponsored posts are only displayed, always labelled
> "Bombado · Patrocinado", and only to users aged 18 or over.
>
> User-generated content: every post, comment, story ("mimo"), story comment, photo ("Zás"), message, profile and
> venue page can be reported from its "⋯" menu, by long-pressing it, or with the flag icon. Reported content is hidden
> from the reporter at once. Users can block anyone from their profile. Text with threats, hate speech or encouragement
> of self-harm is rejected automatically, and photos and videos are checked for nudity on our servers. Our moderation
> team reviews reports in the back office, aiming to act within 24 hours (remove the content, warn or suspend the
> account). Contact: suporte@txillapp.com.
>
> Demo account: <user> / <password>.

**For a future build with local top-up (only after section 4, points 1 to 5):**

> The wallet holds Mozambican meticais (1 Txill = 1 MZN). It is loaded with M-Pesa, e-Mola or card through
> <licensed partner>, and the balance can be withdrawn back to M-Pesa or e-Mola at any time. The wallet is used only for:
> (1) optional monetary gifts between individuals, where 100% of the funds go to the receiver, with no fee and no digital
> content or feature unlocked (guideline 3.2.1(vii); Google Play peer-to-peer payments); and (2) payments to physical
> venues for goods and services consumed outside the app (guideline 3.1.3(e)). Nothing digital can be bought with the
> wallet: no boosts, badges, features or content. Venue promotion is sold only outside the app, with no links or calls to
> action inside it.
