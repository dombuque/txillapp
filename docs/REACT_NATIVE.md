# App nativa (React Native / Expo)

`apps/mobile` é a app do Txillapp para Android, iPhone e web (`txillapp.com/beta/`). Regra: **cada ecrã tem de ficar igual ao do site**
(mesmas medidas, letras, cores, ícones e textos). O desenho copia-se do ficheiro correspondente em `apps/web/src`.

Ícones: `npm run sync-icons` copia o conjunto "Tx" do site. Sessão: na app nativa o token de renovação vai no cofre do telemóvel
(`X-Client: txillapp-mobile`); na web usa o cookie, como o site.

## Estado dos ecrãs

| Ecrã (site) | Ficheiro do site | Estado na app |
|---|---|---|
| Entrar | `pages/AuthForm.tsx` (Login) | feito |
| Criar conta (6 passos) | `pages/AuthForm.tsx` (Register) | por fazer (abre o site) |
| Esqueci a senha / repor / confirmar email | `pages/AuthForm.tsx`, `EmailPages.tsx` | por fazer (abre o site) |
| Início (feed, stories, cartão) | `pages/Feed.tsx`, `components/PostCard.tsx`, `Stories.tsx` | feito (sem ver/criar stories) |
| Comentários, menu da publicação, presentear, repostar | `components/CommentsSheet.tsx`, `PostCard.tsx`, `GiftSheet.tsx` | feito |
| Partilhar (para conversas e status) | `components/ShareSheet.tsx` | por fazer (usa o menu do telemóvel) |
| Notificações | `pages/Notifications.tsx` | feito |
| Pesquisa e Explorar (temas, em alta, grelha, resultados) | `pages/Search.tsx` | feito (faltam SuperTxill, sugestões e visualizador em ecrã inteiro) |
| Cartão de presente no feed | `components/PostCard.tsx` (GiftBlock) | por fazer (hoje aparece como publicação normal) |
| Mensagens e conversa (tempo real) | `pages/Messages.tsx`, `Thread.tsx` | por fazer |
| Perfil (meu e dos outros): cabeçalho, botões, separadores, grelha, seguir, bloquear, denunciar | `pages/Profile.tsx` | feito (faltam editar perfil, QR, geleira, seguidores, pedidos) |
| Publicação aberta (`/p/:id`) | `pages/PostPage.tsx` | feito (faltam atividade e reels em ecrã inteiro) |
| Nova publicação e câmara | `pages/Compose.tsx`, `components/CameraStudio.tsx` | por fazer |
| Stories (ver e criar) | `components/Stories.tsx` | por fazer |
| Reels e filtros do algoritmo | `pages/Reels.tsx`, `ReelPrefs.tsx` | por fazer |
| Guardados, Locais, Geleira, Carteira, Convites, Definições | `pages/*` | por fazer |
| Publicação / reel / hashtag / sítio / local | `PostPage.tsx`, `ReelPage.tsx`, `TagPage.tsx`, `PlacePage.tsx`, `VenuePage.tsx` | por fazer |

O backoffice fica só no site (é para computador).
