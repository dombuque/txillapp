# Txillapp na App Store: dossiê de submissão

Rascunho de trabalho, feito a partir das App Review Guidelines (verificar a versão em vigor no dia da submissão). Estado a 3 de novembro de 2026.

## 1. Estado resumido

| Tema | Estado |
|---|---|
| App nativa (Capacitor) | **Por fazer.** Só existe a PWA; a Apple recusa sites embrulhados. Precisa de funcionalidades nativas reais (push, câmara, contactos). |
| Compra de Txills (regra 3.1.1) | **Decisão pendente.** Moeda virtual dentro da app iOS tem de usar a compra da Apple. M-Pesa, e-Mola e cartão não podem ser o método dentro do iPhone. |
| Iniciar sessão com a Apple (4.8) | **Por fazer.** Há login com a Google, logo é obrigatório. |
| Conteúdo de utilizadores (1.2) | **Parcial.** Há denúncia, bloqueio e filtro de fotos. Falta filtro de texto, compromisso de resposta e backoffice. |
| Funcionalidades "em breve" | **Por limpar** na versão para revisão (Comprar Txills, Français, Traduzir publicações). |
| Eliminar conta (5.1.1(v)) | **OK** (Definições → Eliminar conta, com descarregar dados). |
| Política de privacidade e termos | **OK** (públicos em `/privacy` e `/terms`, e dentro da app em Definições → Sobre). |
| Idade mínima | **OK** (13 anos, validada no servidor). |
| Pedido de rastreio (ATT) | **Não é preciso**: não há rastreio publicitário nem partilha de dados com terceiros para anúncios. |

## 2. Ficha da app

- **Nome:** Txillapp
- **Subtítulo (30 caracteres):** A rede da malta
- **Categoria principal:** Redes sociais. **Secundária:** Estilo de vida.
- **Idiomas da ficha:** Português (Portugal; a Apple não tem Moçambique) e Inglês.
- **URL de suporte:** https://txillapp.com (com a página de ajuda dentro da app e o email `suporte@txillapp.com`; o correio do domínio está no Zoho).
- **URL de marketing:** https://txillapp.com
- **URL da política de privacidade:** https://txillapp.com/privacy
- **Direitos:** © Txillapp
- **Descrição curta (rascunho):** Fotos, vídeos, stories, reels e chat com a tua malta. Brinda, presenteia, mostra a tua geleira de gostos e fala sem tempo a perder.
- **Palavras-chave (100 caracteres):** rede social,malta,stories,reels,chat,Moçambique,amigos,fotos,vídeos,mensagens

## 3. Classificação etária (questionário da Apple)

Respostas propostas, com o resultado provável **17+**:

| Pergunta | Resposta | Porquê |
|---|---|---|
| Referências a álcool, tabaco ou drogas | **Frequentes** | A geleira tem bebidas alcoólicas (cervejas, vinhos, destilados) e vibes de festa, só visíveis a maiores de 18. |
| Conteúdo de utilizadores / redes sociais | **Sim** | Publicações, comentários, mensagens, stories. |
| Conteúdo sexual ou nudez | Nenhum | Fotos verificadas automaticamente; recusa e fila de moderação. |
| Violência | Nenhuma / rara | Proibida nos termos. |
| Jogos de azar | Nenhum | Txills são pontos virtuais, sem prémios. |
| Acesso livre à web | Não | Só abre ligações para partilha. |
| Conteúdo gerado por IA | Não | |

Decisão do dono: confirmar que aceita 17+. Alternativa, se quiseres baixar: retirar as bebidas alcoólicas do catálogo da geleira na versão iOS.

## 4. Etiquetas de privacidade (App Privacy)

Todos os dados abaixo são **ligados à identidade** da pessoa, **não usados para rastreio**.

| Tipo de dado | Recolhido? | Para quê | Notas |
|---|---|---|---|
| Nome | Sim | Funcionalidade da app | Nome e @utilizador. |
| Endereço de email | Sim | Funcionalidade da app, autenticação | Confirmação de conta e recuperação de senha. |
| Fotos ou vídeos | Sim | Funcionalidade da app | Publicações, stories, chat; documento e selfie da verificação (apagados após a decisão). |
| Outro conteúdo do utilizador | Sim | Funcionalidade da app | Textos, comentários, mensagens, notas, gostos da geleira. |
| Mensagens | Sim | Funcionalidade da app | Chat 1 para 1 e em grupo. |
| Localização precisa | Sim, só se a pessoa a partilhar | Funcionalidade da app | Localização em direto no chat; não se guarda histórico. |
| Contactos | Só se usar "Amigos nos contactos" | Funcionalidade da app | Só sai do aparelho o resumo cifrado (SHA-256) dos emails; não guardamos. Declarar por precaução. |
| Identificadores (ID do utilizador) | Sim | Funcionalidade da app | |
| Dados de utilização (interação com o produto) | Sim, **desligável** em Definições | Análise | Aberturas, ecrãs vistos; sem terceiros. |
| Diagnóstico (falhas, desempenho) | Sim | Análise, funcionalidade | |
| Informação financeira | Não pela Txillapp | | Com compra da Apple, o pagamento é da Apple. |
| Dados sensíveis | Género, só se a pessoa o der | Funcionalidade da app | Escolhido ao criar a conta; não se altera. |

