# Fichas das lojas: App Store e Google Play

Texto em português (Moçambique/Portugal). Idioma principal da ficha: **Português (Portugal)** (`pt-PT`). As lojas não têm `pt-MZ`. Contei os caracteres de cada campo com limite (`[...texto].length`).

> Regras para todas as versões da ficha:
> - não falar de «beta», de testes nem de outras plataformas (Android, iPhone, site);
> - não prometer o que a app não faz;
> - não falar de comprar Txills enquanto os pagamentos não estiverem ligados e aprovados. Na Apple, a moeda virtual comprada com dinheiro tem de passar pela compra integrada (3.1.1): isso é com a equipa dos pagamentos.

---

## 1. Identidade

| Campo | Valor |
|---|---|
| Nome (Apple: 30; Play: 30) | **Txillapp** |
| Subtítulo (Apple, 30) | **A rede social da malta** (22) |
| Texto promocional (Apple, 170) | Publica, conversa e descobre o que se passa perto de ti. Mimos, Tchekas, TxillGroups e À tua volta: a malta toda num só sítio. (126) |
| Descrição curta (Play, 80) | **Publica, conversa e descobre a malta e os sítios perto de ti, em Moçambique.** (76) |
| Palavras-chave (Apple, 100, separadas por vírgulas e sem espaços) | `rede social,moçambique,maputo,amigos,chat,mensagens,fotos,vídeos,stories,eventos,bares,festa,grupos` (99) |
| Categoria (Apple) | Principal: **Redes sociais** (Social Networking). Secundária: **Estilo de vida** (Lifestyle). |
| Categoria (Play) | **Social**. Etiquetas: rede social, mensagens, partilha de fotos. |
| Programador / contacto | Txillapp. Email: suporte@txillapp.com |
| Direitos de autor (Apple) | © 2026 Txillapp |

As palavras-chave da Apple não repetem o nome nem a categoria, porque a Apple já as usa.

## 2. Descrição longa (Apple: 4000; Play: 4000)

```
O Txillapp é a rede social da malta: partilha o teu dia, conversa com os amigos e descobre o que se passa perto de ti.

PUBLICA E PARTILHA
• Fotos, vídeos e textos no feed, com música e o sítio onde estás.
• Tchekas: vídeos curtos para ver e brindar.
• Mimos: fotos e vídeos com stickers e música que duram 24 horas.
• Zás: uma foto rápida só para os amigos ou para os mais próximos.
• Brinda o que gostas e comenta, com stickers e GIFs.

CONVERSA
• Mensagens a dois e em grupo, com fotos, vídeos, voz, GIFs e localização.
• Chamadas de voz e de vídeo.
• Mensagens temporárias, visualização única, editar e apagar para todos.
• Tu escolhes quem te pode mandar mensagens e quem te pode ligar.

TXILLGROUPS
• Combina a saída com a malta: o plano (onde, quando e quem vai), sondagens, a lista do que levar, as despesas de cada um, um álbum e um cofre comum.

À TUA VOLTA
• Um mapa com os locais, os eventos e as publicações perto de ti, na distância que escolheres.
• Aparecer no mapa está desligado de origem. Se o ligares, só te veem as pessoas que escolheres, e só pela zona aproximada.

LOCAIS E EVENTOS
• Segue os teus bares, restaurantes e espaços preferidos, vê os eventos e faz check-in com o QR do local.
• Tens um local? Cria a página, anuncia os eventos e fala com a malta.

GELEIRA E TXILLS
• A geleira mostra os teus gostos: vibes, comidas e sítios.
• Os Txills são a moeda do Txillapp: recebes Txills de boas-vindas, ganhas com convites e presenteias quem segues. Não são dinheiro.

SUPERTXILL
• Um assistente que te ajuda a descobrir pessoas, locais e o que fazer.

A TUA PRIVACIDADE E SEGURANÇA
• Perfil público ou privado, e escolhes quem comenta, menciona, presenteia ou te vê online.
• Bloqueia e denuncia publicações, comentários, mensagens e contas. A nossa moderação analisa cada denúncia.
• As fotos e os vídeos são verificados antes de ficarem visíveis.
• Descarrega os teus dados ou elimina a conta quando quiseres, em Definições → Conta.

O Txillapp é para maiores de 15 anos. Algumas funcionalidades, como aparecer no mapa e os destaques patrocinados, são só para maiores de 18.

Termos: https://txillapp.com/termos
Privacidade: https://txillapp.com/privacidade
Ajuda: https://txillapp.com/suporte
```

