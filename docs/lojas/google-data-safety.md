# Google Play Console: formulário «Data safety» (Segurança dos dados)

Feito a partir do que a app e a API recolhem de facto (ramo `loja-dados`, novembro de 2026). Os nomes dos tipos de dados seguem os da Play Console.

Notas de leitura:
- **Recolhido** quer dizer que sai do aparelho para o nosso servidor.
- **Partilhado** quer dizer que vai para outra empresa. Segundo a Google, **não conta como partilha**: o que vai para fornecedores que tratam os dados por nossa conta (Cloudflare, Google FCM, Anthropic, Zoho), o que a pessoa envia de propósito a outras pessoas (mensagens, publicações) e os dados anonimizados.
- **Opcional** é o que a pessoa pode não dar, ou que só existe se usar uma funcionalidade que não é obrigatória.

## Secção 1: perguntas gerais

| Pergunta | Resposta |
|---|---|
| A app recolhe ou partilha algum dos tipos de dados pedidos? | **Sim** |
| Os dados vão cifrados em trânsito? | **Sim.** Tudo vai por HTTPS (`https://txillapp.com`), sem tráfego em claro. As chamadas usam WebRTC com DTLS-SRTP. |
| Dás uma forma de pedir que os dados sejam apagados? | **Sim**: na app (Definições → Conta → «Eliminar conta») e na web, em **https://txillapp.com/apagar-conta** |
| A app permite criar conta? | **Sim**, com email e senha (e com a Google, no site). |
| URL para apagar a conta | **https://txillapp.com/apagar-conta**: explica os passos na app e, para quem já não a tem, pede o apagamento com uma ligação de confirmação enviada para o email da conta. |
| Também dás forma de apagar alguns dados sem apagar a conta? | **Sim**: publicações, mensagens (para mim ou para todos), conversas, chamadas, mimos, conversas com o SuperTxill e pedidos para grupos, e desligar as estatísticas e «Aparecer no mapa». |
| Compromisso com a política «Famílias» | Não se aplica (a app não é para menores de 13). |
| Revisão de segurança independente (MASA) | Não |

## Secção 2: tipos de dados

Para cada linha: **Recolhido / Partilhado / Processado só de passagem? / Obrigatório ou opcional / Finalidades**. Finalidades da Google: Funcionalidade da app, Estatísticas, Comunicações do programador, Prevenção de fraudes, segurança e conformidade, Publicidade ou marketing, Personalização, Gestão da conta.

### Localização
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades | O que é |
|---|---|---|---|---|---|
| Localização aproximada | Sim | Não | Opcional | Funcionalidade, Publicidade | «Aparecer no mapa» (quadrícula de ~1,5 km, 3 h, opt-in, maiores de 18), o sítio arredondado de uma publicação, a zona para À tua volta e para escolher os destaques (esta não fica guardada) |
| Localização exata | Sim | Não | Opcional | Funcionalidade | O ponto enviado numa mensagem (também em direto) e o ponto de um local marcado no sítio. Só em primeiro plano. |

### Informações pessoais
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades |
|---|---|---|---|---|
| Nome | Sim | Não | Obrigatório | Funcionalidade, Gestão da conta |
| Endereço de email | Sim | Não | Obrigatório | Gestão da conta, Comunicações do programador, Segurança |
| IDs de utilizador | Sim | Não | Obrigatório | Funcionalidade, Gestão da conta, Estatísticas |
| Morada | Sim | Não | Opcional | Funcionalidade (a morada de um local; um sítio enviado no chat) |
| Número de telefone | Sim | Não | Opcional | Funcionalidade (o telefone ou WhatsApp da página de um local; dos pagamentos, só os 3 últimos dígitos) |
| Raça e etnia, crenças, orientação sexual, opiniões políticas | Não | | | |
| Outras informações | Sim | Não | Obrigatório | Funcionalidade, Segurança (a data de nascimento, obrigatória para a idade mínima; o género, opcional; os dados e documentos da verificação, opcionais e apagados quando há decisão) |

### Informações financeiras
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades |
|---|---|---|---|---|
| Informações de pagamento do utilizador | **Não** (ficam com o fornecedor: M-Pesa, e-Mola ou cartão) | | | |
| Histórico de compras | Sim | Não | Opcional | Funcionalidade, Prevenção de fraudes (pedidos de recarga de Txills) |
| Classificação de crédito | Não | | | |
| Outras informações financeiras | Sim | Não | Opcional | Funcionalidade (saldo e movimentos de Txills, cofres e pagamentos a locais) |

Hoje os pagamentos só existem em teste. Deixar marcado: a Google aceita que se marque a mais.

### Saúde e fitness: **não.**

