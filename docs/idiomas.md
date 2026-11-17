# Idiomas do Txillapp: contrato comum das três equipas

Pedido do dono: «Usa alguma biblioteca de tradução e não tradução manual, o app já é enorme». Nas Definições,
«Idioma e traduções» passa a só «Idiomas»; a parte de traduzir publicações sai.

## Decisões

- **Biblioteca:** i18next. Na app usa-se o i18next diretamente, com uma função `t`; o react-i18next só se for mesmo preciso.
  O idioma do telemóvel lê-se com o expo-localization. Na API usa-se o i18next.
  - Não acrescentes nenhum módulo nativo além do expo-localization. Se o expo-localization não estiver instalado, instala
    com `npx expo install expo-localization`. Isso obriga a uma APK nova, e isso está previsto.
- **A chave é a própria frase em português de Moçambique**, que é a língua de origem. Ninguém inventa nomes de chaves.
  - Variáveis no formato `{nome}`, como o `tr()` que já existe em `components/FridgeArt.tsx`. No i18next configura-se
    `interpolation: { prefix: '{', suffix: '}', escapeValue: false }`.
  - Plural: o i18next com `count`. A frase de origem é a do singular, e as formas `_one` e `_other` geram-se.
  - Sem `keySeparator` nem `nsSeparator` (`false`), porque as frases têm «.» e «:».
- **Idiomas iniciais:** `pt` (origem, igual ao texto do código) e `en`.
  - Juntar um idioma tem de ser só acrescentar o código na lista `LANGS` de `packages/shared` (ou de um ficheiro de
    configuração único) e correr o script de tradução.
  - Cada idioma tem nome próprio na lista: «Português», «English».
- **Catálogos:** `locales/<lang>.json` na raiz do monorepo, com `{ "frase pt": "tradução" }`. Ficam no git, gerados pelo
  script e não escritos à mão. Há um só catálogo para a app e para a API, e cada parte carrega o que precisa; ou dois
  catálogos (`locales/app/en.json` e `locales/api/en.json`). A equipa base decide e as outras seguem.
- **Tradução automática:** `scripts/i18n/translate.mjs` na raiz.
  1. Lê as frases extraídas.
  2. Traduz só as novas ou mudadas, comparando com um `locales/.hash.json`.
  3. Escreve os catálogos.
  - Fornecedor: LibreTranslate por omissão (`LT_URL`, por omissão `http://localhost:5000`; local:
    `docker run -d --name libretranslate -p 5000:5000 libretranslate/libretranslate --load-only pt,en`). DeepL se houver
    `DEEPL_API_KEY`.
  - **Glossário** (`scripts/i18n/glossary.json`): termos que NÃO se traduzem e se protegem antes de mandar ao tradutor
    (trocados por marcadores e repostos depois): Txillapp, Txillada, Txilladas, mimo, mimos, tchekas, Tcheka, Zás, vibes,
    vib, Mixar, geleira, gelada, geladas, TxillGroup, TxillGroups, SuperTxill, Paga-me uma, malta. As variáveis `{nome}`
    também se protegem.
  - Correções pontuais vão para `locales/overrides/<lang>.json`, que manda sobre a tradução automática. Isto serve só
    para corrigir um erro da máquina, nunca para traduzir à mão.
- **Extração:** `scripts/i18n/extract.mjs` lê o código e recolhe todas as frases de `t('…')` e `t("…")`, incluindo as
  partes de JSX que o codemod transforma. Usa o i18next-parser ou um extrator próprio com o TypeScript, à escolha da equipa
  base.
  - Um teste falha se houver uma frase usada no código que não está no catálogo de cada idioma.
  - Um teste falha também se `t()` receber algo que não é texto literal: variáveis só via `{nome}`.
