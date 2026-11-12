# Programa de artistas moçambicanos: licença e privacidade (rascunho)

Já integrado nos Termos de Uso (ponto 12, «Música dos artistas de Moçambique», com a licença palavra por palavra) e na Política de Privacidade, em `apps/mobile/src/lib/legalText.ts` (e no `Legal.tsx` do site antigo, gerado por `apps/web/scripts/make-legal.mjs`). O texto da licença que a app mostra, e que fica registado ao aceitar, está em `apps/api/src/artists/license.ts` (versão `2026-11-12`). **Se o texto mudar, muda também a versão**: a app envia a versão que a pessoa leu, e o servidor recusa uma versão antiga (409).

## Como funciona (resumo)

- **Pedido.** Numa conta normal, em Definições › Conta › «Sou artista» (`/artista`), a pessoa dá:
  - o nome artístico, os estilos e as ligações (redes e streaming, só https);
  - quem tem os direitos (o próprio artista ou uma editora, com o nome) e uma declaração;
  - opcionalmente, uma foto de prova (privada, apagada depois da decisão).
- **Aprovação.** A equipa decide no backoffice, em Música, nos separadores Pedidos de artista, Faixas e Direitos de autor (permissão `music.manage`, equipa Moderação). Tudo fica na auditoria (`artist.approve`, `artist.reject`, `artist.revoke`). Uma conta aprovada tem a etiqueta «Artista» no perfil. Não é o selo de verificado.
- **Faixas.** Só artistas aprovados as carregam:
  - um ficheiro MP3, M4A ou AAC, até 20 MB e entre 15 s e 15 min;
  - o título, a capa, os estilos e se é explícita;
  - o trecho, de 10 a 60 s (a app oferece 15, 30, 45 ou 60 s).

  O servidor confirma a duração e corta o trecho. O ficheiro original nunca é servido ao público. Antes de publicar, a pessoa aceita a licença, e fica guardado quem aceitou, a versão, o SHA-256 do texto e a data (`content.artist_track_licenses`). A faixa passa pela moderação antes de aparecer (`artist_track.approve`, `reject`, `remove` e `restore`).
- **Uso.** No seletor de música, a secção «Artistas de Moçambique» mostra as faixas, pela interface comum (`source: 'local'`, `artistUsername`). Só aparece em mimos e tchekas (publicações com um só vídeo), e o servidor recusa as faixas em notas e em publicações de foto ou texto. Menores de 18 anos não veem nem usam faixas explícitas. Cada uso mostra «♪ Título · Artista», com ligação ao perfil do artista.
- **Gerir.** Em «As minhas músicas» (`/artista/gerir`), o artista vê, para cada faixa, quantas vezes foi usada e por quantas pessoas. São só totais, nunca quem usou. Também pode retirar uma faixa: deixa de estar disponível para novos usos, e os mimos e as tchekas antigos continuam a tocá-la.
- **Direitos de autor.** Qualquer pessoa com conta pode denunciar uma faixa nos créditos da música, com o nome, o email, a relação com a obra e os detalhes. A faixa fica logo escondida: sai do seletor e deixa de tocar, também nos usos antigos. A equipa decide:
  - dá razão: a faixa sai de vez;
  - não dá razão: a faixa volta, se não houver outra denúncia aberta.

  Fica auditado (`artist_claim.uphold` e `artist_claim.dismiss`). O contacto para direitos de autor é suporte@txillapp.com, com o assunto «Direitos de autor». Está na Ajuda, em «Sou artista», nos créditos da música e na licença. Se houver um endereço próprio, muda-se em `RIGHTS_CONTACT` (API) e em `apps/mobile/src/lib/artists.ts`.

## Rascunho: Licença de uso de música no Txillapp (versão 2026-11-12)

> Para os Termos de Utilização, numa secção nova «Música dos artistas». O texto é o mesmo que a app mostra (`MUSIC_LICENSE_TEXT`).

1. **Quem dá a licença.** Ao publicar esta faixa, confirmas que és o titular dos direitos de autor e dos direitos conexos da gravação e da composição (ou que a editora ou os titulares te autorizaram a dar esta licença) e que a faixa não infringe direitos de ninguém.
2. **O que autorizas.** Dás ao Txillapp uma autorização não exclusiva, gratuita, mundial e revogável para novos usos, para:
   - (a) guardar a faixa, cortar o trecho que escolheste e disponibilizá-lo no seletor de música do Txillapp;
   - (b) deixar que as pessoas usem esse trecho nos seus mimos e tchekas dentro do Txillapp;
   - (c) incluir o trecho nas cópias desses mimos e tchekas que as pessoas guardam ou partilham com a assinatura do Txillapp;
   - (d) mostrar o título, o teu nome artístico, a capa e uma ligação ao teu perfil.
