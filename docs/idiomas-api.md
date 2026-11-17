# Idiomas na API

O contrato comum está em [idiomas.md](idiomas.md). Aqui fica o que a API faz e como se escreve código novo.

## A conta

- Coluna `identity.users.language` (migração `0177_idioma.sql`). `NULL` quer dizer que a pessoa não escolheu: a app segue o
  idioma do telemóvel, e os pushes e os e-mails saem em português.
- A regra `users_language_check` só aceita os códigos da lista. Para juntar um idioma:
  1. acrescenta-o a `LANGS` em `packages/shared/src/i18n.ts`;
  2. numa migração nova, refaz a regra com o código a mais;
  3. corre `node scripts/i18n/translate.mjs`.
- A exportação dos dados (`GET /me/export`) traz `profile.language`. Apagar a conta volta a pô-lo a `NULL`.

## Rotas

| Pedido | Corpo | Resposta |
| --- | --- | --- |
| `PATCH /api/v1/users/me` | `{ "language": "en" }`, ou `null` para voltar a «o do telemóvel» | o perfil, com `language` |
| `GET /api/v1/auth/me` | | `{ id, username, displayName, verified, verifiedTier, language }` |

- `language` junta-se aos outros campos do `PATCH /users/me` e pode ir sozinho.
- Um código fora da lista dá `400`.
- Se `language` não vier no corpo, o idioma guardado fica como estava.

## O idioma de cada pedido

- O middleware `requestLangMiddleware` (`src/i18n/request-lang.ts`) lê o `Accept-Language` com o `pickLang` do shared.
  Aceita só os códigos da lista; com qualquer outro, fica `pt`.
- Guarda o idioma em `req.lang` e num `AsyncLocalStorage`. Em qualquer ponto do pedido, `requestLang()` devolve-o.
- `recipientLang(stored, self)` dá o idioma de quem recebe: o que está guardado na conta; se a conta não tiver nenhum, `pt`.
  Com `self = true`, um e-mail que a própria pessoa pediu agora (confirmar o e-mail, recuperar a senha, apagar a conta,
  novo início de sessão) usa o idioma do pedido.

## Erros

- O filtro global `I18nExceptionFilter` (`src/i18n/i18n.filter.ts`, registado como `APP_FILTER`) trata as
  `HttpException`. Traduz `message` (texto ou lista), `issues[].message` e `hint` para o idioma do pedido.
- O `code` e o resto da resposta não mudam.
- Os textos continuam em português no código, e esse texto é a chave do catálogo.
- O `ZodPipe` usa também as mensagens próprias do zod (as que o código não escreve) no idioma do pedido, com
  `z.locales`.

## Textos montados (erros e pushes)

- Um texto com `${}`, como `` `@${n} não existe` ``, fica no catálogo como `@{n} não existe`.
- `translateText(texto, lang)` (`src/i18n/i18n.ts`) procura primeiro a frase inteira. Se não a encontrar, reconhece no
  texto já montado uma frase do catálogo com `{nome}`. As partes variáveis passam como estão, ou traduzidas se também
  forem frases do catálogo (por exemplo, «o teu local»).
- `«Ana: criou uma sondagem»` traduz a parte depois dos dois pontos.
- Sem nada que bata certo, o texto fica em português.

## Pushes

- `PushService.send(userId, payload)` lê `users.language` de quem recebe, traduz o `title` e o `body` e entrega por
  `deliver()`. Nos testes, espia-se o `deliver` para ver o texto final.
- Há textos em que o número ou a gramática mudam a frase: plurais, o artigo antes do nome («O @januario») e as datas.
  Esses montam-se já no idioma de quem recebe (`push.langOf(userId)` ou `notifications.langOf(userId)`), com
  `t(frase, vars, lang)`:
  - lembretes de regresso: `composeMessage(f, stage, lang)`;
  - sexta da gelada: `fridayMessage(f, lang)`;
  - «Está na hora da tua Txillada»;
  - Txillada agendada mudada ou cancelada: `whenLabel(at, now, lang)`, com `Intl` e o fuso `Africa/Maputo`.

## E-mails

- `src/mail/templates.ts` usa `t(frase, { nome }, lang)` em cada texto. Cada função recebe `lang` no fim.
- O HTML leva `<html lang="…">`.
- As datas saem com `Intl` no idioma de quem recebe, com «(hora de Maputo)».

## Como escrever código novo

- **Erros:** escreve como sempre, em português: `throw new BadRequestException('…')` ou `{ code, message: '…' }`. Com
  variáveis, usa crase (`` `No máximo ${MAX} itens` ``) e não `'…' + x`, porque a extração não apanha textos juntados com
  `+`.
- **Pushes:** `title` e `body` em português, num objeto com `url`. Saem traduzidos sozinhos.
- **Frases guardadas em tabelas ou constantes**, por exemplo `{ image: 'enviou-te uma foto' }`: marca-as com
  `msg('…')`, para entrarem no catálogo. Uma frase com variáveis que só se traduz à saída escreve-se
  `t('{who} convidou-te…', { who })`, sem `lang`, e sai em português.
- **Plural:** `t('{count} brinde', { count, other: '{count} brindes' }, lang)`, como na app.
- **Datas e números:** `Intl` com `intlLocale(lang)`.

## Extração e catálogo

- `scripts/i18n/extract-api.cjs` recolhe as frases da API:
  - `new XxxException('…')` e os campos `message` e `hint`;
  - `title` e `body` de objetos com `url`, ou com `title` e `body` juntos;
  - as mensagens das validações zod (`.min(1, '…')`, `.refine(…, '…')`, `{ message }`, `addIssue`);
  - `errorMessage`;
  - `t()` e `msg()`.
- Está ligado ao `extract.mjs` da base pelo campo `extra` da parte «api» em `scripts/i18n/config.json`. Por isso,
  `node scripts/i18n/translate.mjs` traduz também as frases da API.
- Também corre sozinho: `node scripts/i18n/extract-api.cjs [--json]`.
- O catálogo da API é `apps/api/src/locales/<lang>.json`. É gerado pelo script e nunca se escreve à mão: as correções vão
  para `locales/overrides/<lang>.json`.
- O `nest-cli.json` copia o catálogo para `dist/locales` no build, e a imagem Docker leva-o com o `dist`.
- `LOCALES_DIR` muda a pasta de onde o catálogo é lido.

## Testes

- `src/i18n/idiomas.e2e.spec.ts` cobre:
  - erros em `en` com `Accept-Language: en`, e `pt` por omissão;
  - o `code` que não muda;
  - guardar `language` no perfil e lê-lo em `GET /auth/me`;
  - um push em `en` para quem tem `language` `en`;
  - um e-mail no idioma do pedido;
  - a exportação e o apagar da conta;
  - plurais, datas e textos montados.
- O teste usa um catálogo próprio por cima do gerado (`reloadCatalogs({ en: … })`), para não depender do que a máquina
  traduziu.