- **Idioma da pessoa:**
  - Por omissão, o do telemóvel ou do browser. Se não estiver na lista, `pt`.
  - A escolha no ecrã «Idiomas» guarda-se no aparelho, para ler já no arranque, e na conta (`identity.users.language`,
    migração da equipa API), para os pushes e e-mails.
  - A app manda `Accept-Language: <lang>` em todos os pedidos.
  - Mudar o idioma recarrega a app: na web `location.reload()`, no nativo `expo-updates reloadAsync` se existir, senão
    volta a montar a raiz com um `key`.
  - Por isso o `t()` pode ser uma função normal e síncrona. Mas o idioma tem de estar resolvido ANTES de qualquer ecrã
    usar `t()`: lê-se de forma síncrona no arranque (localStorage na web; no nativo, um armazenamento síncrono que já
    exista, ou o idioma do sistema até carregar).
  - Textos em constantes do módulo (fora de componentes) são avaliados uma vez. O codemod passa-os a funções ou a
    `t()` na hora de mostrar.
- **API:**
  - Mensagens de erro (`HttpException`), notificações com texto feito no servidor, pushes e e-mails saem no idioma de
    quem recebe: `Accept-Language` do pedido, ou `users.language` para quem recebe um push.
  - Textos legais, Termos e Privacidade: ficam em português, e noutros idiomas mostra-se um aviso «The Portuguese version
    is the one that applies», também traduzido pela máquina.
- **Formatos:** datas, horas e números com `Intl` e o idioma ativo, não com textos à mão.
- **Não se traduz:** o conteúdo das pessoas (publicações, comentários, nomes, @), os nomes das funcionalidades do glossário
  e os emojis das bebidas.

## Decisões da equipa base (valem para as três equipas)

### Catálogos

- **Um só catálogo por idioma:** `locales/<lang>.json` na raiz, com todas as frases da app, do site e da API. É o que se
  revê e o que o teste confere. Ao lado ficam a memória da tradução (`locales/.hash.json`), as correções
  (`locales/overrides/<lang>.json`) e a lista das frases extraídas (`locales/.phrases.json`).
- **Cada parte carrega uma cópia só com as suas frases**, gerada pelo mesmo script, porque o Metro (app) e os `Dockerfile`
  (API, site e app web) só veem a pasta da própria parte:
  - app: `apps/mobile/src/locales/<lang>.json` (carregado em `src/lib/i18n.ts`);
  - site e backoffice: `apps/web/src/locales/<lang>.json` (carregado em `src/lib/i18n.ts`);
  - API: `apps/api/src/locales/<lang>.json` (a equipa API carrega-o com `require`/`resolveJsonModule`, para ir parar ao `dist`).
- As pastas, as funções que a extração procura e as saídas estão em `scripts/i18n/config.json`. Se a API precisar de
  outra pasta ou de outro nome de função, muda-se lá, sem mexer nos scripts.
- O português não tem catálogo: a chave é o texto. Os outros idiomas têm `"frase": "tradução"` e, nos plurais,
  `"frase_one"`, `"frase_other"` (e as outras formas que o idioma tiver, pelo `Intl.PluralRules`).

### Como se escreve no código

```ts
t('Guardar')
t('Olá, {nome}.', { nome })
t('{count} seguidor', { count: n, other: '{count} seguidores' })   // plural: `other` com a forma do plural, literal
```

- A frase e o `other` são sempre textos literais. O teste `apps/mobile/tests/i18n.test.mjs` falha com `t(variavel)`,
  `` t(`…${x}`) `` ou `t('a' + b)`, e com frases sem tradução nos catálogos.
- Sem `other`, o plural é igual ao singular (por exemplo, `'{count} min'`).
- Em português só o 1 é singular (regra de Moçambique e Portugal; o `Intl` usa a do Brasil, em que o 0 também é).
- Na app: `import { t } from '@/lib/i18n'`. Datas e números com `formatDate(d, opts)` e `formatNumber(n, opts)`.
  Nomes de meses e dias com `monthNames(width)` e `weekdayNames(width)` (em português, os da casa; nos outros idiomas,
  os do `Intl`), nunca listas passadas por `t()`.
