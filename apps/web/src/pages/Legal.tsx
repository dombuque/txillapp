import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MIN_AGE, TERMS_VERSION } from '@txillapp/shared';
import { BackIcon } from '../components/icons';
import { Wordmark } from '../components/ui';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** "2026-10" → "outubro de 2026". */
const updated = (v: string) => {
  const [y, m] = v.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} de ${y}`;
};

function Page({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-white px-5 pb-16">
      <header className="sticky top-[env(safe-area-inset-top)] z-10 -mx-5 flex items-center gap-2 border-b border-zinc-100 bg-white px-3 py-2">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }))} aria-label="Voltar" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100">
          <BackIcon />
        </button>
        <Wordmark className="h-7" />
      </header>
      <h1 className="mt-6 text-3xl font-extrabold">{title}</h1>
      <p className="mt-1 text-sm text-zinc-500">Última atualização: {updated(TERMS_VERSION)}</p>
      <div className="mt-6 space-y-6 text-[16px] leading-relaxed text-zinc-800 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">{children}</div>
      <p className="mt-10 text-center text-sm text-zinc-500">
        <Link to="/terms" className="underline">Termos de Uso</Link> · <Link to="/privacy" className="underline">Política de Privacidade</Link>
      </p>
    </div>
  );
}

export function Terms() {
  return (
    <Page title="Termos de Uso">
      <section>
        <h2>1. O que é o Txillapp</h2>
        <p>
          O Txillapp é uma rede social: publicas fotos e textos, segues pessoas, partilhas stories e trocas mensagens. Inclui uma carteira de <b>Txills</b>, pontos virtuais da app que se usam para oferecer presentes a quem segues.
          Os Txills não são dinheiro: não têm valor monetário, não se compram, não se vendem, não se trocam por dinheiro e não se levantam.
        </p>
      </section>
      <section>
        <h2>2. Quem pode ter conta</h2>
        <ul>
          <li>Tens de ter pelo menos {MIN_AGE} anos.</li>
          <li>Uma pessoa, uma conta. Dá informação verdadeira e mantém a tua senha em segredo.</li>
          <li>Podemos pedir-te para confirmar a idade e suspender contas que não cumpram este mínimo.</li>
        </ul>
      </section>
      <section>
        <h2>3. O que publicas é teu — e é da tua responsabilidade</h2>
        <p>
          Continuas dono do que publicas. Ao publicar, dás-nos permissão para guardar e mostrar esse conteúdo às pessoas que escolheste (segundo as tuas definições de privacidade),
          só para o serviço funcionar. Só publiques o que tens direito de partilhar.
        </p>
      </section>
      <section>
        <h2>4. Regras da malta</h2>
        <p>Não é permitido:</p>
        <ul>
          <li>assediar, ameaçar, humilhar ou perseguir pessoas;</li>
          <li>discriminar por raça, género, religião, orientação, origem, deficiência ou outra característica;</li>
          <li>publicar nudez de menores, violência explícita, ou conteúdo ilegal;</li>
          <li>fazer-te passar por outra pessoa, ou enganar com contas falsas, spam ou burlas;</li>
          <li>partilhar dados privados de outras pessoas sem consentimento;</li>
          <li>tentar invadir o serviço, contornar a segurança ou recolher dados em massa.</li>
        </ul>
        <h3>Mensagens de quem não segues</h3>
        <p>Para proteger toda a gente de spam e assédio, as conversas com quem não se segue têm regras próprias:</p>
        <ul>
          <li>Quando alguém que não segues te escreve, a conversa chega como <b>pedido de mensagem</b>. Não conta no número do ícone das mensagens até a aceitares. Podes <b>aceitar</b>, <b>recusar</b> (a pessoa não é avisada e deixas de receber avisos dela), <b>bloquear</b> ou <b>denunciar</b>.</li>
          <li>Quem escreve a alguém que não o segue vê o aviso «Esta pessoa não te segue» e pode enviar <b>até 3 mensagens</b> enquanto a outra pessoa não responder, aceitar ou seguir de volta. Depois disso, tem de esperar.</li>
          <li>Responder a um pedido, aceitá-lo ou seguir a pessoa liberta a conversa, sem limite.</li>
          <li>Cada pessoa escolhe quem lhe pode escrever em Definições (todos, só quem segue, ou ninguém). Contas bloqueadas não conseguem escrever-te.</li>
          <li>Pedidos de mensagem usados para assediar, enganar ou fazer spam podem levar à suspensão da conta (ver «Denúncias e moderação»).</li>
        </ul>
      </section>
      <section>
        <h2>5. Presentes, Txills e geleira</h2>
        <ul>
          <li>Só podes presentear quem segues e quem aceita presentes (cada pessoa escolhe isso nas Definições). O presente pode ficar <b>em silêncio</b>, <b>privado</b> ou ser <b>publicado</b> num post para toda a gente ver.</li>
          <li>A <b>geleira</b> é a tua vitrine de gostos (vibes, bebidas, comidas e sítios). Quem a vê escolhes tu: todos, só seguidores, só amigos próximos ou só tu.</li>
          <li>As <b>bebidas com álcool</b> só aparecem a maiores de 18 anos; menores nunca as veem, juntam ou sugerem.</li>
          <li>A geleira tem um <b>nível</b>, calculado por pontos. As bebidas com álcool e as vibes de festa valem mais, as outras valem menos, um favorito dá mais um ponto, e os teus <b>Txills também contam</b> (1 ponto por cada 200, até 5). O nível tem nome em calão da malta (por exemplo, «Paulada garantida»).</li>
          <li>O título do nível mais alto <b>muda com a tua idade</b> (por exemplo, «Madala da paulada» só a partir dos 45 anos). A idade vem da data de nascimento que deste ao criar a conta; a data nunca é mostrada a ninguém.</li>
          <li>Como os Txills contam para o nível, quem vê a tua geleira pode ter uma ideia aproximada de quantos tens. Se não queres isso, põe a geleira como <b>só eu</b>: então o nível também não aparece a mais ninguém.</li>
          <li>Os Txills não são dinheiro (ver ponto 1) e a pontuação é só uma brincadeira: não dá direito a prémios nem a dinheiro.</li>
          <li>Podes <b>recarregar Txills</b> em Definições → «Pedidos e pagamentos», com os métodos que estiverem disponíveis. Os Txills comprados entram na carteira e usam-se como os outros: não se trocam por dinheiro. Um pedido que não for pago em 30 minutos expira; se o pagamento chegar depois, os Txills são entregues na mesma. Para qualquer problema com um pagamento, escreve para o suporte.</li>
        </ul>
      </section>
      <section>
        <h2>6. Selo de verificado</h2>
        <ul>
          <li>Há dois selos: o <b>azul</b>, para pessoas e negócios verificados, e o selo coral do Txillapp, só para <b>contas oficiais</b> da casa.</li>
          <li>Para pedir o selo a conta tem de cumprir requisitos: email confirmado, foto e bio, 30 dias ou mais, 3 publicações ou mais, 10 seguidores ou mais e nenhuma sanção recente.</li>
          <li>Depois envias o teu nome, uma prova de quem és (uma ligação ou explicação), uma foto de um documento de identificação e uma selfie. A moderação revê tudo à mão.</li>
          <li>Podes ser recusado, com o motivo. Só podes voltar a pedir passados 30 dias. Podemos retirar o selo a contas que violem estes termos, mudem de identidade ou fiquem inativas.</li>
          <li>O selo não dá privilégios nem é uma recomendação do Txillapp sobre o que a pessoa publica. No futuro poderão existir formas pagas de verificação; nunca sem avisar antes.</li>
        </ul>
      </section>
      <section>
        <h2>7. Stories, notas e conteúdo temporário</h2>
        <ul>
          <li><b>Stories e notas</b> duram 24 horas. As <b>notas</b> só as veem os teus seguidores e não se editam: apagas e publicas outra.</li>
          <li><b>Música nas notas e nos posts</b>: só se usam faixas de licença aberta (Creative Commons: CC0, domínio público, CC BY e CC BY-SA), de um catálogo público (Openverse). O nome do autor e a licença aparecem junto à faixa. Quando procuras música, o texto que escreves é enviado a esse catálogo; não enviamos mais nada sobre ti. Também podes gravar um clipe de áudio teu (até 30 segundos): fica guardado de forma privada e só é mostrado a quem vê a nota ou o post.</li>
          <li><b>Música nos stories</b>: tal como nas notas e nos posts, só faixas de licença aberta, com o autor e a licença à vista.</li>
          <li><b>Zás</b>: são fotos tiradas na hora (sem galeria), com uma legenda curta, que duram 24 horas. Tu escolhes se vão para os <b>Amigos</b> (quem se segue contigo) ou só para os <b>Próximos</b>. Cada pessoa vê cada Zás <b>uma só vez</b>, e tu vês quem o viu e como reagiu. Tens 6 segundos para desfazer o envio e podes apagar um Zás quando quiseres. Quem recebe pode, mesmo assim, fotografar o ecrã; a app não consegue impedir nem detetar capturas de ecrã. O «ver uma vez» é cumprido pela app e não é uma garantia absoluta.</li>
          <li><b>Vídeos nas mensagens</b>: podes enviar vídeos (até 60 segundos e 100 MB), normais ou de visualização única. Há um limite de vídeos por hora para proteger o serviço, e os vídeos são verificados como as outras fotos e vídeos.</li>
          <li><b>Visualização única</b>: fotos, vídeos, voz e mensagens que só se abrem uma vez; depois de abertas, o ficheiro é apagado do servidor em poucos minutos (até 5). Os ficheiros de mensagens apagadas são apagados na hora. Quem recebe pode, mesmo assim, fotografar o ecrã. Não confies nisto para o que não podes arriscar.</li>
          <li><b>Reações e respostas</b>: podes reagir a mensagens (com um duplo toque, um brinde) e responder a uma mensagem em concreto. Quem enviou a mensagem vê a reação.</li>
          <li><b>Localização em direto</b> só se atualiza enquanto o Txillapp está aberto no teu aparelho e para quando acabar o tempo que escolheste (ou quando a parares).</li>
          <li>Podes partilhar publicações e stories com amigos no chat ou noutras apps. Quando alguém abre o link sem ter entrado, vê apenas uma pré-visualização das publicações <b>públicas</b>, sem poder brindar, comentar nem partilhar.</li>
        </ul>
      </section>
      <section>
        <h2>8. Denúncias e moderação</h2>
        <p>
          O que é claramente uma ameaça, incentivo ao suicídio ou ódio contra um grupo de pessoas é recusado automaticamente antes de ser publicado ou enviado.
          Podes denunciar publicações, comentários, mensagens e contas. Analisamos as denúncias e podemos remover conteúdo ou suspender contas que violem estes termos.
          Podes bloquear qualquer pessoa a qualquer momento.
        </p>
      </section>
      <section>
        <h2>9. Terminar a conta</h2>
        <p>
          Podes eliminar a tua conta nas Definições. O teu perfil e as tuas publicações deixam de ser visíveis e os teus dados pessoais são removidos,
          como explicado na Política de Privacidade. Podemos suspender ou encerrar contas que violem estes termos.
        </p>
      </section>
      <section>
        <h2>10. Sem garantias absolutas</h2>
        <p>
          Este serviço é fornecido «como está» e pode ter interrupções ou erros. Na medida permitida pela lei, não nos responsabilizamos por perdas indiretas resultantes do uso do serviço
          ou de conteúdo publicado por outras pessoas.
        </p>
      </section>
      <section>
        <h2>11. Alterações</h2>
        <p>Se mudarmos estes termos de forma relevante, avisamos-te na app e pedimos-te para aceitar de novo.</p>
      </section>
      <section>
        <h2>12. Lei aplicável e contacto</h2>
        <p>
          Estes termos regem-se pela lei da República de Moçambique. Para qualquer questão sobre o serviço, ajuda ou denúncias, escreve para{' '}
          <a href="mailto:suporte@txillapp.com" className="font-semibold text-brand underline">suporte@txillapp.com</a>.
        </p>
      </section>
    </Page>
  );
}

export function Privacy() {
  return (
    <Page title="Política de Privacidade">
      <section>
        <h2>1. Que dados recolhemos</h2>
        <ul>
          <li><b>Conta:</b> nome, @utilizador, email, senha (guardada só em forma cifrada), data de nascimento (só para validar a idade, nunca é mostrada) e, se quiseres, género.</li>
          <li><b>O que publicas:</b> posts, fotos, stories, comentários, brindes, mensagens e as pessoas que identificas ou mencionas.</li>
          <li><b>Localização:</b> só o <i>nome do sítio</i> que escolheres. Nunca guardamos a tua posição exata.</li>
          <li><b>Segurança:</b> sessões e dispositivos com sessão iniciada (tipo de browser, datas de acesso) e registos de ações sensíveis.</li>
          <li><b>Carteira:</b> o teu saldo de Txills e os movimentos (presentes enviados e recebidos).</li>
          <li><b>Pagamentos:</b> se recarregares Txills, guardamos o pedido (pacote, valor, método de pagamento, estado e datas) e só os últimos 3 dígitos do teu telemóvel. Os dados completos do pagamento ficam com o fornecedor (M-Pesa, e-Mola ou cartão) e nós não os guardamos.</li>
          <li><b>Contactos:</b> só se usares «Amigos nos contactos». Os contactos ficam no teu telemóvel; enviamos apenas um resumo cifrado (SHA-256) dos emails, só para ver quem já está no Txillapp, e não guardamos nem os resumos nem os contactos. Podes não ser encontrado por esta via em Definições → «Deixar que me encontrem pelos contactos».</li>
          <li><b>Geleira:</b> os gostos que juntas (vibes, bebidas, comidas e sítios), com notas e favoritos, e o nível calculado a partir deles e do teu saldo de Txills.</li>
          <li><b>Presença:</b> se estás online ou a escrever um comentário (só enquanto a app está aberta) e a hora da última vez que estiveste online.</li>
          <li><b>Verificação:</b> se pedires o selo, o teu nome, a prova que indicares, uma foto de um documento e uma selfie (apagados logo que há decisão).</li>
          <li><b>Localização em direto:</b> se a partilhares numa conversa, a tua posição vai-se atualizando só enquanto a app está aberta e durante o tempo que escolheste.</li>
          <li><b>Utilização:</b> aberturas da app, ecrãs vistos, desempenho e erros. São estatísticas nossas, sem terceiros, e podes desligá-las em Definições → «Ajudar a melhorar o Txillapp». Também guardamos o que já viste no feed, para não repetir sempre o mesmo.</li>
          <li><b>Zás:</b> a foto, a legenda, para quem a enviaste (Amigos ou Próximos), a hora, quem a viu e como reagiu. Uma miniatura minúscula e desfocada (24×32 pontos) serve só para o atalho. Duram 24 horas.</li>
          <li><b>Notificações:</b> se as ativares, guardamos o identificador do teu aparelho para as enviar. O texto nunca mostra o conteúdo das mensagens nem qual foi a reação; podes desligá-las quando quiseres.</li>
          <li><b>Reações a mensagens:</b> a reação que deixas e quem a deixou, visíveis para quem está na conversa.</li>
          <li><b>Fotos e vídeos:</b> são verificados automaticamente no nosso servidor (nudez e conteúdo sexual) antes de ficarem visíveis. Nada é enviado a terceiros.</li>
        </ul>
      </section>
      <section>
        <h2>2. Para que usamos</h2>
        <p>Para fazer o serviço funcionar, mostrar o teu conteúdo a quem escolheste, manter a conta segura, prevenir abuso e analisar denúncias. Não vendemos os teus dados.</p>
      </section>
      <section>
        <h2>3. Quem vê o quê</h2>
        <p>
          Tu controlas: perfil público ou privado, quem comenta, menciona, presenteia ou te envia mensagens, quem vê os teus seguidores e quem repostou, brindou ou presenteou.
          O género escolhe-se ao criar a conta e <b>não se altera</b>; só aparece no perfil se tu quiseres. As mensagens diretas só são visíveis para as duas pessoas da conversa.
          As <b>notas</b> só as veem os teus seguidores. A <b>geleira</b> e o seu nível veem-nos só quem escolheres. Quem não tem conta e abre um link de uma publicação <b>pública</b> vê só uma pré-visualização dela (sem comentários nem ações);
          publicações de contas privadas, apagadas ou de quem te bloqueou nunca aparecem. Redes como o WhatsApp podem mostrar um cartão com o nome, o texto e a foto de uma publicação pública quando alguém cola o link.
        </p>
      </section>
      <section>
        <h2>4. Presença online e a escrever</h2>
        <p>
          O Txillapp mostra quando uma pessoa está <b>online</b> (com a app aberta) e, nos comentários de um post, quando alguém está <b>a escrever</b>. No chat mostra também «Visto há…».
          Isto só vale entre quem mostra a presença: se desligares «Mostrar quando estou online» nas Definições, ninguém te vê online ou a escrever, e tu também deixas de ver os outros.
          Quem tem a conta bloqueada nunca te vê. A presença só existe enquanto a app está aberta; só guardamos a hora da última vez que estiveste online.
        </p>
      </section>
      <section>
        <h2>5. Geleira e pontuação</h2>
        <p>
          Guardamos os gostos que juntas à tua geleira, as notas e os favoritos. Com eles, e com o teu saldo de Txills, calculamos o <b>nível</b> da geleira.
          A data de nascimento é usada para três coisas, nunca para mostrar: validar a idade mínima, esconder bebidas com álcool a menores de 18 anos e escolher o título do nível mais alto.
          Tu escolhes quem vê a geleira (todos, seguidores, amigos próximos ou só tu); quando ela não é visível para alguém, o nível também não é. Como o saldo de Txills conta para o nível, uma geleira visível pode revelar de forma aproximada quanto tens.
        </p>
      </section>
      <section>
        <h2>6. Verificação de identidade</h2>
        <p>
          Se pedires o selo de verificado, recolhemos o teu nome, a prova que indicares, uma foto de um documento de identificação e uma selfie.
          Estes ficheiros são <b>privados</b>: só a moderação os vê, só para decidir o pedido, e são <b>apagados logo que há decisão</b> (aprovar, recusar) ou quando retiras o pedido.
          Guardamos o resultado (se tens o selo, o tipo de selo e, numa recusa, o motivo) e as datas, para não repetir pedidos e para prevenir abuso. Os documentos nunca são mostrados a outras pessoas nem usados para outra coisa.
        </p>
      </section>
      <section>
        <h2>7. Cookies e armazenamento</h2>
        <p>
          Usamos apenas o essencial: um cookie de sessão seguro (para manteres a sessão iniciada) e armazenamento local no teu aparelho (por exemplo, vários rascunhos de publicações, e se silenciaste a música).
          Não usamos cookies de publicidade.
        </p>
      </section>
      <section>
        <h2>8. Quanto tempo guardamos</h2>
        <p>
          Enquanto a conta existir. Ao eliminares a conta, os dados pessoais são removidos ou anonimizados e as tuas fotos e mensagens deixam de estar acessíveis.
          Alguns registos de segurança podem ser mantidos por um período limitado para prevenir abuso.
          Stories, notas e Zás deixam de aparecer ao fim de 24 horas. O conteúdo de visualização única (incluindo fotos e vídeos) é apagado do servidor em poucos minutos depois de aberto, e os ficheiros de mensagens apagadas são apagados na hora. Os documentos de uma verificação são apagados logo que há decisão.
        </p>
      </section>
      <section>
        <h2>9. Os teus direitos</h2>
        <ul>
          <li><b>Aceder e levar contigo:</b> Definições → «Descarregar os meus dados».</li>
          <li><b>Corrigir:</b> edita o teu perfil a qualquer momento.</li>
          <li><b>Apagar:</b> Definições → «Eliminar conta».</li>
          <li><b>Retirar permissões:</b> podes desligar a localização, câmara e microfone no teu browser.</li>
        </ul>
      </section>
      <section>
        <h2>10. Crianças</h2>
        <p>O Txillapp não é para menores de {MIN_AGE} anos. Se descobrirmos uma conta abaixo dessa idade, removemo-la.</p>
      </section>
      <section>
        <h2>11. Quem trata os teus dados</h2>
        <p>
          Os dados são tratados pelo Txillapp e guardados em servidores de fornecedores de alojamento e de rede (por exemplo, o armazenamento das fotos e vídeos e a proteção do site),
          que só os processam para nós. Se entrares com a Google, recebemos o teu nome e email dessa conta. Os mapas usam o OpenStreetMap, que vê o endereço de rede do teu aparelho ao carregar o mapa.
        </p>
      </section>
      <section>
        <h2>12. Contacto</h2>
        <p>
          Para exercer os teus direitos, pedir ajuda ou esclarecer dúvidas sobre os teus dados, escreve para{' '}
          <a href="mailto:privacidade@txillapp.com" className="font-semibold text-brand underline">privacidade@txillapp.com</a>.
          Respondemos o mais depressa possível.
        </p>
      </section>
    </Page>
  );
}
