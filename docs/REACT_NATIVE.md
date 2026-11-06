# App nativa (React Native / Expo)

`apps/mobile` é a app do Txillapp para Android, iPhone e web: a versão web é o **site principal** (`txillapp.com` e `app.txillapp.com`). O site antigo (`apps/web`) fica só para a moderação em `admin.txillapp.com`. Regra: **cada ecrã tem de ficar igual ao do site**
(mesmas medidas, letras, cores, ícones e textos). O desenho copia-se do ficheiro correspondente em `apps/web/src`.

Ícones: `npm run sync-icons` copia o conjunto "Tx" do site. Sessão: na app nativa o token de renovação vai no cofre do telemóvel
(`X-Client: txillapp-mobile`); na web usa o cookie, como o site.

## Estado dos ecrãs

Legenda: **feito** = escrito, compila e (onde se diz) testado no browser; **por testar** = escrito e compila, mas nunca visto a correr.

| Ecrã (site) | Ficheiro na app | Estado |
|---|---|---|
| Entrar, criar conta (6 passos), esqueci a senha | `login`, `register`, `forgot-password` | feito (entrar testado; registo e esqueci por testar) |
| Início (feed, stories, Zás) | `(tabs)/index`, `PostCard`, `StoriesTray`, `Instants` | feito (Zás por testar) |
| Comentários, menu da publicação, presentear, repostar, partilhar (conversas e status) | `CommentsSheet`, `PostSheets`, `ShareSheet` | feito (partilhar por testar) |
| Notificações, pesquisa e explorar | `notifications`, `search` | feito |
| Mensagens: lista, pedidos, conversa direta, **grupos**, tempo real | `(tabs)/messages`, `messages/[username]`, `messages/g/[id]`, `messages/new`, `lib/realtime` | feito (grupos e tempo real por testar) |
| Perfil (meu e dos outros), seguidores/a seguir, editar perfil (com localização), pedidos para seguir, QR, geleira | `ProfileView`, `ProfileSheets`, `ProfileQrSheet`, `GeleiraShelf`, `u/[username]/*` | feito (QR e geleira por testar) |
| Nova publicação (2 passos, local, música, rascunhos) | `(tabs)/new`, `MusicPicker`, `lib/drafts` | feito (música e rascunhos por testar; rascunhos só ficam em memória no telemóvel até haver armazenamento local) |
| Stories (ver e criar, com música) | `stories/*`, `StoryParts` | feito |
| Reels, página do reel, **O teu algoritmo** (temas, pessoas, origem, ordem, tipo, variedade, esconder visto, modo tranquilo) | `(tabs)/reels`, `r/[id]`, `reels/filtros` | feito (algoritmo testado no browser) |
| Definições completas | `settings` | feito |
| Verificação (documento de qualquer tipo, frente e verso, cara, selfie com o documento, justificação) | `verification` | por testar (câmara) |
| Guardados, carteira, convites, hashtag | `saved`, `wallet`, `invites`, `t/[tag]` | feito |
| Locais, página de um local, página de um sítio | `locais`, `v/[slug]`, `place/[name]` | por testar (sem mapa) |
| Geleira (editor) | `geleira` | por testar |
| Estatísticas, ajuda, sobre, pedidos, idioma, termos, privacidade | `insights`, `help`, `about`, `orders`, `language`, `terms`, `privacy` | por testar |

O backoffice fica só no site (é para computador).


## Site principal e PWA

- A versão web da app é exportada na raiz (`expo export --platform web` + `scripts/post-export-web.mjs dist ""`) e copiada para o nginx (`apps/web/Dockerfile`). O site antigo vai para `/usr/share/nginx/admin`, só servido em `admin.txillapp.com`.
- PWA: `apps/mobile/public/` tem o manifesto, os ícones, `register-sw.js`, `push-sw.js` (notificações push) e `sw.js`. O `sw.js` substitui o do site antigo no mesmo endereço, apaga as caches antigas e recarrega uma vez as janelas abertas. Páginas: primeiro a rede; sem rede, a última aberta. A API nunca fica em cache.
- Links dos emails: `/verify-email` e `/reset-password`. Links antigos: `/tag/:tag` leva a `/t/:tag`; endereços que não existem voltam ao início.
- Login com Google: só na web (a app nativa não o tem ainda).
