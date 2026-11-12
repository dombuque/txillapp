/** Termos e Política de Privacidade: este é o texto de referência (o site principal é esta app). A cópia do site antigo,
 * apps/web/src/pages/Legal.tsx, gera-se a partir daqui. Marcação mínima: **negrito** e __itálico__.
 * Manter TERMS_UPDATED igual a TERMS_VERSION (packages/shared): mudar a versão pede nova aceitação. */
export type LegalBlock = { t: 'h2' | 'h3' | 'p'; x: string } | { t: 'ul'; x: string[] };
export const TERMS_UPDATED = '2026-11-13';
/** O que mudou nesta versão, em poucas linhas (aparece no aviso "Atualizámos os termos"). Atualizar sempre que TERMS_UPDATED muda. */
export const TERMS_CHANGES: string[] = [
  'Tolerância zero para conteúdo ofensivo e abuso. A nudez e o conteúdo sexual explícito são proibidos.',
  'Podes denunciar publicações, comentários, mimos, Zás, mensagens, perfis e locais. O que denuncias deixa de te aparecer.',
  'A moderação quer decidir cada denúncia em menos de 24 horas e pode remover o conteúdo e suspender a conta.',
  'Os Txills só servem dentro do Txillapp e nunca se levantam. Os presentes vão inteiros para quem os recebe.',
  'Nas apps da App Store e do Google Play não se compram Txills nem destaques do Bombar.',
  'Apagar a conta também em txillapp.com/apagar-conta, com uma ligação por email que vale 1 hora.',
  'Privacidade: o país, as visitas a perfis, os registos do servidor, as cópias de segurança e quem envia os emails e as notificações.',
];
export const TERMS: LegalBlock[][] = [
 [
  {
   "t": "h2",
   "x": "1. O que é o Txillapp"
  },
  {
   "t": "p",
   "x": "O Txillapp é uma rede social: publicas fotos, vídeos e textos, Tchekas e Mimos, segues pessoas e locais, trocas mensagens e fazes chamadas de voz e de vídeo. Inclui uma carteira de **Txills**, a moeda do Txillapp, que só serve dentro da app. Os Txills acumulam-se e servem para presentear quem segues, juntar no cofre de um TxillGroup e pagar nos locais que aceitam Txills. Os Txills não são dinheiro nem moeda com curso legal: não se trocam por dinheiro, nunca se levantam e não se transferem para fora do Txillapp (ver ponto 5)."
  }
 ],
 [
  {
   "t": "h2",
   "x": "2. Quem pode ter conta"
  },
  {
   "t": "ul",
   "x": [
    "Tens de ter pelo menos 15 anos. Pedimos a data de nascimento ao criar a conta.",
    "Ao criar a conta aceitas estes termos e a Política de Privacidade, incluindo as regras da malta e a tolerância zero do ponto 4. Quando os termos mudam de forma relevante, pedimos-te para aceitar de novo.",
    "Uma pessoa, uma conta. Dá informação verdadeira e mantém a tua senha em segredo.",
    "Podemos pedir-te para confirmar a idade e suspender contas que não cumpram este mínimo."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "3. O que publicas é teu, e é da tua responsabilidade"
  },
  {
   "t": "p",
   "x": "Continuas dono do que publicas. Ao publicar, dás-nos permissão para guardar e mostrar esse conteúdo às pessoas que escolheste (segundo as tuas definições de privacidade), só para o serviço funcionar. Só publiques o que tens direito de partilhar."
  }
 ],
 [
  {
   "t": "h2",
   "x": "4. Regras da malta: tolerância zero"
  },
  {
   "t": "p",
   "x": "O Txillapp tem **tolerância zero** para conteúdo ofensivo e para quem abusa de outras pessoas. Ao criar a conta, e sempre que aceitas estes termos, comprometes-te a cumprir estas regras. Valem para tudo o que fazes no Txillapp: publicações, Tchekas, mimos, notas, Zás, comentários, mensagens, chamadas, perfis, TxillGroups e páginas de locais. Quem as viola fica sem o conteúdo e pode ter a conta suspensa ou encerrada (ver ponto 12)."
  },
  {
   "t": "p",
   "x": "Não é permitido:"
  },
  {
   "t": "ul",
   "x": [
    "assediar, ameaçar, intimidar, humilhar ou perseguir pessoas;",
    "incitar ao ódio ou discriminar por raça, etnia, género, religião, orientação sexual, origem, deficiência ou outra característica;",
    "publicar ou enviar nudez ou conteúdo sexual explícito, de qualquer pessoa;",
    "qualquer conteúdo sexual ou de nudez que envolva menores, em caso nenhum;",
    "mostrar violência explícita, incentivar o suicídio ou a automutilação, ou publicar conteúdo ilegal;",
    "fazer-te passar por outra pessoa, ou enganar com contas falsas, spam ou burlas;",
    "partilhar dados privados de outras pessoas sem consentimento;",
    "tentar invadir o serviço, contornar a segurança ou recolher dados em massa."
   ]
  },
  {
   "t": "h3",
   "x": "Mensagens de quem não segues"
  },
  {
   "t": "p",
   "x": "Para proteger toda a gente de spam e assédio, as conversas com quem não se segue têm regras próprias:"
  },
  {
   "t": "ul",
   "x": [
    "Quando alguém que não segues te escreve, a conversa chega como **pedido de mensagem**. Não conta no número do ícone das mensagens até a aceitares. Podes **aceitar**, **recusar** (a pessoa não é avisada e deixas de receber avisos dela), **bloquear** ou **denunciar**.",
    "Quem escreve a alguém que não o segue vê o aviso «Esta pessoa não te segue» e pode enviar **até 3 mensagens** enquanto a outra pessoa não responder, aceitar ou seguir de volta. Depois disso, tem de esperar.",
    "Responder a um pedido, aceitá-lo ou seguir a pessoa liberta a conversa, sem limite.",
    "Cada pessoa escolhe quem lhe pode escrever em Definições (todos, só quem segue, ou ninguém). Contas bloqueadas não conseguem escrever-te.",
    "Pedidos de mensagem usados para assediar, enganar ou fazer spam podem levar à suspensão da conta (ver «Denúncias e moderação»)."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "5. Presentes, Txills e geleira"
  },
  {
   "t": "ul",
   "x": [
    "**Os Txills só servem dentro do Txillapp**: para presentear, para o cofre dos TxillGroups e para pagar nos locais que aceitam Txills. Não se trocam por dinheiro nem por outra coisa fora do Txillapp, e **nunca se levantam**: não há nem vai haver forma de converter Txills em dinheiro.",
    "**Boas-vindas**: ao criar a conta recebes 500 Txills na tua carteira.",
    "Só podes presentear quem segues e quem aceita presentes (cada pessoa escolhe isso nas Definições). O presente é sempre uma escolha tua e vai **inteiro** para quem o recebe: o Txillapp não fica com nenhuma parte. Um presente não desbloqueia conteúdo nem funcionalidades. O presente pode ficar **em silêncio**, **privado** ou ser **publicado** num post para toda a gente ver.",
    "A **geleira** é a tua vitrine de gostos (vibes, bebidas, comidas e sítios). Quem a vê escolhes tu: todos, só seguidores, só amigos próximos ou só tu. Quem a vê pode **brindá-la**; por omissão só tu vês quem brindou, mas podes torná-lo visível a quem vê a geleira nas definições dela (Editar perfil).",
    "As **bebidas com álcool** só aparecem a maiores de 18 anos; menores nunca as veem, juntam ou sugerem.",
    "A geleira tem um **nível**, calculado por pontos. As bebidas com álcool e as vibes de festa valem mais, as outras valem menos, um favorito dá mais um ponto, e os teus **Txills também contam** (1 ponto por cada 200, até 5). O nível tem nome em calão da malta (por exemplo, «Paulada garantida»).",
    "O título do nível mais alto **muda com a tua idade** (por exemplo, «Madala da paulada» só a partir dos 45 anos). A idade vem da data de nascimento que deste ao criar a conta; a data nunca é mostrada a ninguém.",
    "Como os Txills contam para o nível, quem vê a tua geleira pode ter uma ideia aproximada de quantos tens. Se não queres isso, põe a geleira como **só eu**: então o nível também não aparece a mais ninguém.",
    "**Convites**: tens um código e uma ligação (txillapp.com/c/ e o teu código) para trazer a malta. Só convidas com prémio com o email confirmado e a conta com mais de 3 dias. Nesse caso, quem entra com o teu código recebe 50 Txills logo ao criar a conta (se ainda não puderes convidar com prémio, recebe-os quando ficar ativa). Tu ganhas outros 50 quando a pessoa fica ativa (confirma o email e publica algo ou segue 3 pessoas) e continua por cá 7 dias. Recebes um aviso quando alguém entra com o teu convite. Há um máximo de 5 convites premiados por dia e 50 no total, e um teto mensal para toda a app. Contas repetidas, emails temporários e muitos registos da mesma rede não contam, e podemos anular Txills ganhos assim. Os Txills dos convites são Txills como os outros e não valem dinheiro.",
    "**Cartão e página do convite**: o cartão que partilhas é feito no teu aparelho, com o teu nome, a foto de perfil, o código e até 4 itens públicos da tua geleira (nunca bebidas com álcool se tiveres menos de 18 anos). A página do convite mostra o teu nome, o @, a foto e os itens públicos da geleira a quem a abrir, mesmo sem conta, e nunca bebidas com álcool. Os itens só aparecem se a conta for pública e a geleira estiver à vista de todos. Quando a ligação é colada no WhatsApp ou noutra rede, o nosso servidor faz um cartão parecido com o nome, a foto, o código e até 3 desses itens.",
    "Os Txills não se trocam por dinheiro (ver ponto 1). A pontuação da geleira serve só para mostrar o nível: não dá direito a prémios nem a dinheiro.",
    "**Comprar Txills**: nas apps da App Store e do Google Play não se compram Txills: ganham-se e usam-se. A recarga, quando estiver disponível, faz-se no site txillapp.com, com os métodos que lá aparecerem. Os Txills comprados entram na carteira e usam-se como os outros: também não se trocam por dinheiro nem se levantam. Um pedido que não for pago em 30 minutos expira; se o pagamento chegar depois, os Txills são entregues na mesma. Para qualquer problema com um pagamento, escreve para o suporte.",
    "**Cofre dos TxillGroups**: podes pôr Txills da tua carteira no cofre de um TxillGroup (de 10 a 100 000 de cada vez). O que lá metes passa a ser do grupo: se saíres, fica no cofre. Só os administradores do grupo pagam a locais com o cofre ou o devolvem. A devolução vai para quem contribuiu desde a última devolução, na proporção do que cada um pôs. Se o grupo acabar (sai a última pessoa), o cofre é devolvido sozinho.",
    "**Pagar nos locais**: só nos locais que aceitam Txills (a página mostra «Aceita Txills»). O pagamento é feito na hora e não se desfaz pela app, por isso confirma o local e o valor antes. Recebes um recibo, e quem gere o local vê quem pagou, quanto e a nota que deixaste. Para um problema com um pagamento, fala com o local ou com o suporte. O local recebe o valor inteiro, sem comissão. Os Txills que um local recebe ficam na carteira do local e também não se trocam por dinheiro nem se levantam."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "6. Selo de verificado"
  },
  {
   "t": "ul",
   "x": [
    "Há dois selos: o **azul**, para pessoas e negócios verificados, e o selo coral do Txillapp, só para **contas oficiais** da casa.",
    "Para pedir o selo a conta tem de cumprir requisitos: email confirmado, foto e bio, 30 dias ou mais, 3 publicações ou mais, 10 seguidores ou mais e nenhuma sanção recente.",
    "Depois envias o teu nome, uma prova de quem és (uma ligação ou explicação), uma foto de um documento de identificação e uma selfie. A moderação revê tudo à mão.",
    "Podes ser recusado, com o motivo. Só podes voltar a pedir passados 30 dias. Podemos retirar o selo a contas que violem estes termos, mudem de identidade ou fiquem inativas.",
    "O selo não dá privilégios nem é uma recomendação do Txillapp sobre o que a pessoa publica. No futuro poderão existir formas pagas de verificação; nunca sem avisar antes."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "7. Mimos, notas e conteúdo temporário"
  },
  {
   "t": "ul",
   "x": [
    "**Mimos e notas** duram 24 horas. As **notas** só as veem os teus seguidores e não se editam: apagas e publicas outra.",
    "**Música nas notas e nos posts**: só se usam faixas de licença aberta (Creative Commons: CC0, domínio público, CC BY e CC BY-SA), de um catálogo público (Openverse). O nome do autor e a licença aparecem junto à faixa. Quando procuras música, o texto que escreves é enviado a esse catálogo pelo nosso servidor; não enviamos mais nada sobre ti. Também podes gravar um clipe de áudio teu (até 30 segundos): fica guardado de forma privada e só é mostrado a quem vê a nota ou o post.",
    "**Música nos mimos**: tal como nas notas e nos posts, só faixas de licença aberta, com o autor e a licença à vista. Podes marcar faixas como **favoritas** para as teres à mão, e vês sugestões: as faixas que a malta do teu país mais usa e as que usaste ultimamente. As sugestões só contam usos, nunca mostram quem usou.",
    "**Stickers nos mimos**: podes pôr stickers por cima da foto, do vídeo ou do post partilhado. Quando guardas um mimo teu na galeria, a foto ou o vídeo leva os stickers e a assinatura do Txillapp com o teu @. Só podes guardar os teus próprios mimos.",
    "**Vídeos e música no feed**: os vídeos dos posts e das Tchekas começam sozinhos, sem som, quando estão à vista, e param quando saem; um toque liga o som. A música de um post toca enquanto o post está à vista e pode ser silenciada. Isto gasta dados móveis.",
    "**Zás**: são fotos tiradas na hora (sem galeria), com uma legenda curta, que duram 24 horas. Tu escolhes se vão para os **Amigos** (quem se segue contigo) ou só para os **Próximos**. Cada pessoa vê cada Zás **uma só vez**, e tu vês quem o viu e como reagiu. O botão tira e envia logo; podes apagar um Zás quando quiseres. Quem recebe pode, mesmo assim, fotografar o ecrã; a app não consegue impedir nem detetar capturas de ecrã. O «ver uma vez» é cumprido pela app e não é uma garantia absoluta.",
    "**Vídeos nas mensagens**: podes enviar vídeos (até 60 segundos e 100 MB), normais ou de visualização única. Há um limite de vídeos por hora para proteger o serviço, e os vídeos são verificados como as outras fotos e vídeos.",
    "**Visualização única**: fotos, vídeos, voz e mensagens que só se abrem uma vez; depois de abertas, o ficheiro é apagado do servidor em poucos minutos (até 5). Os ficheiros de mensagens apagadas são apagados na hora. Quem recebe pode, mesmo assim, fotografar o ecrã. Não confies nisto para o que não podes arriscar.",
    "**SuperTxill**: é a inteligência artificial do Txillapp, na barra de pesquisa (não é uma conta nem uma conversa com uma pessoa). É grátis, com um limite de respostas por dia. É uma IA e pode errar: confirma o que for importante e não a uses para decisões médicas, jurídicas ou financeiras. Não tem acesso às tuas outras conversas, nem às contas ou aos Txills de ninguém, e não faz ações na app. Não lhe peças nem lhe mandes conteúdo que as regras da app não permitem.",
    "**GIFs**: nas conversas a dois, nos TxillGroups e nos comentários, quando estão disponíveis, podes enviar GIFs do GIPHY, um serviço de outra empresa, no separador «GIF» do painel dos stickers (o painel mostra «Powered by GIPHY»). Os GIFs são do GIPHY e de quem os criou e estão sujeitos aos Termos do GIPHY. Enviar um GIF não te dá nenhum direito sobre ele. O Txillapp não cria nem controla o conteúdo do GIPHY e não é responsável por ele, mas um GIF que envias conta como o que escreves: valem as regras da malta (ponto 4) e pode ser denunciado como qualquer mensagem ou comentário. Quem tem menos de 18 anos, ou não tem data de nascimento na conta, só vê GIFs classificados pelo GIPHY para todas as idades («g»); os outros veem até «pg-13». A classificação é feita pelo GIPHY e pode falhar.",
    "**Reações e respostas**: podes reagir a mensagens (com um duplo toque, um brinde) e responder a uma mensagem em concreto. Quem enviou a mensagem vê a reação.",
    "**Brindes**: brindar uma publicação, uma Tcheka ou um comentário é grátis e avisa o autor (brindar o que é teu não avisa ninguém). Os brindes juntam-se num só aviso por publicação ou comentário, e no telemóvel chegam poucos avisos: no máximo um por publicação ou comentário a cada 30 minutos e 6 por dia. Cada pessoa só conta uma vez: tirar o brinde e voltar a pôr não avisa outra vez. Desligas estes avisos em Definições → «O que me pode notificar» → «Brindes e reações».",
    "**Colar uma imagem**: no site, podes colar ou arrastar uma imagem para a caixa de mensagem, nas conversas a dois e nos TxillGroups. Abre-se uma pré-visualização e a imagem só é enviada quando tocas em Enviar.",
    "**Vários aparelhos**: se tiveres a sessão iniciada em mais de um aparelho, as tuas conversas atualizam-se em todos ao mesmo tempo (o que envias, editas, apagas, lês ou aceitas).",
    "**Lista de conversas**: podes apagar uma conversa só do teu lado (do lado da outra pessoa fica tudo, e se te escreverem outra vez a conversa volta) e marcá-la como por ler.",
    "**Limpar conversa**: no menu «⋯» de uma conversa a dois ou de um TxillGroup, depois de confirmares. As mensagens que lá estão deixam de aparecer só para ti: os outros continuam a vê-las e nada é apagado do servidor por isso. A conversa fica na tua lista, vazia, até chegar uma mensagem nova. Não se desfaz.",
    "**Mensagens temporárias**: no menu «⋯» de uma conversa, em «Mensagens temporárias», escolhes **Desligadas**, **24 horas**, **7 dias** ou **90 dias**. Numa conversa a dois, qualquer um dos dois pode mudar, mas só quando já estão a conversar (não num pedido de mensagem por aceitar, nem enquanto a outra pessoa ainda não respondeu); num TxillGroup, só os administradores. A escolha vale só para as mensagens enviadas daí para a frente: as que já lá estavam ficam como estavam. Cada mudança deixa na conversa um aviso que todos veem, com o nome de quem mudou e a duração. Quando a duração acaba, a mensagem deixa logo de aparecer a todos e é apagada de vez dos servidores, com a foto, o vídeo ou a voz, em poucos minutos. Num TxillGroup, o mesmo vale para as sondagens (com os votos) e para as fotos e os vídeos que entram no álbum. Um presente enviado numa mensagem temporária não se desfaz: fica só o movimento na carteira. Quem recebe pode sempre guardar, copiar ou fotografar o ecrã antes de a mensagem desaparecer, por isso não confies nisto para o que não podes arriscar.",
    "**Apagar mensagens**: segura uma mensagem e escolhe «Apagar»; pedimos sempre confirmação. **Apagar para mim** serve para qualquer mensagem, tua ou de outra pessoa, e tira-a só da tua conversa: quem mais está na conversa continua a vê-la, e não se desfaz. **Apagar para todos** só existe nas tuas mensagens, sem limite de tempo: o conteúdo (também um GIF) é apagado do servidor e no lugar fica o aviso «Esta mensagem foi apagada» (tu vês «Apagaste esta mensagem»), que cada um pode tirar com «Apagar para mim». As mensagens apagadas antes de existir este aviso continuam a não aparecer. Apagar a mensagem de um presente não desfaz o presente. Quem recebeu pode ter lido, copiado ou fotografado o ecrã antes de apagares.",
    "**Editar mensagens**: podes corrigir uma mensagem de texto tua até 15 minutos depois de a enviares (não as de visualização única). Ao lado da hora aparece «editada», quem está na conversa passa a ver só a versão nova, e o Txillapp não guarda a anterior. Quem já a leu pode ter visto a versão anterior. O texto editado segue as mesmas regras do que envias (ponto 4). **Copiar** põe o texto de uma mensagem na área de transferência do teu aparelho.",
    "Apagar, editar e copiar funcionam da mesma forma nas conversas a dois e nos TxillGroups.",
    "**Enviar localização**: no «+» de uma conversa ou de um TxillGroup, em «Localização». Nada é enviado sem tocares em Enviar. Podes enviar a tua localização atual (vês antes a precisão), um ponto que escolhes no mapa, ou um sítio de «Sítios perto» ou da pesquisa. A mensagem leva o ponto exato e, num sítio, também o nome e a morada. Quem está na conversa vê esse ponto e pode abri-lo no Google Maps; num TxillGroup são todos os membros, também os que entrarem depois. Envia a tua posição só a quem confias, e nunca a de outra pessoa sem ela saber.",
    "**Localização em direto**: só nas conversas a dois, durante 15 minutos, 1 hora ou 8 horas, depois de confirmares. A posição atualiza-se mais ou menos de 20 em 20 segundos, só enquanto o Txillapp está aberto no teu aparelho: com a app em segundo plano ou fechada, não se atualiza. Para sozinha quando acaba o tempo, e podes pará-la quando quiseres com «Parar», na própria mensagem. No fim, a mensagem fica com a última posição enviada.",
    "Podes partilhar publicações e mimos com amigos no chat ou noutras apps. Quando alguém abre o link sem ter entrado, vê apenas uma pré-visualização das publicações **públicas**, sem poder brindar, comentar nem partilhar."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "8. Chamadas de voz e de vídeo"
  },
  {
   "t": "ul",
   "x": [
    "Podes fazer chamadas de voz e videochamadas a uma pessoa de cada vez. Para ligar, o teu email tem de estar confirmado.",
    "Quem te pode ligar escolhes tu em Definições → «Quem me pode ligar»: **todos**, **quem eu sigo**, **amigos mútuos** (quem segues e te segue de volta, a opção de origem) ou **ninguém**. Contas bloqueadas nunca te ligam.",
    "Uma chamada toca até 45 segundos. Se ninguém atender, fica como **chamada perdida** e recebes um aviso. Ao recusar, podes mandar uma mensagem rápida, que segue as regras normais das mensagens. Uma chamada termina sozinha ao fim de 6 horas.",
    "As chamadas ficam registadas na conversa entre as duas pessoas e no teu histórico de chamadas: com quem, se foi de voz ou de vídeo, quando e quanto durou.",
    "No histórico podes apagar uma chamada ou limpar tudo: sai só da tua lista, a outra pessoa mantém a dela. As chamadas com mais de 12 meses são apagadas sozinhas.",
    "No Android, enquanto estás numa chamada, aparece uma notificação com o nome da pessoa e «Chamada em curso» (ou «Videochamada em curso»), com o botão «Desligar»; tocar nela volta à chamada. É um serviço em primeiro plano: deixa o microfone (e a câmara, numa videochamada) continuar a funcionar quando sais da app a meio da chamada, e desaparece quando a chamada acaba.",
    "Em Definições → «Esconder o meu IP nas chamadas» (quando está disponível), a chamada passa sempre pelo servidor do Txillapp e a outra pessoa não fica a conhecer o teu endereço de rede. A chamada pode ficar um pouco mais lenta.",
    "O Txillapp **não grava** chamadas. Não graves nem divulgues uma chamada sem o consentimento da outra pessoa. As regras da malta (ponto 4) valem também nas chamadas, e podes bloquear ou denunciar quem as use para assediar."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "9. TxillGroups"
  },
  {
   "t": "ul",
   "x": [
    "Um **TxillGroup** é um grupo de conversa, até 50 pessoas, com nome, tipo (viagem, festa, fim de semana ou outro), descrição, capa, foto de perfil e um plano: o destino ou o local, as datas e quem vai (vou, talvez, não vou). Tem também sondagens, uma lista do que levar ou fazer, despesas, um álbum e um cofre de Txills.",
    "**Quem vê e quem entra**: um administrador escolhe um de três modos, e a mudança só fica feita depois de ele a confirmar.",
    "**Privado** (o modo de origem): o grupo não aparece a quem não está nele, nem no mapa. Só entra quem um administrador adiciona.",
    "**Privado, visível no mapa**: o grupo aparece em «À tua volta». Quem não está no grupo vê o nome, a capa, a foto de perfil, o tipo, a descrição, o plano (destino ou local e datas) e o número de membros, e pode pedir para entrar. Um administrador aceita ou recusa.",
    "**Público**: o grupo aparece em «À tua volta» com os mesmos dados e qualquer pessoa com conta entra logo, sem aprovação. Os administradores são avisados de quem entrou.",
    "Em todos os modos, a conversa, as sondagens, a lista, as despesas, o álbum, o cofre e a lista de membros só os veem os membros. Mas **quem entra, seja como for, vê o que já foi partilhado no grupo**: mensagens, fotos do álbum e despesas de antes de entrar. Os administradores podem mudar o modo quando quiserem, e o modo aparece nos detalhes do grupo. Num grupo visível no mapa ou público, escreve a contar que pessoas que ainda não conheces podem vir a ler.",
    "**O sítio no mapa**: para aparecer em «À tua volta», o grupo precisa de um sítio: um local do Txillapp que esteja no mapa ou um ponto marcado no mapa por um administrador. Um ponto marcado fica guardado só de forma aproximada (cerca de 1,5 km), nunca o ponto exato, com um nome do sítio se o administrador quiser. Quem vê o grupo no mapa vê essa zona e esse nome, nunca onde estão os membros. Quando as datas do plano já passaram, o grupo deixa de aparecer no mapa.",
    "**Pedidos para entrar**: os administradores veem quem pediu (nome, @ e foto) e quando. Podes cancelar o teu pedido enquanto espera. Se for aceite, recebes uma notificação; se for recusado, não és avisado. Se o grupo voltar a privado, os pedidos à espera são recusados.",
    "**Quem te pode adicionar**: só quem te pode enviar mensagens (Definições → «Quem pode enviar-me mensagens») ou quem já tem conversa contigo, e nunca quem está bloqueado.",
    "**Bloqueios**: se houver um bloqueio, em qualquer sentido, entre ti e alguém que está num grupo (ou quem o criou), esse grupo não te aparece de fora e não podes pedir nem entrar. Um pedido teu que estava à espera deixa de aparecer aos administradores. Bloquear não tira ninguém de um grupo onde já estejam os dois: se não quiseres estar com essa pessoa, podes sair.",
    "Os **administradores** adicionam e tiram pessoas, mudam o nome, a capa, a foto, a descrição e o modo, ligam ou desligam as mensagens temporárias (ponto 7), respondem aos pedidos e gerem o cofre (as regras do cofre estão no ponto 5). Podem tornar outro membro administrador (a pessoa é avisada) e retirar esse papel (sem aviso). O grupo tem sempre pelo menos um administrador: se o último sair, o membro mais antigo passa a administrador.",
    "Num grupo visível no mapa ou público, o nome, a capa, a foto e a descrição são vistos por quem não está no grupo. Os administradores respondem por eles, e valem as regras da malta (ponto 4).",
    "As **despesas** são só contas em meticais, para saber quem deve quanto a quem. O Txillapp não mexe nesse dinheiro nem garante pagamentos entre membros.",
    "As regras da malta (ponto 4) valem também nos TxillGroups. Podes denunciar mensagens e sair de um grupo quando quiseres."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "10. Locais"
  },
  {
   "t": "ul",
   "x": [
    "Quem tem um bar, restaurante, discoteca, café, hotel ou evento pode criar a página do local. Só cria a página de um sítio que é teu ou que estás autorizado a representar. Quem cria é o **dono**, aparece na página e responde por ela.",
    "Cada página nova fica **em análise** até a equipa do Txillapp a aprovar. Até lá só o dono e os gestores a veem: não aparece na pesquisa nem no mapa, não recebe pagamentos nem check-ins e não publica como o local. Se a equipa não aprovar, diz o motivo; depois de corrigires, a página volta a ser analisada. A equipa pode retirar uma página que deixe de cumprir estas regras.",
    "O dono pode convidar **gestores**: o **administrador** edita a página e gere os gestores; o **editor** publica como o local e anuncia eventos. O convite chega por notificação e só vale depois de aceite.",
    "As publicações feitas como o local aparecem só com o nome e o logótipo do local: quem vê não sabe que gestor publicou. O Txillapp guarda qual foi, e quem publica responde pelo que publica, como numa publicação sua.",
    "**Onde fica**: ao criar ou editar a página (e ao anunciar um evento, se o local ainda não tiver sítio), procuras o local pelo nome ou pela rua, ajustas o pino no mapa ou usas a tua localização. Marca o sítio verdadeiro do local: não ponhas o pino na casa de alguém nem noutro negócio. O ponto que gravas é público e aparece no mapa de «À tua volta», em «perto de mim» e na página do local, com «Como chegar».",
    "**Mostrar no mapa** vem ligado de origem e só o dono e os administradores o mudam. Desligado, o local, os seus eventos e as publicações feitas como o local deixam de aparecer no mapa e em «perto de mim», as publicações feitas como o local (também as antigas) deixam de mostrar a posição, e só quem gere a página vê o ponto. A página continua a aparecer na pesquisa pelo nome, com a morada que escreveste.",
    "**Eventos**: o dono e os gestores podem anunciar eventos (até um ano à frente, cada um com 14 dias no máximo). Aparecem na página do local e, se o local estiver no mapa, em «À tua volta». Qualquer pessoa pode marcar «Tenho interesse»: conta para o total e serve para te lembrares; ninguém é avisado.",
    "**Txills**: o dono e os administradores escolhem se o local aceita Txills. Os pagamentos recebidos (quem pagou, quanto e a nota) e o saldo do local só os veem o dono e os gestores.",
    "Seguir um local põe as publicações da página no teu feed. No painel do local, os gestores veem totais (seguidores, check-ins, brindes, comentários), nunca quem segue nem quem fez check-in.",
    "Se o dono eliminar a conta, a página passa para o administrador mais antigo; se não houver administrador, deixa de aparecer.",
    "O selo de um local é dado pela equipa. Podemos retirar páginas falsas, duplicadas ou que se façam passar por outro negócio."
   ]
  },
  {
   "t": "h3",
   "x": "Bombar: destaques patrocinados"
  },
  {
   "t": "ul",
   "x": [
    "O dono e os administradores de um local aprovado e que está no mapa podem **bombar** um evento do local ou uma publicação feita como o local, por 1, 3 ou 7 dias e num raio de 1 a 10 km à volta do local. Paga-se com os Txills da carteira do local, na hora; o preço aparece antes de confirmar.",
    "Nas apps da App Store e do Google Play não se cria nem se paga um destaque: aí vês os destaques do local, com o relatório, e podes pará-los. Um destaque novo cria-se no site txillapp.com.",
    "Um destaque é publicidade e mostra-se como tal: leva sempre a etiqueta **«Bombado · Patrocinado»** e o nome do local, no feed e no mapa de «À tua volta».",
    "Só aparece a quem tem 18 anos ou mais (com a data de nascimento na conta) e está dentro do raio, pela zona aproximada ou pela cidade escolhida. No feed, a mesma pessoa vê o mesmo destaque no máximo 3 vezes por dia, e há no máximo um destaque a cada 11 publicações, mais ou menos. Não aparece a quem gere o local, a quem tem um bloqueio com o dono, nem a quem escolheu **«Não mostrar destaques deste local»**.",
    "O local pode parar um destaque quando quiser: devolvemos à carteira do local os dias inteiros que ainda faltam (o dia que já começou conta como gasto), ou tudo, se ainda não tiver começado.",
    "O que se bomba segue estas regras (ponto 4) e as regras dos locais. A equipa do Txillapp pode suspender um destaque, com ou sem devolução, por exemplo se o conteúdo violar as regras, e pode repô-lo.",
    "O local vê só totais de cada destaque (vezes mostrado, pessoas, toques, «Tenho interesse» e check-ins), nunca quem viu ou tocou. Os Txills do local usados no Bombar não se trocam por dinheiro."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "11. À tua volta"
  },
  {
   "t": "ul",
   "x": [
    "Em Pesquisa → «À tua volta» vês num mapa os locais, os eventos, as publicações recentes (das últimas 48 horas) com sítio e os TxillGroups visíveis no mapa ou públicos, num raio que escolhes numa barra, de 1 a 50 km. Para isso a app pede a tua localização, ou escolhes uma cidade. Se a localização estiver autorizada, o mapa abre onde estás; uma cidade escolhida antes só fica se a localização não der. A posição é arredondada (cerca de 1 km) antes de sair do aparelho e não fica guardada; a posição exata só serve para centrar o mapa no teu ecrã e não sai do aparelho. Com o mapa aberto, a posição atualiza-se quando voltas à app ou ao mapa e de 5 em 5 minutos.",
    "Os locais aparecem no ponto que quem os gere marcou. Os locais que foram tirados do mapa (ver ponto 10), os seus eventos e as publicações feitas como eles não aparecem, nem os locais que ficaram sem dono porque a conta foi eliminada, nem os eventos deles. No filtro «Tudo» vês os eventos da semana; em «Eventos» escolhes o período. Os locais e os eventos bombados aparecem realçados e primeiro, com a etiqueta «Patrocinado» (ver «Bombar», no ponto 10).",
    "As publicações aparecem na posição do sítio arredondada (cerca de 1 km), ou no ponto do local se foram feitas como um local que está no mapa. As tuas próprias publicações não te aparecem aqui; os teus locais e os teus eventos sim.",
    "Um TxillGroup aparece no sítio do grupo (um local do Txillapp ou uma zona aproximada de cerca de 1,5 km, ver ponto 9), nunca na posição de quem está nele. Grupos onde está alguém com quem tens um bloqueio não te aparecem.",
    "**Aparecer no mapa** está desligado de origem e só é possível a partir dos 18 anos. Se o ligares, no mapa ou em Definições, escolhes quem te vê: **amigos mútuos** ou **quem eu sigo**. Só te veem adultos, e nunca quem está bloqueado.",
    "Quem te vê só vê a zona aproximada (uma quadrícula de cerca de 1,5 km) e há quanto tempo lá estavas, nunca o sítio exato. A zona só se atualiza enquanto tens o mapa aberto e só com a localização do telemóvel: com uma cidade escolhida não apareces. Sais do mapa ao fim de 3 horas, e logo que desligas a opção, escolhes uma cidade, terminas a sessão ou a app dá conta de que lhe tiraste a autorização de localização (com o mapa aberto ou quando o voltas a abrir).",
    "Não uses o mapa para seguir, vigiar ou ir atrás de ninguém (ver ponto 4)."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "12. Denúncias e moderação"
  },
  {
   "t": "p",
   "x": "O que é claramente uma ameaça, incentivo ao suicídio ou ódio contra um grupo de pessoas é recusado automaticamente antes de ser publicado ou enviado. As fotos e os vídeos são verificados automaticamente (nudez e conteúdo sexual) antes de ficarem visíveis."
  },
  {
   "t": "ul",
   "x": [
    "**O que podes denunciar**: publicações e Tchekas, comentários, mimos, comentários de mimos, Zás, mensagens (a dois e nos TxillGroups), perfis e páginas de locais. Usa o menu «⋯», segura a mensagem ou o comentário, ou toca na bandeira.",
    "Quem publicou não fica a saber quem o denunciou. O conteúdo que denuncias deixa logo de te aparecer: a publicação sai do teu feed, e o comentário, o mimo, o Zás ou a mensagem saem da tua vista. Para deixares de ver uma pessoa, bloqueia-a.",
    "**Prazo**: a moderação do Txillapp analisa cada denúncia com o objetivo de decidir em menos de 24 horas. Quando o conteúdo viola estes termos, removemo-lo, e podemos avisar, suspender ou encerrar a conta de quem o publicou.",
    "Quando denuncias uma mensagem, guardamos com a denúncia uma cópia do que ela dizia nesse momento, para a moderação a poder analisar mesmo que seja depois editada ou apagada; a cópia fica enquanto a denúncia estiver por decidir e é apagada 180 dias depois da decisão (ver «Quanto tempo guardamos» na Política de Privacidade). Num Zás denunciado, a moderação pode ver a foto enquanto a denúncia estiver aberta.",
    "Podes bloquear qualquer pessoa a qualquer momento, no perfil dela. Para denúncias urgentes, ou se precisares de ajuda, escreve para suporte@txillapp.com."
   ]
  },
  {
   "t": "p",
   "x": "Podemos remover publicações, Tchekas, mimos, comentários e mensagens que não cumpram estes termos; quando isso acontece, avisamos-te na app com o motivo. Se uma publicação, um mimo ou um comentário tiver sido removido por engano, podemos repô-lo: de um comentário removido guardamos uma cópia só para isso, que é apagada ao fim de 180 dias ou quando eliminas a conta."
  }
 ],
 [
  {
   "t": "h2",
   "x": "13. Terminar a conta"
  },
  {
   "t": "p",
   "x": "Podes eliminar a tua conta na app, em Definições → Conta → «Eliminar conta». Sem a app, vai a **txillapp.com/apagar-conta** e escreve o email da conta: mandamos para esse email uma ligação de confirmação, que vale 1 hora, e a conta só é apagada quando confirmas na página que ela abre. Escrever o email, por si só, não apaga nada. Isto não se desfaz. O teu perfil, as publicações (com o texto, as fotos e os vídeos), os mimos, os Zás, os comentários, as conversas, as chamadas, os seguidores e os outros dados pessoais são apagados ou anonimizados. Ficam, sem dados pessoais e ligados a «Conta eliminada», os movimentos de Txills, os pedidos de recarga e os registos dos convites, para as contas baterem certo e para prevenir fraude, e o registo de segurança de que a conta foi eliminada. As cópias de segurança cifradas desaparecem sozinhas ao fim de, no máximo, 400 dias. Os pormenores estão na Política de Privacidade, pontos 8 e 9. Sais dos teus TxillGroups (se eras o último administrador, o membro mais antigo passa a administrador, e o cofre de um grupo que fique vazio é devolvido), os teus pedidos para entrar em grupos são apagados, e as páginas de locais que criaste passam para o administrador mais antigo ou deixam de aparecer. Podemos suspender ou encerrar contas que violem estes termos."
  }
 ],
 [
  {
   "t": "h2",
   "x": "14. Sem garantias absolutas"
  },
  {
   "t": "p",
   "x": "Este serviço é fornecido «como está» e pode ter interrupções ou erros. Na medida permitida pela lei, não nos responsabilizamos por perdas indiretas resultantes do uso do serviço ou de conteúdo publicado por outras pessoas."
  }
 ],
 [
  {
   "t": "h2",
   "x": "15. Alterações"
  },
  {
   "t": "p",
   "x": "Se mudarmos estes termos de forma relevante, avisamos-te na app e pedimos-te para aceitar de novo."
  }
 ],
 [
  {
   "t": "h2",
   "x": "16. Lei aplicável e contacto"
  },
  {
   "t": "p",
   "x": "Estes termos regem-se pela lei da República de Moçambique. Para qualquer questão sobre o serviço, ajuda ou denúncias, escreve para suporte@txillapp.com."
  }
 ]
];
export const PRIVACY: LegalBlock[][] = [
 [
  {
   "t": "h2",
   "x": "1. Que dados recolhemos"
  },
  {
   "t": "ul",
   "x": [
    "**Conta:** nome, @utilizador, email, senha (guardada só em forma cifrada), data de nascimento (só para validar a idade, nunca é mostrada) e, se quiseres, género, cidade e site.",
    "**País:** o país de onde usas o Txillapp, que a proteção do site (Cloudflare) deduz do endereço de rede de cada pedido; o endereço em si não fica guardado. Guardamos o último país na tua conta e em cada publicação que fazes, para mostrar primeiro o que é do teu país (no feed e nas sugestões de música) e para estatísticas por país. Não aparece no teu perfil.",
    "**Visitas a perfis:** quando abres o perfil de alguém, registamos que o visitaste nesse dia (um registo por perfil e por dia). O dono do perfil só vê nas estatísticas o número de visitantes, nunca quem foi. Usamos também as tuas visitas para te sugerir primeiro essas pessoas quando mencionas alguém. Ficam até uma das duas contas ser eliminada.",
    "**Emails e lembretes:** se ainda não confirmaste o email, mandamos-te um lembrete por email (e um aviso no telemóvel, se tiveres as notificações ligadas) ao fim de 1, 3 e 7 dias. Depois paramos.",
    "**O que publicas:** posts, fotos, vídeos, Tchekas, mimos (com stickers e música), comentários, brindes, mensagens (também stickers e GIFs) e as pessoas que identificas ou mencionas.",
    "**Localização:** o __nome do sítio__ que escolheres e, quando o escolhes da lista, a posição __desse sítio__ arredondada a cerca de 1 km (duas casas decimais), para quem toca no nome ver as publicações feitas ali ou perto. É assim que a guardamos, e é só assim que aparece a quem vê a publicação, também nas publicações antigas. A exceção são as publicações feitas como um local que está no mapa: levam o ponto do local, que é público; se o local sair do mapa, deixam de mostrar posição a quem não gere a página. Nas publicações, nunca guardamos a tua posição exata (a localização que envias numa conversa é outra coisa: ver «Localização nas mensagens»). Para sugerir sítios e locais por perto, o nosso servidor envia a posição arredondada (cerca de 100 metros), ou o texto que procuras, a serviços do OpenStreetMap (Nominatim, Overpass e Photon), sem dizer quem és. Contas de menores de 18 anos não guardam a posição do sítio nem aparecem nas publicações por sítio. Podes tirar o local de uma publicação quando quiseres. Quando escolhes uma foto, a app pode ler no teu aparelho onde ela foi tirada (o GPS da foto), só para te sugerir o sítio; essas coordenadas não são enviadas tal como estão. Os mapas usam os mosaicos do OpenStreetMap. Todos os mapas da app (incluindo o mapa pequeno de uma localização partilhada numa conversa) descarregam-nos do servidor do Txillapp, que os vai buscar ao OpenStreetMap sem dizer quem és: o teu aparelho não fala diretamente com o OpenStreetMap.",
    "**Onde fica um local:** ao criar ou editar um local, ou ao anunciar um evento, o campo «Onde fica?» procura o sítio pelo nome ou pela rua. O nosso servidor envia o texto que escreves ao Photon (OpenStreetMap), sem dizer quem és; se a app já tiver autorização para a localização, junta a tua posição arredondada (cerca de 1 km), só para pôr primeiro os sítios mais perto. Quando escolhes um sítio, arrastas o pino ou tocas em «Usar a minha localização», o nosso servidor pede a morada desse ponto ao Nominatim (OpenStreetMap), com a posição arredondada a cerca de 11 metros; essa posição não é guardada nem escrita nos registos. «Usar a minha localização» explica para que serve antes de pedir a autorização e só serve para pôr o pino. Quando gravas, guardamos o ponto do local tal como o marcaste: se usaste a tua localização, é onde estavas nesse momento. Esse ponto é público (ver «Locais», em baixo).",
    "**À tua volta:** para mostrar o que há perto (num raio que escolhes, de 1 a 50 km), a app envia a tua posição arredondada (cerca de 1 km). Se autorizaste a localização, usa a do telemóvel; uma cidade escolhida antes só é usada se a localização não der. A posição exata fica no teu aparelho, só para centrar o mapa no teu ecrã. A posição arredondada só serve para esse pedido: não é guardada nem escrita nos registos. Se ligares **Aparecer no mapa** (só a partir dos 18 anos; de origem está desligado), guardamos a tua escolha (amigos mútuos ou quem eu sigo) e, enquanto tens o mapa aberto com a localização do telemóvel (não com uma cidade escolhida), só a quadrícula de cerca de 1,5 km onde estás e a hora. A posição atualiza-se quando voltas à app ou ao mapa e de 5 em 5 minutos com o mapa aberto. Essa presença é apagada ao fim de 3 horas, e logo que desligas a opção, escolhes uma cidade, terminas a sessão ou a app dá conta de que lhe tiraste a autorização de localização (com o mapa aberto ou quando o voltas a abrir). No mapa aparecem também publicações de outras pessoas das últimas 48 horas que têm a posição do sítio (só as que já podias ver), na posição arredondada descrita em cima; as tuas não te aparecem.",
    "**Check-ins:** ao ler o QR de um local, registamos o check-in só para contar quantas pessoas lá estiveram. O número é público; quem fez check-in não é mostrado a ninguém. Cada pessoa faz no máximo um check-in por local de 6 em 6 horas.",
    "**Segurança:** as sessões iniciadas e os registos de ações sensíveis. Para cada sessão iniciada guardamos o tipo de aparelho e de browser (o «user agent»), se usas a app instalada e a versão dela, quando entraste e a última atividade; com a sessão não guardamos o endereço IP. Vês e terminas estas sessões em Definições → Segurança → «Os teus aparelhos», e a equipa de suporte do Txillapp pode vê-las e terminá-las para proteger a tua conta (cada consulta fica registada).",
    "**Registos do servidor:** como qualquer site, o nosso servidor web regista cada pedido que lhe chega: o endereço IP, a hora, o endereço pedido, a resposta, o tempo que levou e a página de onde vieste. Não levam a tua conta e servem só para a segurança e para resolver falhas. Guardamos só os mais recentes (até 50 MB): os mais antigos são apagados sozinhos à medida que entram novos. A proteção do site (Cloudflare) também vê o endereço IP de cada pedido.",
    "**Carteira:** o teu saldo de Txills e os movimentos (bónus de boas-vindas, prémios de convites, recargas, presentes enviados e recebidos, o que puseste em cofres de TxillGroups, devoluções e pagamentos a locais, com a nota que deixaste).",
    "**TxillGroups:** o nome, o tipo, a descrição, a capa, a foto de perfil, o modo (privado, visível no mapa ou público) e o plano do grupo, quem é membro e quem administra, quem vai (vou, talvez, não vou), as sondagens e os votos, a lista do que levar ou fazer, as despesas e a parte de cada um, as fotos do álbum e os movimentos do cofre (quem pôs quanto, pagamentos e devoluções). Para o grupo aparecer no mapa, guardamos o sítio do grupo: um local do Txillapp que esteja no mapa, ou um ponto marcado por um administrador, guardado só de forma aproximada (cerca de 1,5 km) e nunca o ponto exato, com o nome do sítio se o administrador o escrever. Se pedires para entrar num grupo, guardamos o pedido e a hora. O que fica visível a quem não está no grupo está no ponto 3.",
    "**Lista de conversas:** se apagares uma conversa ou a marcares como por ler, guardamos isso só do teu lado. Apagar tira as mensagens da tua lista; do lado da outra pessoa ficam. Com «Limpar conversa» (a dois ou num TxillGroup), guardamos até que mensagem limpaste e que a conversa deve continuar na tua lista, vazia. Não apagamos nenhuma mensagem por isso: os outros continuam a vê-las. Os teus «Apagar para mim» nessas mensagens deixam de ser precisos e são apagados. Se tiveres a sessão iniciada em vários aparelhos, o nosso servidor avisa os outros aparelhos da mesma conta, em tempo real, do que mudaste numa conversa, para ficarem todos iguais; esse aviso não fica guardado.",
    "**Pagamentos:** nas apps da App Store e do Google Play não há recarga. Onde a recarga existir e a usares, guardamos o pedido (pacote, valor, método de pagamento, estado e datas) e só os últimos 3 dígitos do teu telemóvel. Os dados completos do pagamento ficam com o fornecedor (M-Pesa, e-Mola ou cartão) e nós não os guardamos.",
    "**Contactos:** só se usares «Amigos nos contactos». Os contactos ficam no teu telemóvel; enviamos apenas um resumo cifrado (SHA-256) dos emails, só para ver quem já está no Txillapp, e não guardamos nem os resumos nem os contactos. Podes não ser encontrado por esta via em Definições → «Deixar que me encontrem pelos contactos».",
    "**Geleira:** os gostos que juntas (vibes, bebidas, comidas e sítios), com notas e favoritos, e o nível calculado a partir deles e do teu saldo de Txills.",
    "**Presença:** se estás online ou a escrever um comentário (só enquanto a app está aberta) e a hora da última vez que estiveste online.",
    "**Verificação:** se pedires o selo, o teu nome, a prova que indicares, o tipo de documento, a foto do documento (frente e, quando tem, verso), uma foto da tua cara tirada com a câmara e uma selfie com o documento (apagados logo que há decisão).",
    "**Localização nas mensagens:** só quando tocas em Enviar. Guardamos na mensagem o ponto que escolheste, com uma precisão de cerca de 1 metro (a tua posição atual, um ponto do mapa ou o ponto de um sítio) e, num sítio ou num ponto do mapa, o nome e a morada. A precisão do GPS que vês antes de enviar fica no teu aparelho. Quem está na conversa vê o ponto exato (numa partilha em direto, só enquanto ela dura); num TxillGroup, todos os membros, também os que entrarem depois. Enquanto a folha «Enviar localização» está aberta, a tua posição só aparece no teu ecrã, com uma exceção: para mostrar «Sítios perto», a app envia ao nosso servidor a tua posição arredondada (cerca de 100 metros); ao arrastar o mapa, envia o ponto do pino (arredondado a cerca de 11 metros) para saber a morada; e na pesquisa, o texto e a posição arredondada (cerca de 100 metros). O nosso servidor pergunta isso ao OpenStreetMap (Nominatim, Overpass e Photon), sem dizer quem és, e não guarda essas posições. Na **localização em direto** (só nas conversas a dois), a app envia a posição de cerca de 20 em 20 segundos, só com a app aberta e durante o tempo que escolheste: cada posição nova substitui a anterior na mensagem. Quando a partilha acaba, a mensagem passa a mostrar só «Partilha em direto terminada», sem mapa nem posição, a toda a gente. Se tocares em «Parar», apagamos também a última posição. Se o tempo acabar, a última posição fica guardada, mas não é mostrada a ninguém: só aparece na exportação dos dados de quem a enviou. Nunca pedimos a localização em segundo plano.",
    "**Apagar e editar mensagens:** com «Apagar para mim», guardamos que escondeste aquela mensagem e quando, só para não ta mostrar; a mensagem continua guardada para os outros da conversa. Com «Apagar para todos», apagamos o texto, a foto, o vídeo, a voz, o GIF, o sítio e a partilha em direto (os ficheiros saem do armazenamento na hora), e também o tipo de mensagem, a duração de uma voz ou de um vídeo, o valor de um presente, as reações, quem a viu, a hora da edição e a mensagem que citava. Numa sondagem de um TxillGroup, saem também a sondagem, as opções e os votos. Fica só o aviso no lugar dela, com quem a enviou, quando e quando foi apagada; num presente, fica também a ligação ao movimento de Txills, que continua na carteira (apagar a mensagem não desfaz o presente). Quando a moderação remove uma mensagem, apaga o mesmo, incluindo o ponto e o sítio, e a mensagem deixa de aparecer sem deixar aviso. Ao editar, guardamos o texto novo e a hora da edição: o texto anterior é substituído e não fica guardado. Se a mensagem tiver sido denunciada antes, a cópia guardada com a denúncia segue o prazo do ponto 8.",
    "**Mensagens temporárias:** se as ligares numa conversa a dois ou num TxillGroup, guardamos na conversa a duração escolhida (24 horas, 7 dias ou 90 dias) e, em cada mensagem enviada daí para a frente, a hora em que expira. Guardamos também o aviso de cada mudança, com o primeiro nome de quem mudou e a duração; esse aviso não expira e fica com a conversa. A partir dessa hora a mensagem já não é mostrada a ninguém e o ficheiro deixa de ser servido. A nossa limpeza corre de 5 em 5 minutos e apaga a mensagem de vez dos servidores: o texto, a foto, o vídeo, a voz, o GIF, o sítio, as reações, quem a viu e, num TxillGroup, a sondagem e os votos. Os ficheiros saem do armazenamento pouco depois, normalmente em menos de 15 minutos. Num presente, fica só a ligação ao movimento de Txills (quem enviou e quando), sem conteúdo e sem aparecer na conversa; o movimento continua na carteira. Se a mensagem tiver sido denunciada antes de expirar, a cópia guardada com a denúncia segue o prazo do ponto 8. O que quem recebeu guardou, copiou ou fotografou fica no aparelho dessa pessoa, fora do nosso alcance.",
    "**Utilização:** se deixares ligado «Ajudar a melhorar o Txillapp» (Definições → Privacidade → «Contactos e dados»; vem ligado de origem), a app envia-nos estatísticas de uso só nossas, sem terceiros: as aberturas da app, os ecrãs vistos (só o nome do ecrã, nunca de quem é), o tempo de arranque, os erros (uma mensagem curta, limpa de emails, @, ligações, números e outros dados pessoais) e as ações que fazes (publicar, abrir uma publicação, comentar, brindar, seguir, repostar, partilhar, enviar mensagens, pesquisar, ver e criar mimos, ligar as notificações), com a plataforma e a versão da app. Nunca o conteúdo (o que escreves, pesquisas ou envias) nem a posição. As estatísticas ficam ligadas à tua conta, para sabermos quantas pessoas usam a app e voltam. Cada visita tem um identificador aleatório, que muda ao fim de 30 minutos sem uso. Sem internet, até 200 registos ficam no aparelho e são enviados depois (no máximo 3 dias; os mais antigos são deitados fora). Com a opção desligada, ou com «não rastrear» ligado no browser, não enviamos nada e o que estava à espera no aparelho é apagado. As estatísticas que já nos chegaram ficam guardadas até eliminares a conta: desligar a opção trava os envios novos, mas não apaga as que já cá estão. Apagar a conta apaga estes dados. Também guardamos o que já viste no feed, para não repetir sempre o mesmo, e as preferências com que afinas o Explorar e as Tchekas (temas, contas de que queres ver mais ou menos, «interessa-me» ou «não me interessa»); também estes ficam até eliminares a conta.",
    "**Pesquisas:** para sabermos o que a malta procura e o que falta no Txillapp, contamos quantas vezes cada termo é pesquisado (em minúsculas e sem acentos), por dia e por país, e quantas vezes não deu resultados. Esse contador não guarda quem pesquisou, nem a hora, e cada pessoa conta no máximo uma vez por termo e por dia. Não contamos pesquisas de menores de 18 anos nem de quem desligou «Ajudar a melhorar o Txillapp», nem textos que pareçam emails, ligações ou números de telefone. Os contadores são apagados ao fim de 90 dias.",
    "**Zás:** a foto, a legenda, para quem a enviaste (Amigos ou Próximos), a hora, quem a viu e como reagiu. Uma miniatura minúscula e desfocada (24×32 pontos) serve só para o atalho. Duram 24 horas. Se alguém denunciar um Zás, a moderação pode ver a foto enquanto a denúncia estiver aberta.",
    "**Notificações:** se as ativares, guardamos o identificador do teu aparelho para as enviar. No Android passam pelo Firebase Cloud Messaging, da Google; no iPhone, pelo serviço de notificações da Apple (APNs); no browser, pelo serviço de notificações do próprio browser. Estes serviços recebem o identificador do aparelho e o texto do aviso. O texto nunca mostra o conteúdo das mensagens nem qual foi a reação. Quando alguém te liga, o aviso mostra o nome de quem liga e se é chamada de voz ou de vídeo. Podes desligá-las quando quiseres, todas ou por tipo em Definições → «O que me pode notificar» (as chamadas a tocar não se desligam aí). Se as notificações estiverem desligadas no aparelho, a app lembra-te de tempos a tempos, no máximo uma vez por dia e com pausas cada vez maiores (3, 7, 14 e 30 dias) depois de cada «Agora não», e mostra uma faixa em Definições → «Notificações». As horas destes lembretes ficam guardadas só no teu aparelho.",
    "**Reações a mensagens:** a reação que deixas e quem a deixou, visíveis para quem está na conversa.",
    "**SuperTxill:** as perguntas que fazes ao SuperTxill (e só essas) são enviadas ao nosso fornecedor de inteligência artificial, a Anthropic, para gerar a resposta. Ficam guardadas na tua conta, só para ti, e podes apagá-las no próprio SuperTxill. Contam para o limite diário. O SuperTxill não lê as tuas conversas nem os dados de ninguém.",
    "**Convites:** o teu código, quem te convidou, quem convidaste e em que estado está cada convite (registado, ativo, premiado ou sem prémio, e porquê). Guardamos também uma impressão da rede de quem se regista com um convite (um resumo cifrado do endereço IP, nunca o endereço em si), só para detetar registos em massa: serve para ver se o mesmo convite teve vários registos da mesma rede nas últimas 24 horas. Fica guardada com o registo do convite e é apagada quando a pessoa que entrou elimina a conta. O cartão do convite é desenhado no teu aparelho e só sai dele se o partilhares. A página pública do convite e o cartão que o WhatsApp e outras redes mostram ao colar a ligação levam o teu nome, a foto de perfil, o código e alguns itens públicos da geleira (o nome e o @ na página), nunca bebidas com álcool. Quem convida recebe um aviso com o nome de quem entrou.",
    "**Brindes:** guardamos quem brindou cada publicação, Tcheka ou comentário. Para os avisos, guardamos também quem já foi contado em cada aviso de brindes (para não avisar duas vezes, mesmo que o brinde seja tirado e posto de novo) e as horas dos avisos enviados ao telemóvel, só para o limite de avisos; estas horas vão sendo apagadas ao fim de 2 dias. Tudo isto é apagado com a conta.",
    "**Bombar (destaques patrocinados):** para escolher que destaques te mostrar no feed, a app envia a zona aproximada (cerca de 1 km) que já usas em «À tua volta», ou o centro da cidade que escolheste. Essa posição só serve para esse pedido e não é guardada. A escolha usa também a tua idade (só a partir dos 18 anos, pela data de nascimento) e mais nada do teu perfil, das tuas conversas ou dos teus gostos. Registamos cada vez que um destaque te foi mostrado e cada toque (que destaque, quando, e se foi no feed ou no mapa), para o limite de 3 vezes por dia e para os totais do local, que também contam os check-ins de quem viu o destaque. O local só vê totais (vezes mostrado, pessoas, toques, «Tenho interesse» e check-ins), nunca quem viu. Se tocares em «Não mostrar destaques deste local», guardamos essa escolha. Quem bomba um local fica registado na campanha, com o pacote, o raio, o preço, as datas e as devoluções.",
    "**Fotos e vídeos:** são verificados automaticamente no nosso servidor (nudez e conteúdo sexual) antes de ficarem visíveis. Nada é enviado a terceiros. Antes de guardarmos uma foto, o servidor tira-lhe os metadados escondidos (EXIF), como a localização GPS, o modelo do aparelho e a data, para não chegarem a quem a vê.",
    "**Câmara e editor:** a câmara só está ligada enquanto a tens aberta. Os filtros e ajustes (luz, cor, nitidez e outros) são aplicados no teu aparelho; só é enviada a foto ou o vídeo final que escolhes publicar ou enviar. Guardar na galeria só acontece quando tocas em Guardar.",
    "**Fotos e vídeos do telemóvel:** no Android, escolhes as fotos e os vídeos pelo seletor do próprio sistema: a app recebe só os que escolhes e não lê a tua galeria. No iPhone, a galeria do Txillapp mostra as fotos a que lhe deste acesso nas definições do iPhone. Em qualquer caso, só sai do aparelho o que escolhes publicar ou enviar.",
    "**Chamadas:** guardamos o registo de cada chamada: quem ligou a quem, se foi de voz ou de vídeo, como acabou (atendida, perdida, recusada, cancelada) e quando começou e acabou. O som e a imagem vão diretamente de um aparelho para o outro, cifrados (WebRTC), e nunca passam pelos nossos servidores nem são gravados. Para os dois aparelhos se encontrarem, a app usa servidores STUN da Google, que veem o endereço de rede do teu aparelho. Quando a ligação direta não é possível, ou se ligares «Esconder o meu IP nas chamadas», a chamada passa pelo servidor de retransmissão (TURN) do Txillapp, que só encaminha os dados cifrados e não os grava; com essa opção, a outra pessoa não fica a conhecer o teu endereço de rede. Numa ligação direta, o aparelho da outra pessoa fica a conhecer o teu endereço de rede, como em qualquer chamada pela internet. Guardamos também essa escolha. No Android, durante a chamada, a notificação «Chamada em curso» mantém o microfone e a câmara a funcionar com a app fora do ecrã; não grava nada e desaparece quando a chamada acaba. Podes apagar chamadas do teu histórico (o registo desaparece de vez quando as duas pessoas o apagam), e as chamadas com mais de 12 meses são apagadas sozinhas.",
    "**Locais:** se criares ou gerires a página de um local, guardamos o teu papel (dono, administrador ou editor) e quem te convidou, e qual gestor fez cada publicação do local (quem vê a publicação só vê o local, nunca o gestor). Os dados da página (nome, morada, horário, telefone, WhatsApp, site, fotos), o ponto no mapa, os eventos anunciados e se aceita Txills são públicos, e o dono aparece na página. O ponto aparece no mapa de «À tua volta», em «perto de mim» e num mapa pequeno com «Como chegar» na página; se o dono ou um administrador desligar «Mostrar no mapa», fica guardado mas só quem gere a página o vê, o local, os seus eventos e as publicações feitas como ele saem do mapa, e as publicações feitas como o local, também as antigas, deixam de mostrar a posição. Guardamos também os locais que segues e os eventos em que marcaste «Tenho interesse»; os gestores só veem os totais. Se pagares a um local com Txills, o dono e os gestores veem o teu nome, o @, o valor, a nota e a hora.",
    "**Música:** as faixas que marcas como favoritas. As pesquisas de música são feitas pelo nosso servidor no Openverse. A faixa toca diretamente do sítio onde está alojada (por exemplo, o Free Music Archive, o ccMixter, o Pixabay ou o Internet Archive), que vê o endereço de rede do teu aparelho, como qualquer site.",
    "**GIFs:** quando procuras GIFs, a pesquisa passa pelo nosso servidor. Ao GIPHY vai só o texto que escreves, a página de resultados, a classificação («g» ou «pg-13», conforme a tua idade) e a língua: nunca a tua conta, o teu endereço de rede ou um identificador teu. Quando envias um GIF numa conversa, num TxillGroup ou num comentário, guardamos só a referência a ele (o endereço da imagem no GIPHY, as medidas e, se tiver, o título), nunca a imagem. As imagens, tanto na grelha da pesquisa como nas conversas e nos comentários, são carregadas pelo aparelho diretamente dos servidores do GIPHY (media.giphy.com e endereços parecidos), que veem o endereço de rede de quem vê o GIF, como qualquer site. Isto vale também para quem recebe o GIF ou lê o comentário. O que o GIPHY faz com esses dados segue a política de privacidade do GIPHY."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "2. Para que usamos"
  },
  {
   "t": "p",
   "x": "Para fazer o serviço funcionar, mostrar o teu conteúdo a quem escolheste, manter a conta segura, prevenir abuso e analisar denúncias, e, se o deixares ligado, para perceber como a app é usada e corrigir erros. Mostramos também destaques patrocinados de locais (Bombar), escolhidos só pela tua zona aproximada ou cidade e pela idade, sempre com a etiqueta «Bombado · Patrocinado». Não vendemos os teus dados nem os usamos para fazer um perfil de publicidade."
  }
 ],
 [
  {
   "t": "h2",
   "x": "3. Quem vê o quê"
  },
  {
   "t": "p",
   "x": "Tu controlas: perfil público ou privado, quem comenta, menciona, presenteia, te envia mensagens ou te liga (por omissão, só amigos mútuos), quem vê os teus seguidores e quem repostou, brindou ou presenteou. O género escolhe-se ao criar a conta e **não se altera**; só aparece no perfil se tu quiseres. As mensagens diretas e o registo das chamadas só são visíveis para as duas pessoas da conversa. Quem está numa conversa vê se as mensagens temporárias estão ligadas e os avisos de quem as mudou. Uma localização que envias numa conversa mostra o ponto exato a quem está nela. O que se passa num **TxillGroup** (conversa, sondagens, lista, álbum, despesas, cofre e lista de membros) só o veem os membros, e quem entra num grupo vê também o que lá foi partilhado antes de entrar. Se um administrador puser o grupo visível no mapa ou público, quem tem conta vê de fora o nome, a capa, a foto de perfil, o tipo, a descrição, o plano (destino ou local e datas), o sítio do grupo no mapa e o número de membros, nunca quem são. Quando pedes para entrar, os administradores do grupo veem o teu nome, o @ e a foto. Quem tem um bloqueio contigo ou com qualquer membro não vê o grupo de fora. Um pagamento a um local vês tu e quem gere o local. Quem gere um local que bomba um destaque só vê totais, nunca quem o viu ou tocou. A página do teu convite mostra a quem a abrir, mesmo sem conta, o teu nome, o @, a foto e os itens públicos da geleira (nunca bebidas com álcool). O ponto de um local no mapa é público, a não ser que quem o gere desligue «Mostrar no mapa». No mapa **À tua volta** só apareces se o ligares, só para quem escolheste e só pela zona aproximada. As **notas** só as veem os teus seguidores. A **geleira** e o seu nível veem-nos só quem escolheres. Quem não tem conta e abre um link de uma publicação **pública** vê só uma pré-visualização dela (sem comentários nem ações); publicações de contas privadas, apagadas ou de quem te bloqueou nunca aparecem. Redes como o WhatsApp podem mostrar um cartão com o nome, o texto e a foto de uma publicação pública quando alguém cola o link."
  }
 ],
 [
  {
   "t": "h2",
   "x": "4. Presença online e a escrever"
  },
  {
   "t": "p",
   "x": "O Txillapp mostra quando uma pessoa está **online** (com a app aberta) e, nos comentários de um post, quando alguém está **a escrever**. No chat mostra também «Visto há…». Isto só vale entre quem mostra a presença: se desligares «Mostrar quando estou online» nas Definições, ninguém te vê online ou a escrever, e tu também deixas de ver os outros. Quem tem a conta bloqueada nunca te vê. A presença só existe enquanto a app está aberta; só guardamos a hora da última vez que estiveste online."
  }
 ],
 [
  {
   "t": "h2",
   "x": "5. Geleira e pontuação"
  },
  {
   "t": "p",
   "x": "Guardamos os gostos que juntas à tua geleira, as notas e os favoritos. Com eles, e com o teu saldo de Txills, calculamos o **nível** da geleira. A data de nascimento é usada para três coisas, nunca para mostrar: validar a idade mínima, esconder bebidas com álcool a menores de 18 anos e escolher o título do nível mais alto. Tu escolhes quem vê a geleira (todos, seguidores, amigos próximos ou só tu); quando ela não é visível para alguém, o nível também não é. Guardamos também quem brindou a tua geleira: por omissão só tu vês quem foi; se ligares «Mostrar quem brindou a minha geleira», quem vê a geleira vê também essa lista. Como o saldo de Txills conta para o nível, uma geleira visível pode revelar de forma aproximada quanto tens."
  }
 ],
 [
  {
   "t": "h2",
   "x": "6. Verificação de identidade"
  },
  {
   "t": "p",
   "x": "Se pedires o selo de verificado, recolhemos o teu nome, a prova que indicares, uma foto de um documento de identificação e uma selfie. Estes ficheiros são **privados**: só a moderação os vê, só para decidir o pedido, e são **apagados logo que há decisão** (aprovar, recusar) ou quando retiras o pedido. Guardamos o resultado (se tens o selo, o tipo de selo e, numa recusa, o motivo) e as datas, para não repetir pedidos e para prevenir abuso. Os documentos nunca são mostrados a outras pessoas nem usados para outra coisa."
  }
 ],
 [
  {
   "t": "h2",
   "x": "7. Cookies e armazenamento"
  },
  {
   "t": "p",
   "x": "Usamos apenas o essencial: um cookie de sessão seguro (para manteres a sessão iniciada) e armazenamento local no teu aparelho (por exemplo, vários rascunhos de publicações, se silenciaste a música, as horas dos lembretes de notificações desligadas e, sem internet, as estatísticas de uso à espera de envio). Não usamos cookies de publicidade."
  }
 ],
 [
  {
   "t": "h2",
   "x": "8. Quanto tempo guardamos"
  },
  {
   "t": "p",
   "x": "Enquanto a conta existir, com estas exceções: o registo das chamadas é apagado ao fim de 12 meses (ou antes, quando as duas pessoas o apagam); a tua presença no mapa «À tua volta» é apagada ao fim de 3 horas (ou antes, ver ponto 1), e nunca guardamos a posição com que consultas o mapa ou procuras um sítio, nem a do ponto de que pedes a morada (a localização que envias numa mensagem fica guardada com a mensagem). O registo de «Apagar para mim» fica enquanto a mensagem existir, até limpares ou apagares essa conversa do teu lado, ou até eliminares a conta. As mensagens temporárias são apagadas dos servidores, com os ficheiros, poucos minutos depois de acabar a duração escolhida (ver ponto 1); os avisos de quem mudou a duração ficam com a conversa. «Limpar conversa» não apaga mensagens: ficam para os outros, como antes. Um pedido para entrar num TxillGroup fica guardado até um administrador o aceitar ou recusar, até o cancelares, até o grupo voltar a privado ou até eliminares a conta. Quando a última pessoa sai de um TxillGroup, o cofre é devolvido e o grupo é apagado, com a conversa, o plano, as sondagens, a lista e as despesas. Ao eliminares a conta (na app ou em txillapp.com/apagar-conta, ver ponto 9), apagamos o perfil (também a cidade, o site, o país e a última presença), as sessões iniciadas, as publicações (o texto é esvaziado e saem o sítio, a música, os temas, o país, as fotos e as hashtags; fica só uma linha vazia, para os presentes e as partilhas de outras pessoas não se partirem), os mimos, os Zás, as conversas a dois, as visitas a perfis (as tuas e as que recebeste), a impressão da rede do convite, o registo das mensagens que apagaste para ti, as chamadas, os seguidores e quem segues, as notificações, os aparelhos com notificações, as músicas favoritas, os check-ins, os locais que segues e os teus papéis de gestor, as respostas e os votos nos TxillGroups, os pedidos para entrar em TxillGroups, os interesses em eventos, tudo o que é do mapa, os brindes que deste, os registos dos avisos de brindes, os locais cujos destaques escondeste e as estatísticas de uso; o nome, o @, o email e a foto deixam de existir e a conta passa a «Conta eliminada». Sais dos TxillGroups, e as páginas de locais que criaste passam para o administrador mais antigo ou deixam de aparecer. Os comentários que deixaste, também em publicações de outras pessoas, e as mensagens que enviaste nos TxillGroups são apagados. Os movimentos de Txills e os pedidos de recarga ficam registados, sem dados pessoais, para as contas baterem certo e para prevenir fraude. Pela mesma razão, os registos dos convites (quem convidou quem, o estado e o prémio) ficam ligados à «Conta eliminada». As vezes que um destaque do Bombar te foi mostrado ou tocado ficam desligadas de ti, só para os totais do local. As denúncias que fazes ficam registadas e saem quando eliminas a conta. Quando denuncias uma mensagem, guardamos com a denúncia uma cópia do que lá estava nesse momento (o tipo, o texto, o nome e a morada do sítio, a hora da edição e, num GIF, o endereço da imagem no GIPHY; sem fotos, vídeos, voz nem coordenadas), para a moderação ver o que foi denunciado mesmo que a mensagem seja depois editada ou apagada. A cópia fica enquanto a denúncia estiver por decidir e é apagada 180 dias depois de a denúncia ser decidida; a denúncia em si continua registada. Guardamos também um registo de segurança das ações importantes (criar a conta, entrar, mudar ou recuperar a palavra-passe, eliminar a conta e as decisões da moderação), com o quê, quando e quem, sem o conteúdo das publicações ou das mensagens; este registo não se pode alterar e, por agora, não tem prazo para ser apagado. Mimos, notas e Zás deixam de aparecer ao fim de 24 horas. O conteúdo de visualização única (incluindo fotos e vídeos) é apagado do servidor em poucos minutos depois de aberto, e os ficheiros de mensagens apagadas são apagados na hora. Os documentos de uma verificação são apagados logo que há decisão. As estatísticas de uso, o que já viste no feed e as visitas a perfis não têm hoje um prazo mais curto: ficam até eliminares a conta. A impressão da rede de um convite fica com o registo do convite até a pessoa que entrou eliminar a conta. Os registos do servidor web (com o endereço IP) guardam só os mais recentes, até 50 MB, e os mais antigos são apagados sozinhos. **Cópias de segurança:** todas as noites fazemos uma cópia cifrada da base de dados, guardada noutro armazenamento. Cada cópia fica 35 dias, e a do primeiro dia de cada mês fica até 400 dias; depois são apagadas sozinhas. Por isso, o que apagas (também uma conta eliminada) pode continuar nessas cópias até expirarem. Só as usamos para repor o serviço depois de uma falha grave."
  }
 ],
 [
  {
   "t": "h2",
   "x": "9. Os teus direitos"
  },
  {
   "t": "ul",
   "x": [
    "**Aceder e levar contigo:** Definições → «Descarregar os meus dados». Inclui também as mensagens que enviaste e não apagaste para todos, nas conversas a dois e nos TxillGroups, com a hora da edição, o sítio, a partilha em direto, a referência dos GIFs e, nas mensagens temporárias, a hora em que expiram (as que já expiraram não entram), e a lista das mensagens que apagaste para ti (o id e a data); as mensagens que outras pessoas te enviaram não entram. Os teus comentários levam também a referência do GIF, se tiverem. Inclui ainda as chamadas, os locais (nos que criaste, também a morada, a cidade, o ponto no mapa e se aparecem no mapa), os eventos, as definições do mapa, os brindes que deste em publicações e em comentários, o teu código de convite, quem te convidou e quem convidaste (com o estado de cada convite), os destaques do Bombar que te foram mostrados ou que tocaste, os locais cujos destaques escondeste, as tuas estatísticas de uso (até às 10 000 mais recentes), o país, a cidade e o site da conta, os perfis que visitaste (com o dia) e, dos TxillGroups, as tuas respostas ao plano, votos, tarefas, despesas, o que puseste nos cofres e os pedidos para entrar que estão à espera.",
    "**Apagar partes:** podes apagar chamadas do histórico, conversas do teu lado, limpar uma conversa só para ti, ligar as mensagens temporárias (as novas apagam-se sozinhas), apagar mensagens (para ti, ou as tuas para todos), publicações, mimos e conversas com o SuperTxill, cancelar um pedido para entrar num TxillGroup, sair de um grupo, e desligar «Aparecer no mapa» e «Ajudar a melhorar o Txillapp» quando quiseres.",
    "**Corrigir:** edita o teu perfil a qualquer momento, e uma mensagem de texto tua até 15 minutos depois de a enviares.",
    "**Apagar a conta:** na app, em Definições → Conta → «Eliminar conta» (pedimos o teu @ e, se a conta tiver, a senha). Sem a app, em **txillapp.com/apagar-conta**: escreves o email da conta e mandamos para esse email uma ligação de confirmação, que vale 1 hora; a conta só é apagada quando confirmas na página que a ligação abre. Escrever o email não apaga nada, e a resposta é igual exista ou não uma conta com esse email. Se já não tens acesso ao email, escreve para privacidade@txillapp.com.",
    "**O que se apaga:** na hora em que confirmas, o nome, o @, o email, a senha, a bio, a foto, a cidade, o site, o país, o género e a data de nascimento; as publicações (o texto é esvaziado e saem as fotos, os vídeos, o sítio e a música), os mimos, as notas, os Zás e os comentários, também em publicações de outras pessoas; as conversas a dois, as mensagens que enviaste nos TxillGroups, as chamadas e as conversas com o SuperTxill; quem segues e quem te segue, os brindes, as notificações, os guardados, a geleira e as preferências; os aparelhos e as sessões, as estatísticas de uso, as visitas a perfis, os check-ins, tudo o que é do mapa e os pedidos de verificação. Os ficheiros saem do armazenamento pouco depois, normalmente em menos de 15 minutos. A lista completa está no ponto 8.",
    "**O que fica, e porquê:** os movimentos de Txills e os pedidos de recarga, sem dados pessoais e ligados a «Conta eliminada», para as contas baterem certo e para prevenir fraude; pela mesma razão, os registos dos convites. O registo de segurança diz que a conta foi eliminada e quando, sem o conteúdo das publicações nem das mensagens. As denúncias que outras pessoas fizeram sobre o que publicaste seguem os prazos do ponto 8. As cópias de segurança cifradas desaparecem sozinhas ao fim de, no máximo, 400 dias. O que outras pessoas guardaram, copiaram ou fotografaram nos aparelhos delas fica fora do nosso alcance.",
    "**Retirar permissões:** podes desligar a localização (sem ela, não aparecem sugestões de sítios perto de ti, procuras os sítios pelo nome ou marcas no mapa, em «À tua volta» escolhes uma cidade e não apareces à malta, e no chat não envias a tua posição atual nem a partilhas em direto, mas podes enviar um sítio que procures ou um ponto do mapa), a câmara, o microfone, o acesso às fotos e as notificações nas definições do telemóvel ou do browser. Sem câmara e microfone não há chamadas. No Android, escolher fotos não pede acesso à galeria, porque passa pelo seletor do sistema."
   ]
  }
 ],
 [
  {
   "t": "h2",
   "x": "10. Crianças"
  },
  {
   "t": "p",
   "x": "O Txillapp não é para menores de 15 anos. Se descobrirmos uma conta abaixo dessa idade, removemo-la."
  }
 ],
 [
  {
   "t": "h2",
   "x": "11. Quem trata os teus dados"
  },
  {
   "t": "p",
   "x": "Os dados são tratados pelo Txillapp e guardados em servidores de fornecedores que só os processam para nós: o alojamento do servidor, a Cloudflare (a rede e a proteção do site, que vê o endereço IP de cada pedido, e o armazenamento das fotos e dos vídeos) e um armazenamento à parte para as cópias de segurança, que lá ficam cifradas. Os emails do Txillapp (confirmar a conta, recuperar a senha, lembretes e a ligação para apagar a conta) são enviados pelo Zoho, que recebe o teu email e o texto da mensagem. Outros serviços recebem só o necessário: se entrares com a Google (no site), recebemos o teu nome e email dessa conta; as notificações passam pelo Firebase Cloud Messaging, da Google (Android), e pelo serviço de notificações da Apple, APNs (iPhone), que recebem o identificador do aparelho e o texto do aviso, nunca o conteúdo das mensagens; as chamadas usam servidores STUN da Google (a retransmissão TURN é nossa); os pagamentos ficam com o fornecedor que escolheres (M-Pesa, e-Mola ou cartão); as perguntas ao SuperTxill vão para a Anthropic; as pesquisas de música vão para o Openverse; as pesquisas de GIFs vão para o GIPHY através do nosso servidor, sem dizer quem és, e as imagens dos GIFs são carregadas diretamente do GIPHY (ver ponto 1); os mapas, a pesquisa de sítios, os «Sítios perto» e a morada de um ponto marcado no mapa (também ao enviar uma localização no chat) usam serviços do OpenStreetMap (mosaicos, Nominatim, Overpass e Photon), sempre através do nosso servidor (ver ponto 1); «Como chegar» abre o Google Maps ou o Apple Maps (na app ou no browser) só com o destino; e tocar numa localização recebida no chat abre o Google Maps com esse ponto. As estatísticas de uso e os registos do Bombar ficam só connosco: os locais que bombam veem apenas totais. Não partilhamos dados com ninguém para publicidade."
  }
 ],
 [
  {
   "t": "h2",
   "x": "12. Contacto"
  },
  {
   "t": "p",
   "x": "Para exercer os teus direitos, pedir ajuda ou esclarecer dúvidas sobre os teus dados, escreve para privacidade@txillapp.com. Respondemos o mais depressa possível."
  }
 ]
];