(Cerca de 2100 caracteres. A mesma descrição serve nas duas lojas. Se o dono subir a idade mínima para 16 anos, mudar aqui a linha da idade.)

## 3. O que há de novo (primeira versão)

```
Bem-vindo ao Txillapp! Publica, conversa, liga à malta, combina saídas nos TxillGroups e descobre o que se passa à tua volta.
```

## 4. URLs

Todos abrem sem sessão, na app web, e a exportação estática já traz o texto (ver o commit «Apagar a conta sem sessão…»).

| Campo | URL |
|---|---|
| Política de privacidade (Apple e Play) | https://txillapp.com/privacidade |
| Termos de utilização (Apple: EULA personalizado, opcional; Play: não pede) | https://txillapp.com/termos |
| Suporte (Apple «Support URL»; Play: email de contacto e site) | https://txillapp.com/suporte |
| Apagar a conta (Play: «Delete account URL», na secção Data safety) | https://txillapp.com/apagar-conta |
| Marketing (Apple «Marketing URL»; Play: site) | https://txillapp.com |
| Email de contacto (Play, obrigatório) | suporte@txillapp.com |
| Email de privacidade | privacidade@txillapp.com |

Os endereços antigos (`/privacy`, `/terms`, `/help`) continuam a funcionar.

## 5. Classificação etária

### Apple (questionário de «Age Rating» no App Store Connect)

A Apple mudou a escala em 2025: agora é **4+, 9+, 13+, 16+ e 18+**, e o questionário tem perguntas novas (capacidades, controlos e temas médicos). Se o App Store Connect ainda mostrar a escala antiga, a classificação equivalente é **17+**.

**Classificação pretendida: 16+**, ou o que o questionário der, se for mais alta. Nunca escolher uma classificação abaixo da que o questionário calcula.

| Pergunta | Resposta | Porquê |
|---|---|---|
| Controlos parentais | Não | A app não tem controlos parentais. |
| Garantia de idade (age assurance) | Sim | Data de nascimento obrigatória no registo, com mínimo de 15 anos. Para menores de 18: sem álcool, sem «Aparecer no mapa», sem destaques patrocinados, GIFs só para todas as idades. |
| Acesso sem restrições à Web | Não | Não há browser na app. As ligações abrem fora da app. |
| Conteúdo gerado pelos utilizadores | **Sim** | Publicações, comentários, mimos, Tchekas, mensagens. |
| Mensagens e chat | **Sim** | Conversas a dois e em grupo, e chamadas. Permitem falar com desconhecidos, mas de origem só com amigos mútuos. |
| Publicidade | **Sim** | Destaques patrocinados «Bombado · Patrocinado» de locais, só para maiores de 18. |
| Linguagem obscena ou humor grosseiro | Pouco frequente/leve | Calão da malta e conteúdo dos utilizadores. |
| Temas de terror/medo | Nenhum | |
| **Álcool, tabaco ou drogas (referências ou uso)** | **Frequente/intenso** | Bebidas na geleira, bares, «paulada» e festas. Escondido a menores, mas é central para os adultos. |
| Temas maduros ou sugestivos | Pouco frequente/leve | Vida noturna e conteúdo dos utilizadores. |
| Conteúdo sexual ou nudez | Nenhum | Proibido nos termos e verificado automaticamente nas fotos e vídeos. |
| Conteúdo sexual explícito e nudez | Nenhum | |
| Violência (desenhos animados, realista, prolongada) | Nenhum | |
| Armas | Nenhum | |
| Informação médica ou de tratamento / bem-estar | Nenhum | |
| Concursos | Nenhum | |
| Jogos de azar simulados / reais | Nenhum | Os Txills não se trocam por dinheiro e não há apostas. |
| Caixas de recompensa (loot boxes) | Não | |