- Uma frase com partes com estilo (negrito, ligações, um selo no meio) não se parte em pedaços: vai inteira, com
  marcadores, e o componente `T` (`components/Trans.tsx`) troca cada marcador por um elemento. O tradutor protege os
  marcadores como as variáveis.

  ```tsx
  <Text style={st.p}><T text={t('Vais apagar a conta <b>@{username}</b>.', { username })} tags={{ b: (s) => <Text style={st.bold}>{s}</Text> }} /></Text>
  ```
- Os erros da API que a app tem de reconhecer levam um `code` (ex.: `repost_blocked`): compara-se o código, nunca a
  mensagem, que vem no idioma da pessoa.
- No site há ainda `tr` (o mesmo que `t`) e `tk('…')`, que só marca uma frase para a extração (tabelas de opções que
  depois passam por `tr(valor)`). Na app e na API não há `tk`: as tabelas passam a funções ou usam `t()` na hora.

### Idioma da pessoa

- Lista: `LANGS` em `packages/shared/src/i18n.ts` (`code`, `name` no próprio idioma, `locale`), com `pickLang(header)`
  para a API ler o `Accept-Language`. A app tem uma cópia gerada no topo de `apps/mobile/src/lib/i18n.ts` (a app não importa
  o `packages/shared`): juntar um idioma é acrescentá-lo em `packages/shared` e correr o script de tradução.
- A app guarda a escolha com a chave `txill_lang` (localStorage na web, `expo-secure-store` no nativo, que lê de forma
  síncrona). Sem escolha, usa o idioma do sistema (`navigator.languages` na web, `expo-localization` no nativo); senão `pt`.
- A app manda `Accept-Language: <code>` (`pt`, `en`) em todos os pedidos (`lib/api.ts`, `headersNow()`).
- A conta: a app manda **`PATCH /users/me { language: 'en' }`**, o endpoint que já usa para editar o perfil
  (`api.updateMe`). A equipa API acrescenta `language` a esse corpo, valida com `LANGS` e grava em
  `identity.users.language`. O `GET` do perfil próprio deve devolver `language`.
- Mudar o idioma: na web recarrega a página; no nativo troca o catálogo e a raiz (`app/_layout.tsx`) volta a montar-se com
  outra `key`. As constantes de módulo com `t()` só mudam ao reabrir a app, por isso o codemod passa-as a funções.
- O site (`apps/web`) mantém o comportamento que tinha: ids `pt-MZ` e `en`, guardado em `txill_lang`, e sem escolha fica
  em português.

### Extração e tradução

```sh
node scripts/i18n/extract.mjs          # só recolhe e mostra o que encontrou (e os t() com argumento não literal)
node scripts/i18n/translate.mjs        # extrai, traduz o que é novo ou mudou e escreve os catálogos
node scripts/i18n/translate.mjs --check   # não traduz: falha se faltar alguma tradução (para CI)
```

- LibreTranslate em `LT_URL` (por omissão `http://localhost:5000`); DeepL se houver `DEEPL_API_KEY`.
- O glossário (`scripts/i18n/glossary.json`) e as variáveis `{nome}` vão protegidos com marcadores `XT0X` (o LibreTranslate
  traduz `{nome}` para `{name}` e apaga `{count}` se não forem protegidos). Se um marcador se perder, tenta outra vez com
  outro formato; se falhar sempre, a frase fica por traduzir e o script diz qual é (corrige-se em `overrides`).
- No site, o ecrã do idioma também passou a «Idiomas», sem «Français em breve» nem «Traduções», e o `raw()` de
  `apps/web/src/lib/api.ts` manda o `Accept-Language`. O site antigo traduzia na hora as mensagens de erro da API com
  `tr(message)`; essas frases saíram do catálogo e passam a vir traduzidas da API.
- Os temas do explorar (`apps/api/src/common/topics.ts`, mostrados com `tr(t.label)` no site) e os nomes dos itens da
  geleira vêm do servidor: a equipa API traduz-os na resposta.
- Na primeira passagem, as traduções do antigo `apps/web/src/lib/i18n/en.ts` (feitas à mão) entraram como memória de
  tradução, exceto as que têm termos do glossário, que foram traduzidas de novo pela máquina para os manter.
