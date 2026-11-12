# App Store Connect: respostas do «App Privacy»

Feito a partir do que a app e a API recolhem de facto (ramo `loja-dados`, novembro de 2026), e não só do que diz a política. Onde as duas não batem certo, está anotado em «Contradições» no fim.

Regra da Apple: «recolher» é enviar para fora do aparelho e guardar mais tempo do que é preciso para responder ao pedido. O que só passa pelo servidor sem ficar guardado (a posição arredondada de À tua volta e do Bombar, as pesquisas de sítios, GIFs e música, os resumos dos contactos) **não conta como recolha**.

## Perguntas gerais

| Pergunta | Resposta |
|---|---|
| Recolhes dados desta app? | **Sim** |
| URL da política de privacidade | https://txillapp.com/privacidade |
| Os dados são usados para **rastrear** (tracking)? | **Não.** Não há SDK de anúncios, de atribuição ou de estatísticas de terceiros, nem IDFA, e não se partilham dados com corretores de dados. Os destaques do Bombar são escolhidos no nosso servidor, só pela zona e pela idade, sem dados de outras empresas. Por isso **não é preciso o pedido de ATT** (`NSUserTrackingUsageDescription`). |
| Parceiros terceiros recolhem dados na app? | Só fornecedores que trabalham para nós: Cloudflare (rede e R2), Google FCM (notificações), Anthropic (SuperTxill, sem identificação), Zoho (email) e OpenStreetMap (sítios, pelo nosso servidor). Nenhum usa os dados para si. As imagens do GIPHY e os servidores STUN da Google veem o endereço de rede de quem os usa (ver a política, pontos 1 e 11). |

Para cada tipo de dado: **Ligado à identidade? / Rastreio? / Finalidades**. «Funcionalidade» = App Functionality; «Análise» = Analytics; «Personalização» = Product Personalization; «Publicidade de terceiros» = Third-Party Advertising.

## Tipos de dados a marcar

### Informação de contacto
| Dado | Recolhido | Ligado | Rastreio | Finalidades | O que é |
|---|---|---|---|---|---|
| Nome | Sim | Sim | Não | Funcionalidade | Nome no perfil. |
| Endereço de email | Sim | Sim | Não | Funcionalidade | Conta, confirmação, recuperar a senha, lembretes. Também o email da Apple, se entrar com a Apple. |
| Número de telefone | Sim | Sim | Não | Funcionalidade | Só quem gere um local e escreve o telefone ou o WhatsApp da página. Dos pagamentos guardam-se só os 3 últimos dígitos. |
| Endereço físico | Sim | Sim | Não | Funcionalidade | A morada da página de um local, e o nome e a morada de um sítio enviado no chat. |
| Outra informação de contacto | Não | | | | |

### Saúde e forma física: **não recolhido.**

### Informação financeira
| Dado | Recolhido | Ligado | Rastreio | Finalidades |
|---|---|---|---|---|
| Informação de pagamento | **Não** (os dados do pagamento ficam com o fornecedor) | | | |
| Outra informação financeira | Sim | Sim | Não | Funcionalidade: o saldo e os movimentos de Txills, cofres e pagamentos a locais. |

### Localização
| Dado | Recolhido | Ligado | Rastreio | Finalidades | O que é |
|---|---|---|---|---|---|
| Localização precisa | Sim | Sim | Não | Funcionalidade | O ponto exato que a pessoa envia numa mensagem (também em direto) e o ponto de um local marcado com «Usar a minha localização». Só com a app aberta e só quando a pessoa toca. |
| Localização aproximada | Sim | Sim | Não | Funcionalidade | A quadrícula de cerca de 1,5 km de «Aparecer no mapa» (opcional, maiores de 18, apagada ao fim de 3 h) e o sítio arredondado de uma publicação. |

### Informação sensível: **não recolhida.**
A Apple só conta como sensível a origem étnica, a orientação sexual, a gravidez, a deficiência, as crenças, a filiação sindical, as opiniões políticas, os dados genéticos e os biométricos. O género, a data de nascimento e os documentos da verificação vão em «Outros dados». As selfies da verificação são revistas por pessoas e nunca há reconhecimento facial.

### Contactos
| Dado | Recolhido | Ligado | Rastreio | Finalidades |
|---|---|---|---|---|
| Contactos | Sim | Sim | Não | Funcionalidade |

A Apple conta o «social graph» (quem segues e quem te segue, os amigos próximos, os bloqueios) como Contactos. A agenda do telemóvel **não** é lida na app iOS: «Amigos nos contactos» só existe no site e não guarda nada.

### Conteúdo do utilizador
| Dado | Recolhido | Ligado | Rastreio | Finalidades |
|---|---|---|---|---|
| Emails ou mensagens de texto | Sim | Sim | Não | Funcionalidade (as mensagens do chat, a dois e em grupo) |
| Fotos ou vídeos | Sim | Sim | Não | Funcionalidade (publicações, mimos, Zás, chat, foto de perfil e documentos e selfies da verificação, apagados quando há decisão) |
| Dados de áudio | Sim | Sim | Não | Funcionalidade (mensagens de voz e o som dos vídeos; as chamadas **não** são gravadas) |
| Conteúdo de jogos | Não | | | |
| Apoio ao cliente | Não (o suporte é por email, fora da app) | | | |
| Outro conteúdo do utilizador | Sim | Sim | Não | Funcionalidade (textos das publicações, comentários, notas, geleira, TxillGroups, locais, eventos, denúncias, conversas com o SuperTxill) |