A Apple pede ainda as regras da 1.2 (conteúdo gerado pelos utilizadores): filtrar, denunciar, bloquear e um contacto. Isso é com a equipa de pagamentos e UGC. O contacto público está em https://txillapp.com/suporte.

### Google Play (questionário IARC e «Público-alvo e conteúdo»)

- **Categoria do questionário:** «Redes sociais, fóruns, blogues e plataformas de conteúdo gerado pelos utilizadores».
- **Interação entre utilizadores:** Sim. **Partilha a localização com outros utilizadores:** Sim (no chat e, se ligado, em À tua volta). **Compras digitais:** só quando os pagamentos estiverem ligados.
- **Referências a álcool:** Sim. **Nudez, violência, jogos de azar:** Não.
- **Classificação esperada:** PEGI 16 / ESRB Teen ou Mature 17+, com «Os utilizadores interagem» e «Partilha a localização». Fica o que o IARC der.
- **Público-alvo:** marcar **16-17** e **18+**. Se a idade mínima ficar nos 15, marcar também **13-15**. Não marcar menos de 13 (a política «Famílias» não se aplica).
- **A app atrai crianças?** Não.
- **Anúncios:** «Sim, a app tem anúncios» (os destaques patrocinados dos locais), sem SDK de anúncios.

### Coerência com a idade mínima

- **Termos** (ponto 2): «Tens de ter pelo menos 15 anos.» **Política** (ponto 10): «não é para menores de 15 anos».
- **Registo:** data de nascimento obrigatória e validada no servidor (`MIN_AGE = 15`, `packages/shared`): no registo com email, no registo com a Google e, a partir deste ramo, também no registo com a Apple.
- **Choque:** com a Apple em 16+, uma pessoa de 15 anos pode criar conta numa app classificada «16+». A Apple não chumba por isto, porque a classificação é sobre o conteúdo, mas não fica coerente. O dono decide (ver o relatório).

## 6. Capturas de ecrã a fazer

Conta de demonstração com dados credíveis (nomes, fotos e locais de Maputo), **sem** «beta» nem versões de teste visíveis, sem a barra do browser e sem dados de pessoas reais sem autorização. A mesma conta serve para o revisor da Apple: pôr o @ e a senha em «App Review Information», com o email já confirmado.

### Apple (`supportsTablet: false`, por isso não há iPad)

| Tamanho | Píxeis (retrato) | Obrigatório? |
|---|---|---|
| iPhone 6,9" | 1320 × 2868 (ou 1290 × 2796) | **Sim** (os mais pequenos são gerados a partir destes) |
| iPhone 6,5" | 1284 × 2778 (ou 1242 × 2688) | Só se a Apple o pedir para esta versão |

Entre 3 e 10 capturas, por esta ordem:
1. Feed com uma publicação com foto, brindes e música. Título: «A malta toda num só sítio».
2. Conversa a dois com foto, voz e reação. Título: «Conversa, manda voz e GIFs».
3. Chamada de vídeo. Título: «Liga à malta, em voz ou vídeo».
4. TxillGroup com o plano, a sondagem e as despesas. Título: «Combina a saída nos TxillGroups».
5. À tua volta, com o mapa de Maputo e os locais. Título: «Descobre o que há perto».
6. Página de um local com um evento. Título: «Os teus sítios e os eventos».
7. Mimos e Tchekas. Título: «Mimos e Tchekas».
8. Definições de privacidade (quem te envia mensagens ou te liga). Título: «Tu decides quem te vê».

Pré-visualização em vídeo (opcional): 15 a 30 s, 886 × 1920 ou 1080 × 1920.

### Google Play

| Recurso | Tamanho | Obrigatório? |
|---|---|---|
| Ícone | 512 × 512 PNG, 32 bits | Sim (já existe `store/icon-1024.png`; reduzir) |
| Gráfico de destaque | 1024 × 500 JPG/PNG, sem transparência | **Sim** |
| Capturas de telemóvel | 9:16, mín. 1080 × 1920 (até 3840) | **Sim**: entre 2 e 8 (pôr as mesmas 8 de cima) |
| Tablet 7" e 10" | 1200 × 1920 / 1600 × 2560 | Não (só para aparecer como app de tablet) |
| Vídeo | ligação do YouTube | Opcional |
