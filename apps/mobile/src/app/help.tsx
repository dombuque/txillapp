import Constants from 'expo-constants';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Group, Line } from '@/components/Lines';
import { StackPage } from '@/components/StackPage';
import { normalize } from '@/lib/settingsIndex';
import { colors } from '@/lib/theme';

const SUPPORT = 'suporte@txillapp.com';

const FAQ: { q: string; a: string }[] = [
  { q: 'O que são os Txills?', a: 'São a moeda do Txillapp. Hoje servem para acumular e presentear quem segues (agradecer um bom post, retribuir um mimo, mandar "duas" ao teu bro), juntar no cofre de um TxillGroup e pagar nos locais que aceitam Txills. Em breve vão pagar vibes. Não se trocam por dinheiro.' },
  { q: 'Como ganho Txills?', a: 'Ao criar a conta recebes 500 Txills de boas-vindas. Cada amigo que entra com o teu convite recebe logo 50 Txills, e tu recebes 50 quando ele fica ativo e continua por cá 7 dias (até 5 por dia e 50 no total). Também podes recarregar em Definições, Txills e pagamentos, "Pedidos e pagamentos".' },
  { q: 'Como faço uma chamada?', a: 'Abre a conversa com a pessoa e toca no telefone (voz) ou na câmara (vídeo), ou liga outra vez a partir de Chamadas. O teu email tem de estar confirmado. O som e a imagem vão cifrados de um telemóvel para o outro e o Txillapp não grava chamadas; fica só o registo na conversa e em Chamadas.' },
  { q: 'Como apago chamadas ou conversas?', a: 'Em Chamadas, desliza uma chamada para a apagar, ou toca em Limpar para apagar todas. Na lista de mensagens, desliza uma conversa para a apagar ou marcar como lida ou por ler. Também podes segurar a conversa: abre uma folha com marcar como lida ou por ler, ver o perfil e apagar a conversa (num TxillGroup, marcar como lido, info do grupo e sair do grupo). No computador, passa o rato por cima da linha ou usa o botão direito. Apagar tira a conversa só da tua lista: do lado da outra pessoa fica. As chamadas com mais de 12 meses saem sozinhas.' },
  { q: 'Como apago uma mensagem?', a: 'Segura a mensagem e toca em Apagar. "Apagar para mim" tira-a só da tua conversa, em qualquer mensagem: os outros continuam a vê-la. "Apagar para todos" aparece nas tuas, a qualquer altura: apagamos o conteúdo e fica "Esta mensagem foi apagada". Quem recebeu pode já a ter lido. Funciona também nos TxillGroups.' },
  { q: 'Posso editar uma mensagem?', a: 'Sim, as tuas mensagens de texto, até 15 minutos depois de as enviares (não as de visualização única). Segura a mensagem e toca em Editar. Aparece "editada" ao lado da hora, os outros passam a ver só a versão nova e não guardamos a anterior. No mesmo menu, Copiar copia o texto.' },
  { q: 'Como envio um GIF?', a: 'Numa conversa, num TxillGroup ou nos comentários, toca nos stickers e escolhe o separador GIF. Procura ou escolhe um dos que estão em alta e toca para enviar. Os GIFs vêm do GIPHY: a pesquisa passa pelo servidor do Txillapp e o GIPHY não fica a saber quem és, mas as imagens vêm diretamente do GIPHY, que vê o endereço de rede de quem as vê. Guardamos só a ligação ao GIF, não a imagem. Abaixo dos 18 anos (ou sem data de nascimento na conta) só aparecem GIFs para todas as idades. Com "Reduzir movimento" ligado no telemóvel, os GIFs aparecem parados. "Apagar para todos" também apaga um GIF.' },
  { q: 'Posso colar uma imagem no chat?', a: 'No site, sim: cola (Ctrl+V ou Colar) ou arrasta uma imagem para a caixa de mensagem, numa conversa ou num TxillGroup. Abre-se uma pré-visualização e só é enviada quando tocas em Enviar; Cancelar deita-a fora. GIFs colados não dão: usa o separador GIF. Na app do telemóvel, usa o + para escolher a foto.' },
  { q: 'Uso o Txillapp em mais de um aparelho. As conversas ficam iguais?', a: 'Sim. O que envias, editas, apagas ou lês num aparelho aparece logo nos outros onde tens a sessão iniciada, sem som nem aviso.' },
  { q: 'Como envio a minha localização?', a: 'Na conversa, toca no + e em Localização. Escolhe a tua localização atual (vês a precisão), arrasta o mapa até ao ponto que queres, ou escolhe um sítio em "Sítios perto" ou na pesquisa. Nada é enviado sem tocares em Enviar. A mensagem leva o ponto exato (e, num sítio, o nome e a morada), que quem está na conversa vê. Num TxillGroup, todos os membros veem, também os que entrarem depois.' },
  { q: 'Como funciona a localização em direto?', a: 'Só nas conversas a dois. Em Localização, toca em "Partilhar localização em direto", escolhe 15 minutos, 1 hora ou 8 horas e confirma. A posição atualiza-se mais ou menos de 20 em 20 segundos enquanto o Txillapp está aberto: em segundo plano ou com a app fechada, não. Toca em Parar na mensagem para acabar antes do tempo. No fim, a mensagem fica só "Partilha em direto terminada", sem mapa.' },
  { q: 'Posso esconder o meu IP nas chamadas?', a: 'Sim. Em Definições, Mensagens e chamadas, "Esconder o meu IP nas chamadas" (aparece quando o servidor de chamadas está ligado). A chamada passa sempre pelo servidor do Txillapp e quem está do outro lado não vê o teu endereço. Pode ficar um pouco mais lenta.' },
  { q: 'O que é um TxillGroup?', a: 'Um grupo para combinar a saída com a malta: viagem, festa ou fim de semana. Tem o plano (onde, quando e quem vai), sondagens, a lista do que levar, despesas para saber quem deve a quem, um álbum e um cofre de Txills. Cabem até 50 pessoas. A conversa e o resto só os veem os membros.' },
  { q: 'Quem vê o meu TxillGroup?', a: 'Depende do modo, que um administrador escolhe nos detalhes do grupo, em "Quem vê e quem entra". Privado (de origem): ninguém de fora o vê e só entra quem um administrador adiciona. Privado, visível no mapa: aparece em À tua volta com o nome, a capa, a foto, o tipo, a descrição, o plano e o número de membros, e quem quiser entrar pede. Público: aparece no mapa e qualquer pessoa entra logo. Atenção: quem entra vê o que já foi partilhado no grupo, incluindo mensagens, fotos e despesas antigas.' },
  { q: 'Onde aparece o grupo no mapa?', a: 'No sítio do grupo: um local do Txillapp que esteja no mapa, ou um ponto que um administrador marca no mapa, com um nome se quiser. O ponto marcado fica guardado só aproximado (cerca de 1,5 km), nunca o sítio exato. Nunca aparece onde estão os membros. Depois das datas do plano, o grupo sai do mapa.' },
  { q: 'Como entro num TxillGroup que vi no mapa?', a: 'Abre o grupo e toca em "Entrar no grupo" (grupo público) ou "Pedir para entrar" (grupo privado, visível no mapa). Os administradores veem o teu nome, o @ e a foto. Se aceitarem, recebes uma notificação; se recusarem, não és avisado. Podes cancelar o pedido enquanto espera. Se tens um bloqueio com alguém do grupo, o grupo não te aparece.' },
  { q: 'Como faço alguém administrador do grupo?', a: 'Nos detalhes do grupo, na lista de pessoas, toca na pessoa e escolhe "Tornar administrador". A pessoa é avisada. No mesmo menu podes retirar o papel (sem aviso) ou, na tua linha, "Deixar de ser administrador", desde que fique outro. Se o último administrador sair, o membro mais antigo passa a administrador.' },
  { q: 'Como funciona o cofre do grupo?', a: 'Cada um põe Txills no cofre (de 10 a 100 000 de cada vez). Os administradores pagam ao local com o cofre ou devolvem-no: a devolução vai para quem pôs, na proporção do que cada um meteu. Quem sai do grupo não leva os Txills. Se o grupo acabar, o cofre é devolvido sozinho.' },
  { q: 'Como pago num local com Txills?', a: 'Na página do local, toca em "Pagar com Txills" (só aparece nos locais que aceitam). Escolhe o valor, confirma e recebes um recibo. O pagamento não se desfaz pela app, por isso confirma antes. Quem gere o local vê quem pagou, quanto e a nota.' },
  { q: 'O que é À tua volta?', a: 'Em Pesquisa, "À tua volta" mostra num mapa os locais, os eventos, as publicações recentes e os TxillGroups visíveis no mapa, perto de ti ou da cidade que escolheres. A tua posição vai arredondada (cerca de 1 km) e não fica guardada. Aparecer no mapa para a malta está desligado de origem: liga-o no mapa ou em Definições, Privacidade, "Aparecer em À tua volta" (só a partir dos 18 anos). Só apareces com a localização do telemóvel: com uma cidade escolhida, não. Só se vê a zona aproximada, e sais do mapa ao fim de 3 horas, ou logo que desligas a opção, escolhes uma cidade ou terminas a sessão. As publicações das pessoas aparecem só pela zona aproximada (cerca de 1 km), e as tuas não te aparecem aí.' },
  { q: 'Quem me pode ligar?', a: 'Escolhes tu em Definições, Mensagens e chamadas, "Quem me pode ligar": todos, quem eu sigo, amigos mútuos (de origem) ou ninguém. Quem bloqueaste nunca te liga. Se não atenderes, fica uma chamada perdida nas notificações.' },
  { q: 'Tenho um bar ou restaurante. Como crio a página?', a: 'Em Definições, Conteúdo e o teu algoritmo, "Tenho um local". Crias a página, marcas no mapa onde fica, pões foto, morada e horário, e a equipa do Txillapp aprova-a (até lá só tu e os gestores a veem; recebes uma notificação com a decisão). Podes convidar gestores: o administrador edita tudo e o editor publica como o local. Quem segue o local vê as publicações no feed. Podes anunciar eventos e ligar "Aceitar pagamentos em Txills" para a malta pagar aí. O QR do local serve para a malta fazer check-in.' },
  { q: 'Como ponho o meu local no mapa?', a: 'Ao criar a página, ou em Gerir, em "Onde fica?": escreve o nome ou a rua e escolhe uma sugestão. Depois podes tocar em "Ajustar no mapa" e arrastar até o alfinete ficar na porta, ou em "Usar a minha localização" se estiveres lá (a app explica antes de pedir a autorização). A pesquisa vai pelo servidor do Txillapp até ao OpenStreetMap, sem dizer quem és. O ponto que gravas é público: aparece no À tua volta e na página do local, com "Como chegar" (a não ser que desligues "Mostrar no mapa").' },
  { q: 'Posso tirar o meu local do mapa?', a: 'Sim. Em Gerir, desliga "Mostrar no mapa" (só o dono e os administradores). O local, os eventos e as publicações feitas como o local deixam de aparecer no mapa e em perto de mim, e só quem gere a página vê o ponto. A página continua na pesquisa pelo nome e mostra a morada que escreveste.' },
  { q: 'Como guardo um mimo na galeria?', a: 'Abre o teu mimo e, no menu, toca em "Guardar na galeria". A foto ou o vídeo vai com os stickers e a assinatura do Txillapp com o teu @. Só dá para guardar os teus mimos.' },
  { q: 'De onde vem a música?', a: 'De um catálogo de música de licença aberta (Openverse), com o autor e a licença à vista. Marca as faixas de que gostas como favoritas para as teres à mão. A música de um post toca sozinha quando o post está à vista; podes silenciá-la.' },
  { q: 'Como funcionam os brindes?', a: 'Tocas em "Brindar" num post, numa Tcheka ou num comentário para mostrar que gostaste. É grátis e a pessoa é avisada (quem brinda o que é seu não gera aviso). Os brindes juntam-se num só aviso por publicação ou comentário, como "ana, rui e 3 outros brindaram a tua publicação", e no telemóvel o aviso chega de vez em quando, com a contagem, para não ser chato. Tirar o brinde não apaga o aviso, mas deixa de contar. Para não receberes estes avisos, desliga "Brindes e reações" em Definições, Notificações.' },
  { q: 'Como funciona o convite?', a: 'Em Convites tens o teu código, a ligação e um cartão para partilhar, feito no teu telemóvel com o teu nome, a foto, o código e até 4 itens públicos da tua geleira (nunca bebidas com álcool se tiveres menos de 18 anos). Quem abre a ligação vê o teu nome, o @, a foto e esses itens, mesmo sem conta. Quando alguém entra com o teu código, recebes um aviso. Se já tens o email confirmado e mais de 3 dias de conta, a pessoa recebe logo 50 Txills; tu recebes 50 quando ela fica ativa (publica algo ou segue 3 pessoas) e continua 7 dias. Contas repetidas e registos em massa não contam. Os Txills não valem dinheiro.' },
  { q: 'O que quer dizer "Bombado · Patrocinado"?', a: 'É um destaque pago por um local perto de ti, com os Txills do local, para mostrar um evento ou uma publicação. Leva sempre essa etiqueta e o nome do local. Só aparece a maiores de 18 anos, no máximo 3 vezes por dia o mesmo destaque, e cerca de 1 em cada 11 publicações do feed. Para os escolher usamos a tua zona aproximada (cerca de 1 km) do À tua volta ou a cidade escolhida, sem a guardar. O local só vê totais, nunca quem viu. Se não quiseres ver os destaques de um local, toca em "Não mostrar destaques deste local".' },
  { q: 'Como bombo o meu local?', a: 'Em Gerir, Bombar (só o dono e os administradores, com o local aprovado e no mapa). Escolhe o evento ou a publicação feita como o local, o pacote (1, 3 ou 7 dias) e o raio (1 a 10 km), e paga com os Txills da carteira do local. Se parares, voltam à carteira os dias inteiros que faltam, ou tudo se ainda não começou. A equipa do Txillapp pode suspender um destaque que viole as regras, com ou sem devolução. No relatório vês as vezes mostrado, as pessoas, os toques, os interessados e os check-ins, nunca quem foi.' },
  { q: 'Como presenteio alguém?', a: 'Só podes presentear quem segues. Abre o perfil ou o post e toca em "Presentear". Podes deixar o presente em silêncio, privado ou publicá-lo para toda a gente ver.' },
  { q: 'O que é a geleira?', a: 'A tua vitrine de gostos: vibes, bebidas, comidas e sítios. Edita-a em Editar perfil. Quanto mais paulada tiveres lá, mais sobe de nível. Quem a vê pode brindá-la; por omissão só tu vês quem brindou, mas em Editar perfil podes ligar "Mostrar quem brindou a minha geleira".' },
  { q: 'O que é a visualização única?', a: 'Fotos, vídeos, voz e mensagens que só se abrem uma vez e depois desaparecem do chat. Quem recebe pode, mesmo assim, fotografar o ecrã.' },
  { q: 'Como bloqueio ou denuncio alguém?', a: 'No perfil, toca nos três pontos e escolhe Bloquear. Para denunciar um post, comentário ou conversa, usa o menu dele e escolhe Denunciar. A moderação vê o pedido.' },
  { q: 'Como pedir o selo de verificado?', a: 'Em Definições, Conta, "Pedir o selo de verificado". A conta tem de cumprir alguns requisitos e depois enviamos o pedido com um documento e uma selfie, que a moderação revê. Os documentos são apagados quando há decisão.' },
  { q: 'Quem vê quando estou online?', a: 'Só quem também mostra a presença. Em Definições, Privacidade, "Mostrar quando estou online" desliga isso (e também deixas de ver os outros).' },
  { q: 'Que estatísticas de uso a app envia?', a: 'Com "Ajudar a melhorar o Txillapp" ligado (Definições, Privacidade, Contactos e dados), a app envia-nos, só a nós: as aberturas, os ecrãs vistos (só o nome do ecrã), o tempo de arranque, os erros (uma mensagem curta e limpa de dados pessoais) e as ações que fazes (publicar, comentar, brindar, seguir, repostar, partilhar, enviar mensagens, pesquisar, ver mimos, ligar as notificações), com a plataforma e a versão da app. Nunca o conteúdo nem a posição. Sem internet, até 200 registos esperam no aparelho (no máximo 3 dias). Desligado, ou com "não rastrear" no browser, não enviamos nada e o que estava à espera é apagado.' },
  { q: 'Porque me aparece o aviso das notificações desligadas?', a: 'Porque as notificações estão desligadas neste aparelho e podes perder mensagens e chamadas. Aparece no máximo uma vez por dia e, de cada vez que tocas em "Agora não", espera mais (3, 7, 14 e depois 30 dias). Em Definições, Notificações, há também uma faixa para as ligar. As horas destes avisos ficam só no teu aparelho.' },
  { q: 'Como mudo a privacidade da conta?', a: 'Em Definições, Privacidade: perfil público ou privado, quem comenta e quem te menciona. Quem te envia mensagens e quem te pode ligar está em Definições, Mensagens e chamadas. Também podes procurar qualquer opção em "Procurar nas definições".' },
  { q: 'Esqueci-me da senha. E agora?', a: 'No ecrã de entrada, toca em "Esqueceste a senha?". Enviamos-te um email para criares uma nova.' },
  { q: 'Como elimino a minha conta?', a: 'Em Definições, Conta, "Eliminar conta". Isto não se desfaz: apagamos o perfil, as publicações, as conversas, as chamadas e o resto dos teus dados. Podes descarregar os teus dados antes, no mesmo ecrã.' },
];