### Histórico de navegação: **não recolhido.** O que a pessoa vê dentro da app não é «navegação».

### Histórico de pesquisa
| Dado | Recolhido | Ligado | Rastreio | Finalidades |
|---|---|---|---|---|
| Histórico de pesquisa | Sim | **Não** | Não | Análise |

São contadores por termo, dia e país, sem a conta e apagados aos 90 dias. As perguntas ao SuperTxill vão em «Outro conteúdo do utilizador».

### Identificadores
| Dado | Recolhido | Ligado | Rastreio | Finalidades |
|---|---|---|---|---|
| ID de utilizador | Sim | Sim | Não | Funcionalidade, Análise (o id da conta e o @) |
| ID do aparelho | Sim | Sim | Não | Funcionalidade (o token das notificações, guardado com a conta) |

A app não lê o IDFA nem o IDFV.

### Compras
| Dado | Recolhido | Ligado | Rastreio | Finalidades |
|---|---|---|---|---|
| Histórico de compras | Sim | Sim | Não | Funcionalidade (pedidos de recarga de Txills: pacote, valor, estado e datas) |

Hoje os pagamentos só existem em teste. Marcar na mesma: a app vai ser revista com eles, e marcar a mais não chumba.

### Dados de utilização
| Dado | Recolhido | Ligado | Rastreio | Finalidades | O que é |
|---|---|---|---|---|---|
| Interação com o produto | Sim | Sim | Não | Análise, Personalização, Funcionalidade | Estatísticas próprias (aberturas, ecrãs, ações). Vem **ligado de origem**; desliga-se em Definições → Privacidade → «Ajudar a melhorar o Txillapp». Também o que já viste no feed e as preferências do Explorar. |
| Dados de publicidade | Sim | Sim | Não | **Publicidade de terceiros**, Análise | Cada vez que um destaque do Bombar (anúncio de um local) foi mostrado ou tocado, e os locais escondidos. O local só vê totais. |
| Outros dados de utilização | Sim | Sim | Não | Funcionalidade | Presença e «visto por último», visitas ao perfil (para as estatísticas do dono do perfil), check-ins e registo de chamadas. |

O Bombar mostra anúncios **de terceiros** (os locais), por isso a finalidade certa é «Third-Party Advertising». Não há rastreio: nada sai para outras empresas.

### Diagnóstico
| Dado | Recolhido | Ligado | Rastreio | Finalidades |
|---|---|---|---|---|
| Dados de falhas | Sim | Sim | Não | Análise, Funcionalidade (`client_error`: uma mensagem curta, limpa de dados pessoais) |
| Dados de desempenho | Sim | Sim | Não | Análise (tempo de arranque) |
| Outros dados de diagnóstico | Sim | Sim | Não | Funcionalidade (o tipo de aparelho e de browser e a versão da app, em cada sessão) |

### Ambiente envolvente e corpo (visionOS): **não recolhidos.**

### Outros dados
| Dado | Recolhido | Ligado | Rastreio | Finalidades |
|---|---|---|---|---|
| Outros tipos de dados | Sim | Sim | Não | Funcionalidade |

Inclui a data de nascimento (idade mínima e regras para menores), o género, o país do pedido (pelo Cloudflare), os dados e documentos da verificação (apagados quando há decisão) e a impressão da rede de quem se regista com um convite (antifraude).

## Resumo para o ecrã final («Data Linked to You»)

- **Ligados a ti:** Contact Info, Financial Info, Location, Contacts, User Content, Identifiers, Purchases, Usage Data, Diagnostics, Other Data.
- **Não ligados a ti:** Search History.
- **Usados para te rastrear:** nenhum.

## Coerência com a política de privacidade

Bate certo: estatísticas ligadas de origem e ligadas à conta (ponto 1, «Utilização»), localização (pontos 1 e 8), verificação (ponto 6), terceiros (ponto 11) e «não partilhamos dados para publicidade».

Contradições ou lacunas a corrigir na política (o guardião das políticas trata disto; ver o relatório):
1. **País**: guardamos o país do pedido na conta e nas publicações, e a política não o diz.
2. **Visitas ao perfil**: guardamos quem viu o perfil e quando (para as estatísticas), e a política não o diz.
3. **Registos técnicos com o IP**: a política diz «não guardamos o endereço IP» (nas sessões, o que é verdade), mas os registos do nginx guardam o IP de cada pedido até a rotação os apagar (5 × 10 MB).
4. **Cópias de segurança**: são cifradas e guardadas 35 dias, e as mensais 400 dias. A política não o diz, e o ponto 8 dá a entender que apagar é na hora e de vez.
5. **Fornecedores**: Cloudflare e Zoho (email) não aparecem pelo nome. Está coberto por «fornecedores de alojamento e de rede», mas o email não é rede nem alojamento.
6. **Estatísticas de uso**: a política não diz por quanto tempo são guardadas. Hoje ficam até a conta ser apagada (`analytics.events`, `feed_impressions`, `profile_views`).