## 5. Textos dos pedidos de permissão (para o `Info.plist` da app nativa)

| Chave | Português | Inglês |
|---|---|---|
| `NSCameraUsageDescription` | O Txillapp usa a câmara para tirares fotos e gravares vídeos para publicar, stories e mensagens. | Txillapp uses the camera so you can take photos and record videos for posts, stories and messages. |
| `NSMicrophoneUsageDescription` | O Txillapp usa o microfone para gravares vídeos e mensagens de voz. | Txillapp uses the microphone to record videos and voice messages. |
| `NSPhotoLibraryUsageDescription` | O Txillapp acede às tuas fotos para escolheres o que publicar ou enviar. | Txillapp accesses your photos so you can choose what to post or send. |
| `NSPhotoLibraryAddUsageDescription` | O Txillapp guarda fotos e vídeos na tua galeria quando pedes. | Txillapp saves photos and videos to your library when you ask. |
| `NSLocationWhenInUseUsageDescription` | O Txillapp usa a tua localização para sugerir sítios perto de ti e para partilhares a tua localização numa conversa. | Txillapp uses your location to suggest nearby places and to share your location in a chat. |
| `NSContactsUsageDescription` | O Txillapp lê os teus contactos para ver quem já está no Txillapp. Só enviamos um resumo cifrado dos emails e não guardamos nada. | Txillapp reads your contacts to find people already on Txillapp. We only send an encrypted summary of the emails and store nothing. |
| Notificações | Pedido na app (explicar antes: "Liga as notificações para saberes logo quando alguém te escreve, responde ou te segue."). | |

Não é preciso `NSUserTrackingUsageDescription` (não há rastreio).

## 6. Notas para o revisor (App Review Information)

Texto proposto para preencher na submissão (ajustar a conta de teste):

> Txillapp é uma rede social de fotos, vídeos, stories, reels e chat.
> **Conta de teste:** `<email>` / `<senha>` (email já confirmado).
> **Moderação de conteúdo:** cada publicação, comentário, mensagem e perfil tem "Denunciar" no menu (…); "Bloquear" está no perfil; a eliminação da conta está em Definições → Eliminar conta. As fotos são verificadas automaticamente antes de ficarem visíveis. Os termos têm tolerância zero a conteúdo abusivo e as denúncias são analisadas pela nossa equipa de moderação.
> **Álcool:** a "geleira" (gostos do perfil) inclui bebidas alcoólicas, visíveis só a maiores de 18 anos.
> **Txills:** pontos virtuais para presentear quem se segue. Na versão iOS são comprados com a compra dentro da app da Apple. Não têm valor monetário e não se trocam por dinheiro.
> **Contactos:** o acesso aos contactos é opcional e só envia um resumo cifrado dos emails para encontrar amigos; não se guarda nada.
> **Contacto:** suporte@txillapp.com

## 7. Conta de teste para os revisores

Criar na produção **só com autorização do dono** (são dados reais no servidor):

1. Registar uma conta normal (por exemplo `revisao`) e confirmar o email.
2. Preencher perfil (foto, bio) e a geleira (alguns gostos).
3. Publicar 3 fotos/vídeos e 1 reel; seguir 3 a 5 contas de exemplo que sigam de volta; deixar 1 story e 1 nota ativos.
4. Garantir saldo de Txills (o bónus de boas-vindas basta).
5. Anotar email e senha na ficha da submissão e **mudar a senha depois da revisão**.

## 8. Checklist de submissão

- [ ] Conta de programador da Apple (cerca de 99 USD por ano) e acesso a um Mac (ou serviço de compilação na nuvem).
- [ ] App nativa (Capacitor) com push nativas (APNs), câmara, contactos.
- [ ] Iniciar sessão com a Apple (servidor e app).
- [ ] Compra dentro da app para os Txills (StoreKit); esconder M-Pesa, e-Mola e cartão no iPhone.
- [ ] Filtro de texto, compromisso de resposta às denúncias e backoffice da equipa.
- [ ] Remover "em breve" da versão de revisão.
- [ ] Decidir a classificação etária (17+).
- [ ] Preencher as etiquetas de privacidade (secção 4).
- [ ] Conta de teste (secção 7) e notas do revisor (secção 6).
- [ ] Capturas de ecrã (iPhone 6,9" e 6,5") e ícone 1024x1024 sem transparência.
- [ ] Caixa `suporte@txillapp.com` a receber e a responder.
- [ ] Cópias de segurança do servidor a funcionar (fica para a fase "sandbox").
