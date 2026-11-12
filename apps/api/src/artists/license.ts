import { createHash } from 'crypto';

/**
 * Licença de uso de música no Txillapp: o texto que o artista (ou a editora) aceita antes de publicar cada faixa.
 * Guarda-se a versão, o resumo SHA-256 do texto exato, quem aceitou e quando (content.artist_track_licenses).
 * Mudar o texto obriga a mudar a versão (a app mostra sempre a versão atual e envia-a ao aceitar).
 * O rascunho para os Termos está em docs/musica-licenca.md.
 */
export const MUSIC_LICENSE_VERSION = '2026-11-12';

export const MUSIC_LICENSE_TITLE = 'Licença de uso de música no Txillapp';

export const MUSIC_LICENSE_TEXT = [
  '1. Quem dá a licença. Ao publicar esta faixa, confirmas que és o titular dos direitos de autor e dos direitos conexos da gravação e da composição (ou que a editora ou os titulares te autorizaram a dar esta licença) e que a faixa não infringe direitos de ninguém.',
  '2. O que autorizas. Dás à Txillapp uma autorização não exclusiva, gratuita, mundial e revogável para novos usos, para: (a) guardar a faixa, cortar o trecho que escolheste e disponibilizá-lo no seletor de música do Txillapp; (b) deixar que as pessoas usem esse trecho nos seus mimos e tchekas dentro do Txillapp; (c) incluir o trecho nas cópias desses mimos e tchekas que as pessoas guardam ou partilham com a assinatura do Txillapp; (d) mostrar o título, o teu nome artístico, a capa e uma ligação ao teu perfil.',
  '3. Não exclusiva. Continuas dono da tua música e podes licenciá-la a quem quiseres, noutros sítios e nas condições que quiseres.',
  '4. Gratuita. Não há pagamento por esta licença nem pelos usos. Em troca, a faixa ganha destaque na secção «Artistas de Moçambique» e cada uso mostra «♪ Título · Artista» com ligação ao teu perfil.',
  '5. Retirar a faixa. Podes retirar a faixa quando quiseres, no Gerir do teu perfil. A partir daí deixa de estar disponível para novos usos. Os mimos e as tchekas já publicados com ela, e as cópias já guardadas, continuam como estão.',
  '6. O que não autorizas. Não autorizas a venda da faixa, o descarregamento da faixa completa, nem o uso fora do Txillapp (salvo nas cópias com assinatura referidas no ponto 2).',
  '7. Moderação e denúncias. A equipa do Txillapp revê a faixa antes de aparecer e pode recusá-la ou tirá-la (por exemplo, por denúncia de direitos de autor, conteúdo ilegal ou contrário às regras). Uma faixa denunciada fica escondida enquanto a equipa analisa.',
  '8. Responsabilidade. Se a informação do ponto 1 não for verdadeira, respondes perante os verdadeiros titulares e perante a Txillapp pelos prejuízos que daí resultem.',
  '9. Lei aplicável. Esta licença rege-se pela lei de Moçambique, incluindo a Lei dos Direitos de Autor e Direitos Conexos, e faz parte dos Termos de Utilização do Txillapp.',
].join('\n\n');

export const MUSIC_LICENSE_SHA256 = createHash('sha256').update(MUSIC_LICENSE_TEXT).digest('hex');

export const musicLicense = () => ({ version: MUSIC_LICENSE_VERSION, title: MUSIC_LICENSE_TITLE, text: MUSIC_LICENSE_TEXT, sha256: MUSIC_LICENSE_SHA256 });
