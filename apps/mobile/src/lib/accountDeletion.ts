/**
 * O que a página pública txillapp.com/apagar-conta diz sobre apagar a conta. Tem de bater certo com o que a API faz
 * (apps/api/src/auth/auth.service.ts, eraseAccount) e com a Política de Privacidade (ponto 8, «Quanto tempo guardamos»).
 */

/** Os passos na app (e no site, com a sessão iniciada). */
export const DELETION_STEPS: string[] = [
  'Abre o Txillapp e vai ao teu perfil.',
  'Toca no menu (☰), «Definições e privacidade», e depois em «Conta».',
  'No fundo, em «Zona perigosa», toca em «Eliminar conta».',
  'Escreve o teu @ (e a senha, se a conta tiver) e toca em «Eliminar a minha conta».',
];

export const DELETION_DELETED: string[] = [
  'O nome, o @, o email, a senha, a bio, a foto, a cidade, o site, o país, o género e a data de nascimento.',
  'As publicações (com as fotos, os vídeos e o texto), os mimos, as notas, os Zás e os comentários, também em publicações de outras pessoas.',
  'As conversas a dois, as mensagens que enviaste nos TxillGroups, as chamadas e as conversas com o SuperTxill.',
  'Quem segues e quem te segue, os brindes, as notificações, os guardados, a geleira e as tuas preferências.',
  'Os aparelhos com notificações e as sessões iniciadas, as estatísticas de uso, as visitas a perfis, os check-ins, tudo o que é do mapa e os pedidos de verificação.',
  'Sais dos teus TxillGroups. As páginas de locais que criaste passam para o administrador mais antigo ou deixam de aparecer.',
];

export const DELETION_KEPT: string[] = [
  'Os movimentos de Txills e os pedidos de recarga ficam registados sem dados pessoais (ligados a «Conta eliminada»), para as contas baterem certo e para prevenir fraude. Os registos dos convites ficam pela mesma razão.',
  'O registo de segurança diz que a conta foi eliminada e quando, sem o conteúdo das publicações nem das mensagens.',
  'As denúncias que outras pessoas fizeram sobre o que publicaste seguem os prazos da Política de Privacidade.',
  'O que outras pessoas guardaram, copiaram ou fotografaram nos aparelhos delas fica fora do nosso alcance.',
];

export const DELETION_WHEN =
  'Na hora em que confirmas. As fotos, os vídeos e as mensagens de voz saem do armazenamento pouco depois, normalmente em menos de 15 minutos. As cópias de segurança cifradas são substituídas sozinhas e desaparecem por completo ao fim de, no máximo, 400 dias.';
