/** Termos e Política de Privacidade do site antigo. Gerado a partir de apps/mobile/src/lib/legalText.ts por apps/web/scripts/make-legal.mjs (node apps/web/scripts/make-legal.mjs): não editar à mão. */
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TERMS_VERSION } from '@txillapp/shared';

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
        <p>O Txillapp é uma rede social: publicas fotos, vídeos e textos, Tchekas e Mimos, segues pessoas e locais, trocas mensagens e fazes chamadas de voz e de vídeo. Inclui uma carteira de <b>Txills</b>, a moeda do Txillapp. Hoje os Txills acumulam-se e servem para presentear quem segues, juntar no cofre de um TxillGroup e pagar nos locais que aceitam Txills; em breve vão servir também para pagar vibes. Os Txills não são dinheiro nem moeda com curso legal: não se trocam por dinheiro, não se levantam e não se transferem para fora do Txillapp.</p>
      </section>
      <section>
        <h2>2. Quem pode ter conta</h2>
        <ul>
          <li>Tens de ter pelo menos 15 anos.</li>
          <li>Uma pessoa, uma conta. Dá informação verdadeira e mantém a tua senha em segredo.</li>
          <li>Podemos pedir-te para confirmar a idade e suspender contas que não cumpram este mínimo.</li>
        </ul>
      </section>
      <section>
        <h2>3. O que publicas é teu, e é da tua responsabilidade</h2>
        <p>Continuas dono do que publicas. Ao publicar, dás-nos permissão para guardar e mostrar esse conteúdo às pessoas que escolheste (segundo as tuas definições de privacidade), só para o serviço funcionar. Só publiques o que tens direito de partilhar.</p>
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
          <li><b>Boas-vindas</b>: ao criar a conta recebes 500 Txills na tua carteira.</li>
          <li>Só podes presentear quem segues e quem aceita presentes (cada pessoa escolhe isso nas Definições). O presente pode ficar <b>em silêncio</b>, <b>privado</b> ou ser <b>publicado</b> num post para toda a gente ver.</li>
          <li>A <b>geleira</b> é a tua vitrine de gostos (vibes, bebidas, comidas e sítios). Quem a vê escolhes tu: todos, só seguidores, só amigos próximos ou só tu. Quem a vê pode <b>brindá-la</b>; por omissão só tu vês quem brindou, mas podes torná-lo visível a quem vê a geleira nas definições dela (Editar perfil).</li>
          <li>As <b>bebidas com álcool</b> só aparecem a maiores de 18 anos; menores nunca as veem, juntam ou sugerem.</li>
          <li>A geleira tem um <b>nível</b>, calculado por pontos. As bebidas com álcool e as vibes de festa valem mais, as outras valem menos, um favorito dá mais um ponto, e os teus <b>Txills também contam</b> (1 ponto por cada 200, até 5). O nível tem nome em calão da malta (por exemplo, «Paulada garantida»).</li>
          <li>O título do nível mais alto <b>muda com a tua idade</b> (por exemplo, «Madala da paulada» só a partir dos 45 anos). A idade vem da data de nascimento que deste ao criar a conta; a data nunca é mostrada a ninguém.</li>
          <li>Como os Txills contam para o nível, quem vê a tua geleira pode ter uma ideia aproximada de quantos tens. Se não queres isso, põe a geleira como <b>só eu</b>: então o nível também não aparece a mais ninguém.</li>
          <li><b>Convites</b>: tens um código para trazer a malta. Quando quem convidas confirma o email e fica ativo (publica algo ou segue 3 pessoas), essa pessoa ganha 50 Txills e tu ganhas outros 50 passados 7 dias, se ela continuar por cá. Há um máximo de 5 convites premiados por dia e 50 no total, e um teto mensal para toda a app. Contas repetidas, emails temporários e registos em massa não contam, e podemos anular Txills ganhos assim. Os Txills dos convites são Txills como os outros.</li>
          <li>Os Txills não se trocam por dinheiro (ver ponto 1). A pontuação da geleira serve só para mostrar o nível: não dá direito a prémios nem a dinheiro.</li>
          <li>Podes <b>recarregar Txills</b> em Definições → «Pedidos e pagamentos», com os métodos que estiverem disponíveis. Os Txills comprados entram na carteira e usam-se como os outros: não se trocam por dinheiro. Um pedido que não for pago em 30 minutos expira; se o pagamento chegar depois, os Txills são entregues na mesma. Para qualquer problema com um pagamento, escreve para o suporte.</li>
          <li><b>Cofre dos TxillGroups</b>: podes pôr Txills da tua carteira no cofre de um TxillGroup (de 10 a 100 000 de cada vez). O que lá metes passa a ser do grupo: se saíres, fica no cofre. Só os administradores do grupo pagam a locais com o cofre ou o devolvem. A devolução vai para quem contribuiu desde a última devolução, na proporção do que cada um pôs. Se o grupo acabar (sai a última pessoa), o cofre é devolvido sozinho.</li>
          <li><b>Pagar nos locais</b>: só nos locais que aceitam Txills (a página mostra «Aceita Txills»). O pagamento é feito na hora e não se desfaz pela app, por isso confirma o local e o valor antes. Recebes um recibo, e quem gere o local vê quem pagou, quanto e a nota que deixaste. Para um problema com um pagamento, fala com o local ou com o suporte. Os Txills que um local recebe ficam na carteira do local e também não se trocam por dinheiro.</li>
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
        <h2>7. Mimos, notas e conteúdo temporário</h2>
        <ul>
          <li><b>Mimos e notas</b> duram 24 horas. As <b>notas</b> só as veem os teus seguidores e não se editam: apagas e publicas outra.</li>
          <li><b>Música nas notas e nos posts</b>: só se usam faixas de licença aberta (Creative Commons: CC0, domínio público, CC BY e CC BY-SA), de um catálogo público (Openverse). O nome do autor e a licença aparecem junto à faixa. Quando procuras música, o texto que escreves é enviado a esse catálogo pelo nosso servidor; não enviamos mais nada sobre ti. Também podes gravar um clipe de áudio teu (até 30 segundos): fica guardado de forma privada e só é mostrado a quem vê a nota ou o post.</li>
          <li><b>Música nos mimos</b>: tal como nas notas e nos posts, só faixas de licença aberta, com o autor e a licença à vista. Podes marcar faixas como <b>favoritas</b> para as teres à mão, e vês sugestões: as faixas que a malta do teu país mais usa e as que usaste ultimamente. As sugestões só contam usos, nunca mostram quem usou.</li>
          <li><b>Stickers nos mimos</b>: podes pôr stickers por cima da foto, do vídeo ou do post partilhado. Quando guardas um mimo teu na galeria, a foto ou o vídeo leva os stickers e a assinatura do Txillapp com o teu @. Só podes guardar os teus próprios mimos.</li>
          <li><b>Vídeos e música no feed</b>: os vídeos dos posts e das Tchekas começam sozinhos, sem som, quando estão à vista, e param quando saem; um toque liga o som. A música de um post toca enquanto o post está à vista e pode ser silenciada. Isto gasta dados móveis.</li>
          <li><b>Zás</b>: são fotos tiradas na hora (sem galeria), com uma legenda curta, que duram 24 horas. Tu escolhes se vão para os <b>Amigos</b> (quem se segue contigo) ou só para os <b>Próximos</b>. Cada pessoa vê cada Zás <b>uma só vez</b>, e tu vês quem o viu e como reagiu. Tens 6 segundos para desfazer o envio e podes apagar um Zás quando quiseres. Quem recebe pode, mesmo assim, fotografar o ecrã; a app não consegue impedir nem detetar capturas de ecrã. O «ver uma vez» é cumprido pela app e não é uma garantia absoluta.</li>
          <li><b>Vídeos nas mensagens</b>: podes enviar vídeos (até 60 segundos e 100 MB), normais ou de visualização única. Há um limite de vídeos por hora para proteger o serviço, e os vídeos são verificados como as outras fotos e vídeos.</li>
          <li><b>Visualização única</b>: fotos, vídeos, voz e mensagens que só se abrem uma vez; depois de abertas, o ficheiro é apagado do servidor em poucos minutos (até 5). Os ficheiros de mensagens apagadas são apagados na hora. Quem recebe pode, mesmo assim, fotografar o ecrã. Não confies nisto para o que não podes arriscar.</li>
          <li><b>SuperTxill</b>: é a inteligência artificial do Txillapp, na barra de pesquisa (não é uma conta nem uma conversa com uma pessoa). É grátis, com um limite de respostas por dia. É uma IA e pode errar: confirma o que for importante e não a uses para decisões médicas, jurídicas ou financeiras. Não tem acesso às tuas outras conversas, nem às contas ou aos Txills de ninguém, e não faz ações na app. Não lhe peças nem lhe mandes conteúdo que as regras da app não permitem.</li>
          <li><b>Reações e respostas</b>: podes reagir a mensagens (com um duplo toque, um brinde) e responder a uma mensagem em concreto. Quem enviou a mensagem vê a reação.</li>
          <li><b>Lista de conversas</b>: podes apagar uma conversa só do teu lado (do lado da outra pessoa fica tudo, e se te escreverem outra vez a conversa volta) e marcá-la como por ler.</li>
          <li><b>Localização em direto</b> só se atualiza enquanto o Txillapp está aberto no teu aparelho e para quando acabar o tempo que escolheste (ou quando a parares).</li>
          <li>Podes partilhar publicações e mimos com amigos no chat ou noutras apps. Quando alguém abre o link sem ter entrado, vê apenas uma pré-visualização das publicações <b>públicas</b>, sem poder brindar, comentar nem partilhar.</li>
        </ul>
      </section>
      <section>
        <h2>8. Chamadas de voz e de vídeo</h2>
        <ul>
          <li>Podes fazer chamadas de voz e videochamadas a uma pessoa de cada vez. Para ligar, o teu email tem de estar confirmado.</li>
          <li>Quem te pode ligar escolhes tu em Definições → «Quem me pode ligar»: <b>todos</b>, <b>quem eu sigo</b>, <b>amigos mútuos</b> (quem segues e te segue de volta, a opção de origem) ou <b>ninguém</b>. Contas bloqueadas nunca te ligam.</li>
          <li>Uma chamada toca até 45 segundos. Se ninguém atender, fica como <b>chamada perdida</b> e recebes um aviso. Ao recusar, podes mandar uma mensagem rápida, que segue as regras normais das mensagens. Uma chamada termina sozinha ao fim de 6 horas.</li>
          <li>As chamadas ficam registadas na conversa entre as duas pessoas e no teu histórico de chamadas: com quem, se foi de voz ou de vídeo, quando e quanto durou.</li>
          <li>No histórico podes apagar uma chamada ou limpar tudo: sai só da tua lista, a outra pessoa mantém a dela. As chamadas com mais de 12 meses são apagadas sozinhas.</li>
          <li>Em Definições → «Esconder o meu IP nas chamadas» (quando está disponível), a chamada passa sempre pelo servidor do Txillapp e a outra pessoa não fica a conhecer o teu endereço de rede. A chamada pode ficar um pouco mais lenta.</li>
          <li>O Txillapp <b>não grava</b> chamadas. Não graves nem divulgues uma chamada sem o consentimento da outra pessoa. As regras da malta (ponto 4) valem também nas chamadas, e podes bloquear ou denunciar quem as use para assediar.</li>
        </ul>
      </section>
      <section>
        <h2>9. TxillGroups</h2>
        <ul>
          <li>Um <b>TxillGroup</b> é um grupo de conversa, até 50 pessoas, com nome, tipo (viagem, festa, fim de semana ou outro), descrição, capa, foto de perfil e um plano: o destino ou o local, as datas e quem vai (vou, talvez, não vou). Tem também sondagens, uma lista do que levar ou fazer, despesas, um álbum e um cofre de Txills.</li>
          <li><b>Quem vê e quem entra</b>: um administrador escolhe um de três modos, e a mudança só fica feita depois de ele a confirmar.</li>
          <li><b>Privado</b> (o modo de origem): o grupo não aparece a quem não está nele, nem no mapa. Só entra quem um administrador adiciona.</li>
          <li><b>Privado, visível no mapa</b>: o grupo aparece em «À tua volta». Quem não está no grupo vê o nome, a capa, a foto de perfil, o tipo, a descrição, o plano (destino ou local e datas) e o número de membros, e pode pedir para entrar. Um administrador aceita ou recusa.</li>
          <li><b>Público</b>: o grupo aparece em «À tua volta» com os mesmos dados e qualquer pessoa com conta entra logo, sem aprovação. Os administradores são avisados de quem entrou.</li>
          <li>Em todos os modos, a conversa, as sondagens, a lista, as despesas, o álbum, o cofre e a lista de membros só os veem os membros. Mas <b>quem entra, seja como for, vê o que já foi partilhado no grupo</b>: mensagens, fotos do álbum e despesas de antes de entrar. Os administradores podem mudar o modo quando quiserem, e o modo aparece nos detalhes do grupo. Num grupo visível no mapa ou público, escreve a contar que pessoas que ainda não conheces podem vir a ler.</li>
          <li><b>O sítio no mapa</b>: para aparecer em «À tua volta», o grupo precisa de um sítio: um local do Txillapp que esteja no mapa ou um ponto marcado no mapa por um administrador. Um ponto marcado fica guardado só de forma aproximada (cerca de 1,5 km), nunca o ponto exato, com um nome do sítio se o administrador quiser. Quem vê o grupo no mapa vê essa zona e esse nome, nunca onde estão os membros. Quando as datas do plano já passaram, o grupo deixa de aparecer no mapa.</li>
          <li><b>Pedidos para entrar</b>: os administradores veem quem pediu (nome, @ e foto) e quando. Podes cancelar o teu pedido enquanto espera. Se for aceite, recebes uma notificação; se for recusado, não és avisado. Se o grupo voltar a privado, os pedidos à espera são recusados.</li>
          <li><b>Quem te pode adicionar</b>: só quem te pode enviar mensagens (Definições → «Quem pode enviar-me mensagens») ou quem já tem conversa contigo, e nunca quem está bloqueado.</li>
          <li><b>Bloqueios</b>: se houver um bloqueio, em qualquer sentido, entre ti e alguém que está num grupo (ou quem o criou), esse grupo não te aparece de fora e não podes pedir nem entrar. Um pedido teu que estava à espera deixa de aparecer aos administradores. Bloquear não tira ninguém de um grupo onde já estejam os dois: se não quiseres estar com essa pessoa, podes sair.</li>
          <li>Os <b>administradores</b> adicionam e tiram pessoas, mudam o nome, a capa, a foto, a descrição e o modo, respondem aos pedidos e gerem o cofre (as regras do cofre estão no ponto 5). Podem tornar outro membro administrador (a pessoa é avisada) e retirar esse papel (sem aviso). O grupo tem sempre pelo menos um administrador: se o último sair, o membro mais antigo passa a administrador.</li>
          <li>Num grupo visível no mapa ou público, o nome, a capa, a foto e a descrição são vistos por quem não está no grupo. Os administradores respondem por eles, e valem as regras da malta (ponto 4).</li>
          <li>As <b>despesas</b> são só contas em meticais, para saber quem deve quanto a quem. O Txillapp não mexe nesse dinheiro nem garante pagamentos entre membros.</li>
          <li>As regras da malta (ponto 4) valem também nos TxillGroups. Podes denunciar mensagens e sair de um grupo quando quiseres.</li>
        </ul>
      </section>
      <section>
        <h2>10. Locais</h2>
        <ul>
          <li>Quem tem um bar, restaurante, discoteca, café, hotel ou evento pode criar a página do local. Só cria a página de um sítio que é teu ou que estás autorizado a representar. Quem cria é o <b>dono</b>, aparece na página e responde por ela.</li>
          <li>Cada página nova fica <b>em análise</b> até a equipa do Txillapp a aprovar. Até lá só o dono e os gestores a veem: não aparece na pesquisa nem no mapa, não recebe pagamentos nem check-ins e não publica como o local. Se a equipa não aprovar, diz o motivo; depois de corrigires, a página volta a ser analisada. A equipa pode retirar uma página que deixe de cumprir estas regras.</li>
          <li>O dono pode convidar <b>gestores</b>: o <b>administrador</b> edita a página e gere os gestores; o <b>editor</b> publica como o local e anuncia eventos. O convite chega por notificação e só vale depois de aceite.</li>
          <li>As publicações feitas como o local aparecem só com o nome e o logótipo do local: quem vê não sabe que gestor publicou. O Txillapp guarda qual foi, e quem publica responde pelo que publica, como numa publicação sua.</li>
          <li><b>Onde fica</b>: ao criar ou editar a página (e ao anunciar um evento, se o local ainda não tiver sítio), procuras o local pelo nome ou pela rua, ajustas o pino no mapa ou usas a tua localização. Marca o sítio verdadeiro do local: não ponhas o pino na casa de alguém nem noutro negócio. O ponto que gravas é público e aparece no mapa de «À tua volta», em «perto de mim» e na página do local, com «Como chegar».</li>
          <li><b>Mostrar no mapa</b> vem ligado de origem e só o dono e os administradores o mudam. Desligado, o local, os seus eventos e as publicações feitas como o local deixam de aparecer no mapa e em «perto de mim», as publicações feitas como o local (também as antigas) deixam de mostrar a posição, e só quem gere a página vê o ponto. A página continua a aparecer na pesquisa pelo nome, com a morada que escreveste.</li>
          <li><b>Eventos</b>: o dono e os gestores podem anunciar eventos (até um ano à frente, cada um com 14 dias no máximo). Aparecem na página do local e, se o local estiver no mapa, em «À tua volta». Qualquer pessoa pode marcar «Tenho interesse»: conta para o total e serve para te lembrares; ninguém é avisado.</li>
          <li><b>Txills</b>: o dono e os administradores escolhem se o local aceita Txills. Os pagamentos recebidos (quem pagou, quanto e a nota) e o saldo do local só os veem o dono e os gestores.</li>
          <li>Seguir um local põe as publicações da página no teu feed. No painel do local, os gestores veem totais (seguidores, check-ins, brindes, comentários), nunca quem segue nem quem fez check-in.</li>
          <li>Se o dono eliminar a conta, a página passa para o administrador mais antigo; se não houver administrador, deixa de aparecer.</li>
          <li>O selo de um local é dado pela equipa. Podemos retirar páginas falsas, duplicadas ou que se façam passar por outro negócio.</li>
        </ul>
      </section>
      <section>
        <h2>11. À tua volta</h2>
        <ul>
          <li>Em Pesquisa → «À tua volta» vês num mapa os locais, os eventos, as publicações recentes (das últimas 48 horas) com sítio e os TxillGroups visíveis no mapa ou públicos, num raio de 5 a 30 km. Para isso a app pede a tua localização, ou escolhes uma cidade. A posição é arredondada (cerca de 1 km) antes de sair do aparelho e não fica guardada. Com o mapa aberto, a posição atualiza-se quando voltas à app ou ao mapa e de 5 em 5 minutos.</li>
          <li>Os locais aparecem no ponto que quem os gere marcou. Os locais que foram tirados do mapa (ver ponto 10), os seus eventos e as publicações feitas como eles não aparecem, nem os locais que ficaram sem dono porque a conta foi eliminada, nem os eventos deles. No filtro «Tudo» vês os eventos da semana; em «Eventos» escolhes o período.</li>
          <li>As publicações aparecem na posição do sítio arredondada (cerca de 1 km), ou no ponto do local se foram feitas como um local que está no mapa. As tuas próprias publicações não te aparecem aqui; os teus locais e os teus eventos sim.</li>
          <li>Um TxillGroup aparece no sítio do grupo (um local do Txillapp ou uma zona aproximada de cerca de 1,5 km, ver ponto 9), nunca na posição de quem está nele. Grupos onde está alguém com quem tens um bloqueio não te aparecem.</li>
          <li><b>Aparecer no mapa</b> está desligado de origem e só é possível a partir dos 18 anos. Se o ligares, no mapa ou em Definições, escolhes quem te vê: <b>amigos mútuos</b> ou <b>quem eu sigo</b>. Só te veem adultos, e nunca quem está bloqueado.</li>
          <li>Quem te vê só vê a zona aproximada (uma quadrícula de cerca de 1,5 km) e há quanto tempo lá estavas, nunca o sítio exato. A zona só se atualiza enquanto tens o mapa aberto e só com a localização do telemóvel: com uma cidade escolhida não apareces. Sais do mapa ao fim de 3 horas, e logo que desligas a opção, escolhes uma cidade, terminas a sessão ou a app dá conta de que lhe tiraste a autorização de localização (com o mapa aberto ou quando o voltas a abrir).</li>
          <li>Não uses o mapa para seguir, vigiar ou ir atrás de ninguém (ver ponto 4).</li>
        </ul>
      </section>
      <section>
        <h2>12. Denúncias e moderação</h2>
        <p>O que é claramente uma ameaça, incentivo ao suicídio ou ódio contra um grupo de pessoas é recusado automaticamente antes de ser publicado ou enviado. Podes denunciar publicações, comentários, mensagens e contas. Analisamos as denúncias e podemos remover conteúdo ou suspender contas que violem estes termos. Podes bloquear qualquer pessoa a qualquer momento.</p>
      </section>
      <section>
        <h2>13. Terminar a conta</h2>
        <p>Podes eliminar a tua conta em Definições → «Eliminar conta». Isto não se desfaz. O teu perfil, publicações, mimos, conversas, chamadas, seguidores e os outros dados pessoais são apagados ou anonimizados, como explicado na Política de Privacidade. Sais dos teus TxillGroups (se eras o último administrador, o membro mais antigo passa a administrador, e o cofre de um grupo que fique vazio é devolvido), os teus pedidos para entrar em grupos são apagados, e as páginas de locais que criaste passam para o administrador mais antigo ou deixam de aparecer. Podemos suspender ou encerrar contas que violem estes termos.</p>
      </section>
      <section>
        <h2>14. Sem garantias absolutas</h2>
        <p>Este serviço é fornecido «como está» e pode ter interrupções ou erros. Na medida permitida pela lei, não nos responsabilizamos por perdas indiretas resultantes do uso do serviço ou de conteúdo publicado por outras pessoas.</p>
      </section>
      <section>
        <h2>15. Alterações</h2>
        <p>Se mudarmos estes termos de forma relevante, avisamos-te na app e pedimos-te para aceitar de novo.</p>
      </section>
      <section>
        <h2>16. Lei aplicável e contacto</h2>
        <p>Estes termos regem-se pela lei da República de Moçambique. Para qualquer questão sobre o serviço, ajuda ou denúncias, escreve para suporte@txillapp.com.</p>
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
          <li><b>Emails e lembretes:</b> se ainda não confirmaste o email, mandamos-te um lembrete por email (e um aviso no telemóvel, se tiveres as notificações ligadas) ao fim de 1, 3 e 7 dias. Depois paramos.</li>
          <li><b>O que publicas:</b> posts, fotos, vídeos, Tchekas, mimos (com stickers e música), comentários, brindes, mensagens e as pessoas que identificas ou mencionas.</li>
          <li><b>Localização:</b> o <i>nome do sítio</i> que escolheres e, quando o escolhes da lista, a posição <i>desse sítio</i> arredondada a cerca de 1 km (duas casas decimais), para quem toca no nome ver as publicações feitas ali ou perto. É assim que a guardamos, e é só assim que aparece a quem vê a publicação, também nas publicações antigas. A exceção são as publicações feitas como um local que está no mapa: levam o ponto do local, que é público; se o local sair do mapa, deixam de mostrar posição a quem não gere a página. Nunca guardamos a tua posição exata. Para sugerir sítios e locais por perto, o nosso servidor envia a posição arredondada (cerca de 100 metros), ou o texto que procuras, a serviços do OpenStreetMap (Nominatim, Overpass e Photon), sem dizer quem és. Contas de menores de 18 anos não guardam a posição do sítio nem aparecem nas publicações por sítio. Podes tirar o local de uma publicação quando quiseres. Quando escolhes uma foto, a app pode ler no teu aparelho onde ela foi tirada (o GPS da foto), só para te sugerir o sítio; essas coordenadas não são enviadas tal como estão. Os mapas usam os mosaicos do OpenStreetMap. Todos os mapas da app (incluindo o mapa pequeno de uma localização partilhada numa conversa) descarregam-nos do servidor do Txillapp, que os vai buscar ao OpenStreetMap sem dizer quem és: o teu aparelho não fala diretamente com o OpenStreetMap.</li>
          <li><b>Onde fica um local:</b> ao criar ou editar um local, ou ao anunciar um evento, o campo «Onde fica?» procura o sítio pelo nome ou pela rua. O nosso servidor envia o texto que escreves ao Photon (OpenStreetMap), sem dizer quem és; se a app já tiver autorização para a localização, junta a tua posição arredondada (cerca de 1 km), só para pôr primeiro os sítios mais perto. Quando escolhes um sítio, arrastas o pino ou tocas em «Usar a minha localização», o nosso servidor pede a morada desse ponto ao Nominatim (OpenStreetMap), com a posição arredondada a cerca de 11 metros; essa posição não é guardada nem escrita nos registos. «Usar a minha localização» explica para que serve antes de pedir a autorização e só serve para pôr o pino. Quando gravas, guardamos o ponto do local tal como o marcaste: se usaste a tua localização, é onde estavas nesse momento. Esse ponto é público (ver «Locais», em baixo).</li>
          <li><b>À tua volta:</b> para mostrar o que há perto, a app envia a tua posição arredondada (cerca de 1 km). Ela só serve para esse pedido: não é guardada nem escrita nos registos. Se ligares <b>Aparecer no mapa</b> (só a partir dos 18 anos; de origem está desligado), guardamos a tua escolha (amigos mútuos ou quem eu sigo) e, enquanto tens o mapa aberto com a localização do telemóvel (não com uma cidade escolhida), só a quadrícula de cerca de 1,5 km onde estás e a hora. A posição atualiza-se quando voltas à app ou ao mapa e de 5 em 5 minutos com o mapa aberto. Essa presença é apagada ao fim de 3 horas, e logo que desligas a opção, escolhes uma cidade, terminas a sessão ou a app dá conta de que lhe tiraste a autorização de localização (com o mapa aberto ou quando o voltas a abrir). No mapa aparecem também publicações de outras pessoas das últimas 48 horas que têm a posição do sítio (só as que já podias ver), na posição arredondada descrita em cima; as tuas não te aparecem.</li>
          <li><b>Check-ins:</b> ao ler o QR de um local, registamos o check-in só para contar quantas pessoas lá estiveram. O número é público; quem fez check-in não é mostrado a ninguém. Cada pessoa faz no máximo um check-in por local de 6 em 6 horas.</li>
          <li><b>Segurança:</b> sessões e dispositivos com sessão iniciada (tipo de browser, datas de acesso) e registos de ações sensíveis.</li>
          <li><b>Carteira:</b> o teu saldo de Txills e os movimentos (bónus de boas-vindas, prémios de convites, recargas, presentes enviados e recebidos, o que puseste em cofres de TxillGroups, devoluções e pagamentos a locais, com a nota que deixaste).</li>
          <li><b>TxillGroups:</b> o nome, o tipo, a descrição, a capa, a foto de perfil, o modo (privado, visível no mapa ou público) e o plano do grupo, quem é membro e quem administra, quem vai (vou, talvez, não vou), as sondagens e os votos, a lista do que levar ou fazer, as despesas e a parte de cada um, as fotos do álbum e os movimentos do cofre (quem pôs quanto, pagamentos e devoluções). Para o grupo aparecer no mapa, guardamos o sítio do grupo: um local do Txillapp que esteja no mapa, ou um ponto marcado por um administrador, guardado só de forma aproximada (cerca de 1,5 km) e nunca o ponto exato, com o nome do sítio se o administrador o escrever. Se pedires para entrar num grupo, guardamos o pedido e a hora. O que fica visível a quem não está no grupo está no ponto 3.</li>
          <li><b>Lista de conversas:</b> se apagares uma conversa ou a marcares como por ler, guardamos isso só do teu lado. Apagar tira as mensagens da tua lista; do lado da outra pessoa ficam.</li>
          <li><b>Pagamentos:</b> se recarregares Txills, guardamos o pedido (pacote, valor, método de pagamento, estado e datas) e só os últimos 3 dígitos do teu telemóvel. Os dados completos do pagamento ficam com o fornecedor (M-Pesa, e-Mola ou cartão) e nós não os guardamos.</li>
          <li><b>Contactos:</b> só se usares «Amigos nos contactos». Os contactos ficam no teu telemóvel; enviamos apenas um resumo cifrado (SHA-256) dos emails, só para ver quem já está no Txillapp, e não guardamos nem os resumos nem os contactos. Podes não ser encontrado por esta via em Definições → «Deixar que me encontrem pelos contactos».</li>
          <li><b>Geleira:</b> os gostos que juntas (vibes, bebidas, comidas e sítios), com notas e favoritos, e o nível calculado a partir deles e do teu saldo de Txills.</li>
          <li><b>Presença:</b> se estás online ou a escrever um comentário (só enquanto a app está aberta) e a hora da última vez que estiveste online.</li>
          <li><b>Verificação:</b> se pedires o selo, o teu nome, a prova que indicares, o tipo de documento, a foto do documento (frente e, quando tem, verso), uma foto da tua cara tirada com a câmara e uma selfie com o documento (apagados logo que há decisão).</li>
          <li><b>Localização em direto:</b> se a partilhares numa conversa, a tua posição vai-se atualizando só enquanto a app está aberta e durante o tempo que escolheste.</li>
          <li><b>Utilização:</b> aberturas da app, ecrãs vistos, desempenho e erros. São estatísticas nossas, sem terceiros, e podes desligá-las em Definições → «Ajudar a melhorar o Txillapp». Também guardamos o que já viste no feed, para não repetir sempre o mesmo, e as preferências com que afinas o Explorar e as Tchekas (temas, contas de que queres ver mais ou menos, «interessa-me» ou «não me interessa»).</li>
          <li><b>Zás:</b> a foto, a legenda, para quem a enviaste (Amigos ou Próximos), a hora, quem a viu e como reagiu. Uma miniatura minúscula e desfocada (24×32 pontos) serve só para o atalho. Duram 24 horas.</li>
          <li><b>Notificações:</b> se as ativares, guardamos o identificador do teu aparelho para as enviar. Na app Android e no iPhone passam pelo Firebase Cloud Messaging, da Google; no browser, pelo serviço de notificações do próprio browser. O texto nunca mostra o conteúdo das mensagens nem qual foi a reação. Quando alguém te liga, o aviso mostra o nome de quem liga e se é chamada de voz ou de vídeo. Podes desligá-las quando quiseres.</li>
          <li><b>Reações a mensagens:</b> a reação que deixas e quem a deixou, visíveis para quem está na conversa.</li>
          <li><b>SuperTxill:</b> as perguntas que fazes ao SuperTxill (e só essas) são enviadas ao nosso fornecedor de inteligência artificial, a Anthropic, para gerar a resposta. Ficam guardadas na tua conta, só para ti, e podes apagá-las no próprio SuperTxill. Contam para o limite diário. O SuperTxill não lê as tuas conversas nem os dados de ninguém.</li>
          <li><b>Convites:</b> o teu código, quem convidaste e em que estado está cada convite. Guardamos também uma impressão da rede de quem se regista com um convite (nunca o endereço em si), só para detetar registos em massa.</li>
          <li><b>Fotos e vídeos:</b> são verificados automaticamente no nosso servidor (nudez e conteúdo sexual) antes de ficarem visíveis. Nada é enviado a terceiros. Antes de guardarmos uma foto, o servidor tira-lhe os metadados escondidos (EXIF), como a localização GPS, o modelo do aparelho e a data, para não chegarem a quem a vê.</li>
          <li><b>Câmara e editor:</b> a câmara só está ligada enquanto a tens aberta. Os filtros e ajustes (luz, cor, nitidez e outros) são aplicados no teu aparelho; só é enviada a foto ou o vídeo final que escolhes publicar ou enviar. Guardar na galeria só acontece quando tocas em Guardar.</li>
          <li><b>Chamadas:</b> guardamos o registo de cada chamada: quem ligou a quem, se foi de voz ou de vídeo, como acabou (atendida, perdida, recusada, cancelada) e quando começou e acabou. O som e a imagem vão diretamente de um aparelho para o outro, cifrados (WebRTC), e nunca passam pelos nossos servidores nem são gravados. Para os dois aparelhos se encontrarem, a app usa servidores STUN da Google, que veem o endereço de rede do teu aparelho. Quando a ligação direta não é possível, ou se ligares «Esconder o meu IP nas chamadas», a chamada passa pelo servidor de retransmissão (TURN) do Txillapp, que só encaminha os dados cifrados e não os grava; com essa opção, a outra pessoa não fica a conhecer o teu endereço de rede. Numa ligação direta, o aparelho da outra pessoa fica a conhecer o teu endereço de rede, como em qualquer chamada pela internet. Guardamos também essa escolha. Podes apagar chamadas do teu histórico (o registo desaparece de vez quando as duas pessoas o apagam), e as chamadas com mais de 12 meses são apagadas sozinhas.</li>
          <li><b>Locais:</b> se criares ou gerires a página de um local, guardamos o teu papel (dono, administrador ou editor) e quem te convidou, e qual gestor fez cada publicação do local (quem vê a publicação só vê o local, nunca o gestor). Os dados da página (nome, morada, horário, telefone, WhatsApp, site, fotos), o ponto no mapa, os eventos anunciados e se aceita Txills são públicos, e o dono aparece na página. O ponto aparece no mapa de «À tua volta», em «perto de mim» e num mapa pequeno com «Como chegar» na página; se o dono ou um administrador desligar «Mostrar no mapa», fica guardado mas só quem gere a página o vê, o local, os seus eventos e as publicações feitas como ele saem do mapa, e as publicações feitas como o local, também as antigas, deixam de mostrar a posição. Guardamos também os locais que segues e os eventos em que marcaste «Tenho interesse»; os gestores só veem os totais. Se pagares a um local com Txills, o dono e os gestores veem o teu nome, o @, o valor, a nota e a hora.</li>
          <li><b>Música:</b> as faixas que marcas como favoritas. As pesquisas de música são feitas pelo nosso servidor no Openverse. A faixa toca diretamente do sítio onde está alojada (por exemplo, o Free Music Archive, o ccMixter, o Pixabay ou o Internet Archive), que vê o endereço de rede do teu aparelho, como qualquer site.</li>
        </ul>
      </section>
      <section>
        <h2>2. Para que usamos</h2>
        <p>Para fazer o serviço funcionar, mostrar o teu conteúdo a quem escolheste, manter a conta segura, prevenir abuso e analisar denúncias. Não vendemos os teus dados.</p>
      </section>
      <section>
        <h2>3. Quem vê o quê</h2>
        <p>Tu controlas: perfil público ou privado, quem comenta, menciona, presenteia, te envia mensagens ou te liga (por omissão, só amigos mútuos), quem vê os teus seguidores e quem repostou, brindou ou presenteou. O género escolhe-se ao criar a conta e <b>não se altera</b>; só aparece no perfil se tu quiseres. As mensagens diretas e o registo das chamadas só são visíveis para as duas pessoas da conversa. O que se passa num <b>TxillGroup</b> (conversa, sondagens, lista, álbum, despesas, cofre e lista de membros) só o veem os membros, e quem entra num grupo vê também o que lá foi partilhado antes de entrar. Se um administrador puser o grupo visível no mapa ou público, quem tem conta vê de fora o nome, a capa, a foto de perfil, o tipo, a descrição, o plano (destino ou local e datas), o sítio do grupo no mapa e o número de membros, nunca quem são. Quando pedes para entrar, os administradores do grupo veem o teu nome, o @ e a foto. Quem tem um bloqueio contigo ou com qualquer membro não vê o grupo de fora. Um pagamento a um local vês tu e quem gere o local. O ponto de um local no mapa é público, a não ser que quem o gere desligue «Mostrar no mapa». No mapa <b>À tua volta</b> só apareces se o ligares, só para quem escolheste e só pela zona aproximada. As <b>notas</b> só as veem os teus seguidores. A <b>geleira</b> e o seu nível veem-nos só quem escolheres. Quem não tem conta e abre um link de uma publicação <b>pública</b> vê só uma pré-visualização dela (sem comentários nem ações); publicações de contas privadas, apagadas ou de quem te bloqueou nunca aparecem. Redes como o WhatsApp podem mostrar um cartão com o nome, o texto e a foto de uma publicação pública quando alguém cola o link.</p>
      </section>
      <section>
        <h2>4. Presença online e a escrever</h2>
        <p>O Txillapp mostra quando uma pessoa está <b>online</b> (com a app aberta) e, nos comentários de um post, quando alguém está <b>a escrever</b>. No chat mostra também «Visto há…». Isto só vale entre quem mostra a presença: se desligares «Mostrar quando estou online» nas Definições, ninguém te vê online ou a escrever, e tu também deixas de ver os outros. Quem tem a conta bloqueada nunca te vê. A presença só existe enquanto a app está aberta; só guardamos a hora da última vez que estiveste online.</p>
      </section>
      <section>
        <h2>5. Geleira e pontuação</h2>
        <p>Guardamos os gostos que juntas à tua geleira, as notas e os favoritos. Com eles, e com o teu saldo de Txills, calculamos o <b>nível</b> da geleira. A data de nascimento é usada para três coisas, nunca para mostrar: validar a idade mínima, esconder bebidas com álcool a menores de 18 anos e escolher o título do nível mais alto. Tu escolhes quem vê a geleira (todos, seguidores, amigos próximos ou só tu); quando ela não é visível para alguém, o nível também não é. Guardamos também quem brindou a tua geleira: por omissão só tu vês quem foi; se ligares «Mostrar quem brindou a minha geleira», quem vê a geleira vê também essa lista. Como o saldo de Txills conta para o nível, uma geleira visível pode revelar de forma aproximada quanto tens.</p>
      </section>
      <section>
        <h2>6. Verificação de identidade</h2>
        <p>Se pedires o selo de verificado, recolhemos o teu nome, a prova que indicares, uma foto de um documento de identificação e uma selfie. Estes ficheiros são <b>privados</b>: só a moderação os vê, só para decidir o pedido, e são <b>apagados logo que há decisão</b> (aprovar, recusar) ou quando retiras o pedido. Guardamos o resultado (se tens o selo, o tipo de selo e, numa recusa, o motivo) e as datas, para não repetir pedidos e para prevenir abuso. Os documentos nunca são mostrados a outras pessoas nem usados para outra coisa.</p>
      </section>
      <section>
        <h2>7. Cookies e armazenamento</h2>
        <p>Usamos apenas o essencial: um cookie de sessão seguro (para manteres a sessão iniciada) e armazenamento local no teu aparelho (por exemplo, vários rascunhos de publicações, e se silenciaste a música). Não usamos cookies de publicidade.</p>
      </section>
      <section>
        <h2>8. Quanto tempo guardamos</h2>
        <p>Enquanto a conta existir, com estas exceções: o registo das chamadas é apagado ao fim de 12 meses (ou antes, quando as duas pessoas o apagam); a tua presença no mapa «À tua volta» é apagada ao fim de 3 horas (ou antes, ver ponto 1), e nunca guardamos a posição com que consultas o mapa ou procuras um sítio, nem a do ponto de que pedes a morada. Um pedido para entrar num TxillGroup fica guardado até um administrador o aceitar ou recusar, até o cancelares, até o grupo voltar a privado ou até eliminares a conta. Quando a última pessoa sai de um TxillGroup, o cofre é devolvido e o grupo é apagado, com a conversa, o plano, as sondagens, a lista e as despesas. Ao eliminares a conta, apagamos o perfil, as publicações e as fotos, os mimos, as conversas a dois, as chamadas, os seguidores e quem segues, as notificações, os aparelhos com notificações, as músicas favoritas, os check-ins, os locais que segues e os teus papéis de gestor, as respostas e os votos nos TxillGroups, os pedidos para entrar em TxillGroups, os interesses em eventos e tudo o que é do mapa; o nome, o @, o email e a foto deixam de existir e a conta passa a «Conta eliminada». Sais dos TxillGroups, e as páginas de locais que criaste passam para o administrador mais antigo ou deixam de aparecer. Os comentários que deixaste em publicações de outras pessoas e as mensagens que enviaste em TxillGroups podem continuar visíveis para elas, assinados como «Conta eliminada». Os movimentos de Txills e os pedidos de recarga ficam registados, sem dados pessoais, para as contas baterem certo e para prevenir fraude. Alguns registos de segurança podem ser mantidos por um período limitado para prevenir abuso. Mimos, notas e Zás deixam de aparecer ao fim de 24 horas. O conteúdo de visualização única (incluindo fotos e vídeos) é apagado do servidor em poucos minutos depois de aberto, e os ficheiros de mensagens apagadas são apagados na hora. Os documentos de uma verificação são apagados logo que há decisão.</p>
      </section>
      <section>
        <h2>9. Os teus direitos</h2>
        <ul>
          <li><b>Aceder e levar contigo:</b> Definições → «Descarregar os meus dados» (inclui também as chamadas, os locais (nos que criaste, também a morada, a cidade, o ponto no mapa e se aparecem no mapa), os eventos, as definições do mapa e, dos TxillGroups, as tuas respostas ao plano, votos, tarefas, despesas, o que puseste nos cofres e os pedidos para entrar que estão à espera).</li>
          <li><b>Apagar partes:</b> podes apagar chamadas do histórico, conversas do teu lado, publicações, mimos e conversas com o SuperTxill, cancelar um pedido para entrar num TxillGroup, sair de um grupo, e desligar «Aparecer no mapa» quando quiseres.</li>
          <li><b>Corrigir:</b> edita o teu perfil a qualquer momento.</li>
          <li><b>Apagar:</b> Definições → «Eliminar conta».</li>
          <li><b>Retirar permissões:</b> podes desligar a localização (sem ela, não aparecem sugestões de sítios perto de ti, procuras os sítios pelo nome ou marcas no mapa, e em «À tua volta» escolhes uma cidade e não apareces à malta), a câmara, o microfone, o acesso às fotos e as notificações nas definições do telemóvel ou do browser. Sem câmara e microfone não há chamadas.</li>
        </ul>
      </section>
      <section>
        <h2>10. Crianças</h2>
        <p>O Txillapp não é para menores de 15 anos. Se descobrirmos uma conta abaixo dessa idade, removemo-la.</p>
      </section>
      <section>
        <h2>11. Quem trata os teus dados</h2>
        <p>Os dados são tratados pelo Txillapp e guardados em servidores de fornecedores de alojamento e de rede (por exemplo, o armazenamento das fotos e vídeos e a proteção do site), que só os processam para nós. Outros serviços recebem só o necessário: se entrares com a Google ou com a Apple, recebemos o teu nome e email dessa conta; as notificações no telemóvel passam pelo Firebase Cloud Messaging (Google); as chamadas usam servidores STUN da Google (a retransmissão TURN é nossa); os pagamentos ficam com o fornecedor que escolheres (M-Pesa, e-Mola ou cartão); as perguntas ao SuperTxill vão para a Anthropic; as pesquisas de música vão para o Openverse; os mapas, a pesquisa de sítios e a morada de um ponto marcado no mapa usam serviços do OpenStreetMap (mosaicos, Nominatim, Overpass e Photon), sempre através do nosso servidor (ver ponto 1); e «Como chegar» abre o Google Maps ou o Apple Maps (na app ou no browser) só com o destino. Não partilhamos dados com ninguém para publicidade.</p>
      </section>
      <section>
        <h2>12. Contacto</h2>
        <p>Para exercer os teus direitos, pedir ajuda ou esclarecer dúvidas sobre os teus dados, escreve para privacidade@txillapp.com. Respondemos o mais depressa possível.</p>
      </section>
    </Page>
  );
}