/** Ajuda: perguntas frequentes e contacto (igual à do site). */
export default function Help() {
  // A pergunta aberta guarda-se pelo texto (não pela posição na lista): ao procurar, não abre outra pergunta qualquer.
  const [open, setOpen] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  // Sem acentos nem maiúsculas, como em "Procurar nas definições": "notificacoes" encontra "notificações".
  const words = normalize(term).split(/\s+/).filter(Boolean);
  const list = FAQ.filter((f) => { const hay = normalize(`${f.q} ${f.a}`); return words.every((w) => hay.includes(w)); });
  const subject = encodeURIComponent('Problema no Txillapp');
  const body = encodeURIComponent(`\n\n---\nVersão: ${Constants.expoConfig?.version ?? ''}\nAparelho: ${Platform.OS} ${Platform.Version}`);
  return (
    <StackPage title="Ajuda">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View style={st.search}>
            <Icon name="search" size={18} color={colors.zinc500} />
            <TextInput value={term} onChangeText={setTerm} placeholder="Procurar na ajuda" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar na ajuda" autoCorrect={false} returnKeyType="search" style={st.input} />
            {term ? <Pressable onPress={() => setTerm('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa"><Icon name="x" size={16} color={colors.zinc600} /></Pressable> : null}
          </View>
        </View>
        <Group title="Perguntas frequentes">
          {list.length === 0 ? <Text style={st.none}>Nada com essa palavra. Fala connosco, em baixo.</Text> : null}
          {list.map((f) => (
            <View key={f.q}>
              <Pressable onPress={() => setOpen(open === f.q ? null : f.q)} accessibilityRole="button" accessibilityState={{ expanded: open === f.q }} aria-expanded={open === f.q} style={({ pressed }) => [st.q, pressed && { backgroundColor: '#fafafa' }]}>
                <Text style={st.qText}>{f.q}</Text>
                <View style={{ transform: [{ rotate: open === f.q ? '90deg' : '0deg' }] }}><Icon name="chevron-right" size={18} color="#a1a1aa" /></View>
              </Pressable>
              {open === f.q ? <Text style={st.a}>{f.a}</Text> : null}
            </View>
          ))}
        </Group>
        <Group title="Fala connosco">
          <Line icon="mail" label="Contactar o suporte" value={SUPPORT} href={`mailto:${SUPPORT}`} />
          <Line icon="alert" label="Reportar um problema" value="Já leva a versão e o aparelho" href={`mailto:${SUPPORT}?subject=${subject}&body=${body}`} />
          <Line icon="shield" label="Segurança e privacidade" to="/privacy" />
        </Group>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  none: { paddingHorizontal: 16, paddingVertical: 24, textAlign: 'center', color: colors.zinc500, fontSize: 16 },
  q: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  qText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  a: { paddingHorizontal: 16, paddingBottom: 16, fontSize: 15, lineHeight: 21, color: colors.zinc700 },
});