3. **Não exclusiva.** Continuas dono da tua música e podes licenciá-la a quem quiseres, noutros sítios e nas condições que quiseres.
4. **Gratuita.** Não há pagamento por esta licença nem pelos usos. Em troca, a faixa ganha destaque na secção «Artistas de Moçambique» e cada uso mostra «♪ Título · Artista» com ligação ao teu perfil.
5. **Retirar a faixa.** Podes retirar a faixa quando quiseres, em «As minhas músicas» (no teu perfil). A partir daí deixa de estar disponível para novos usos. Os mimos e as tchekas já publicados com ela, e as cópias já guardadas, continuam como estão.
6. **O que não autorizas.** Não autorizas a venda da faixa, o descarregamento da faixa completa, nem o uso fora do Txillapp (salvo nas cópias com assinatura referidas no ponto 2).
7. **Moderação e denúncias.** A equipa do Txillapp revê a faixa antes de aparecer e pode recusá-la ou tirá-la (por exemplo, por denúncia de direitos de autor, conteúdo ilegal ou contrário às regras). Uma faixa denunciada fica escondida enquanto a equipa analisa.
8. **Responsabilidade.** Se a informação do ponto 1 não for verdadeira, respondes perante os verdadeiros titulares e perante o Txillapp pelos prejuízos que daí resultem.
9. **Lei aplicável.** Esta licença rege-se pela lei de Moçambique, incluindo a Lei dos Direitos de Autor e Direitos Conexos, e faz parte dos Termos de Utilização do Txillapp.

### A juntar aos Termos (fora da licença)

- **Quem usa a música:** as faixas dos «Artistas de Moçambique» só podem ser usadas em mimos e tchekas dentro do Txillapp. Descarregar ou reutilizar o áudio fora do Txillapp não é permitido.
- **Denúncias de direitos de autor:**
  - qualquer pessoa pode denunciar uma faixa, nos créditos da música, ou por email para suporte@txillapp.com (assunto «Direitos de autor»);
  - a faixa fica escondida enquanto a equipa analisa;
  - denúncias falsas podem levar à suspensão da conta.
- **Estatuto de artista:** a etiqueta «Artista» é dada pela equipa e pode ser retirada (por exemplo, se a informação dada não for verdadeira). Nesse caso, as faixas deixam de estar disponíveis.

## O que muda na Política de Privacidade

**Dados novos que guardamos:**
- **Pedido de artista** (`content.artist_profiles`):
  - o nome artístico, os estilos e as ligações (redes e streaming);
  - quem tem os direitos (o próprio ou a editora, com o nome) e a declaração;
  - o estado do pedido e o motivo de uma recusa.

  A foto de prova é opcional e privada: só a equipa a vê, por ligação temporária, e é apagada logo a seguir à decisão.
- **Faixas** (`content.artist_tracks`):
  - o ficheiro original (privado, nunca é mostrado), o trecho cortado e a capa;
  - o título, os estilos e se é explícita;
  - o estado e as datas.
- **Aceitação da licença** (`content.artist_track_licenses`): quem aceitou, a versão, o resumo SHA-256 do texto e a data. É a prova da autorização.
- **Usos** (`content.artist_track_uses`): cada vez que alguém põe uma faixa num mimo ou numa tcheka, guardamos a faixa, a conta, se foi mimo ou tcheka, e a data. O artista só vê totais (quantas vezes e por quantas pessoas), nunca quem.
- **Denúncias de direitos de autor** (`content.artist_track_claims`): o nome de quem denuncia (ou da editora), o email de contacto, a relação com a obra, os detalhes e a conta que denunciou. O artista não vê quem denunciou. A equipa vê tudo, para poder contactar.

**O que é público:**
- a etiqueta «Artista», o nome artístico, os estilos e as ligações, no perfil;
- nas faixas aprovadas: o título, o nome artístico, a capa e o trecho, no seletor e nos mimos e tchekas que as usam.

**Finalidade e base:** dar destaque à música do artista e cumprir a licença que ele deu (execução do contrato). Também guardamos a prova da autorização e tratamos as denúncias de direitos de autor (interesse legítimo e obrigação legal).

**Exportar os dados** (Definições › Conta › «Descarregar os meus dados»). O ficheiro inclui:
- `artist`: o pedido de artista;
- `artistTracks`: as faixas, com os totais de usos;
- `musicLicenseAcceptances`: cada aceitação da licença, com a versão, o SHA-256 e a data;
- `copyrightReportsFiled`: as denúncias de direitos que a pessoa fez;
- `artistTracksUsed`: as faixas de artistas que a pessoa usou.

**Apagar a conta:**
- as faixas do artista deixam de estar disponíveis: saem do seletor e deixam de tocar, também nos usos antigos, e os ficheiros são apagados do armazenamento;
- o pedido de artista sai;
- os usos que a pessoa fez de faixas de outros saem dos totais;
- as denúncias de direitos que fez saem (a faixa volta a aparecer, se não houver outra aberta).

Fica só o registo de aceitação da licença (conta, versão, resumo do texto e data), ligado à conta anonimizada, como prova da autorização para os usos já feitos.

**Menores:** quem tem menos de 18 anos (ou não tem data de nascimento) não vê nem usa faixas marcadas como explícitas.
