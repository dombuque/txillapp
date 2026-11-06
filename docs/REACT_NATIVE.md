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
| Comentários, menu da publicação, presentear, repostar, partilhar | `components/CommentsSheet.tsx`, `PostCard.tsx`, `GiftSheet.tsx`, `ShareSheet.tsx` | em curso |
| Notificações | `pages/Notifications.tsx` | por fazer |
| Pesquisa e Explorar | `pages/Search.tsx` | por fazer |
| Mensagens e conversa (tempo real) | `pages/Messages.tsx`, `Thread.tsx` | por fazer |
| Perfil (meu e dos outros) | `pages/Profile.tsx` | por fazer (só o essencial) |
| Nova publicação e câmara | `pages/Compose.tsx`, `components/CameraStudio.tsx` | por fazer |
| Stories (ver e criar) | `components/Stories.tsx` | por fazer |
| Reels e filtros do algoritmo | `pages/Reels.tsx`, `ReelPrefs.tsx` | por fazer |
| Guardados, Locais, Geleira, Carteira, Convites, Definições | `pages/*` | por fazer |
| Publicação / reel / hashtag / sítio / local | `PostPage.tsx`, `ReelPage.tsx`, `TagPage.tsx`, `PlacePage.tsx`, `VenuePage.tsx` | por fazer |

O backoffice fica só no site (é para computador).