### Mensagens
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades |
|---|---|---|---|---|
| Emails | Não | | | |
| SMS ou MMS | Não | | | |
| Outras mensagens na app | Sim | Não | Opcional | Funcionalidade, Segurança (denúncias) |

### Fotos e vídeos
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades |
|---|---|---|---|---|
| Fotos | Sim | Não | Opcional | Funcionalidade, Segurança (verificação automática e verificação de identidade) |
| Vídeos | Sim | Não | Opcional | Funcionalidade, Segurança |

### Ficheiros de áudio
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades |
|---|---|---|---|---|
| Gravações de voz ou som | Sim | Não | Opcional | Funcionalidade (mensagens de voz e o som dos vídeos; as chamadas não são gravadas) |
| Ficheiros de música | Não (só a referência de faixas de licença aberta) | | | |
| Outros ficheiros de áudio | Não | | | |

### Ficheiros e documentos: **não.** Os documentos da verificação são fotos.

### Calendário: **não.**

### Contactos
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades |
|---|---|---|---|---|
| Contactos | Sim | Não | Opcional | Funcionalidade |

São quem segues, quem te segue, os amigos próximos e os bloqueios. A app Android **não lê a agenda**: «Amigos nos contactos» só existe no site, envia resumos SHA-256 dos emails e não guarda nada.

### Atividade na app
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades |
|---|---|---|---|---|
| Interações com a app | Sim | Não | **Opcional** (ligado de origem, desliga-se em Definições → Privacidade → «Ajudar a melhorar o Txillapp») | Estatísticas, Personalização, Publicidade (vezes que um destaque do Bombar foi mostrado ou tocado; o local só vê totais) |
| Histórico de pesquisas na app | Sim | Não | Opcional | Estatísticas (contadores por termo, dia e país, sem a conta, 90 dias) |
| Apps instaladas | Não | | | |
| Outro conteúdo gerado pelo utilizador | Sim | Não | Opcional | Funcionalidade, Segurança (publicações, comentários, mimos, notas, geleira, TxillGroups, locais, denúncias, perguntas ao SuperTxill) |
| Outras ações | Sim | Não | Opcional | Funcionalidade (presença e «visto por último», visitas ao perfil, check-ins, registo de chamadas) |

### Navegação na Web: **não.**

### Informações e desempenho da app
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades |
|---|---|---|---|---|
| Registos de falhas | Sim | Não | Opcional (o mesmo interruptor das estatísticas) | Estatísticas, Funcionalidade |
| Diagnóstico | Sim | Não | Obrigatório | Funcionalidade, Segurança (o tipo de aparelho e a versão da app em cada sessão; o tempo de arranque, que é opcional) |
| Outros dados de desempenho | Não | | | |

### IDs do dispositivo ou outros
| Tipo | Recolhido | Partilhado | Obrig./Opc. | Finalidades |
|---|---|---|---|---|
| IDs do dispositivo ou outros | Sim | Não | Opcional (só com as notificações ligadas) | Funcionalidade, Comunicações do programador |

É o token do Firebase Cloud Messaging e o ID de instalação que o SDK do FCM cria. A app **não** usa o ID de publicidade (não há a permissão `AD_ID`). Confirmar com a equipa do Google Play que o manifesto final não a traz por arrasto.

## Secção 3: partilha

**Nenhum dado é «partilhado»** no sentido da Google:
- Cloudflare (rede e armazenamento), Google FCM (notificações), Anthropic (SuperTxill, sem nome nem id), Zoho (email) e as cópias de segurança cifradas são **fornecedores** que tratam os dados por nossa conta.
- OpenStreetMap, GIPHY e Openverse recebem pelo nosso servidor só o texto pesquisado e posições arredondadas, sem identificação: são dados anónimos e processados só de passagem.
- As mensagens, as publicações e as localizações enviadas a outras pessoas são **transferências que a pessoa pede**.
- Os locais que bombam só veem totais (dados agregados).

## Coerência com a política de privacidade

O formulário bate certo com a política (pontos 1, 2, 8, 9 e 11). Há lacunas na política que convém fechar antes de submeter (o guardião trata disto):
1. A política não diz que guardamos o **país** do pedido.
2. A política não diz que guardamos as **visitas ao perfil**.
3. A política diz «não guardamos o endereço IP». É verdade nas sessões, mas os **registos técnicos** do servidor guardam o IP por pouco tempo.
4. Faltam as **cópias de segurança** (35 dias, e as mensais 400). A página de apagar a conta já o diz.
5. A política não indica a **retenção das estatísticas** de uso.
6. O ponto 9 («Apagar: Definições → Eliminar conta») tem de juntar **txillapp.com/apagar-conta** e o pedido por email. Os Termos, ponto 13, também.
