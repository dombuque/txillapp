/** E-mails do Txillapp: texto simples e uma versão HTML limpa (logótipo, um botão e o link por extenso). */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface Mail {
  subject: string;
  text: string;
  html: string;
  /** Cabeçalhos extra (ex.: List-Unsubscribe nos lembretes). */
  headers?: Record<string, string>;
}

interface LayoutOpts {
  title: string;
  intro: string;
  button: string;
  url: string;
  outro: string;
  /** Ligação no rodapé (ex.: "Deixar de receber estes lembretes"). */
  footer?: { label: string; url: string };
}

function layout(publicUrl: string, o: LayoutOpts): Mail {
  const html = `<!doctype html><html lang="pt"><body style="margin:0;background:#ebebea;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:24px;padding:32px">
<tr><td><img src="${esc(publicUrl)}/icon-192.png" width="56" height="56" alt="Txillapp" style="border-radius:14px;display:block"></td></tr>
<tr><td style="padding-top:20px;font-size:22px;font-weight:800">${esc(o.title)}</td></tr>
<tr><td style="padding-top:12px;font-size:16px;line-height:1.5;color:#3f3f46">${esc(o.intro)}</td></tr>
<tr><td style="padding-top:24px"><a href="${esc(o.url)}" style="display:inline-block;background:#d6334f;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:999px">${esc(o.button)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:13px;line-height:1.5;color:#71717a">Se o botão não abrir, copia este endereço para o navegador:<br><a href="${esc(o.url)}" style="color:#d6334f;word-break:break-all">${esc(o.url)}</a></td></tr>
<tr><td style="padding-top:20px;font-size:13px;line-height:1.5;color:#71717a">${esc(o.outro)}</td></tr>
</table>
<p style="font-size:12px;color:#71717a;margin:16px 0 0">Txillapp · <a href="${esc(publicUrl)}" style="color:#71717a">txillapp.com</a></p>
${o.footer ? `<p style="font-size:12px;color:#71717a;margin:8px 0 0"><a href="${esc(o.footer.url)}" style="color:#71717a">${esc(o.footer.label)}</a></p>\n` : ''}</td></tr></table></body></html>`;
  const text = `${o.title}\n\n${o.intro}\n\n${o.button}: ${o.url}\n\n${o.outro}\n\nTxillapp · ${publicUrl}${o.footer ? `\n\n${o.footer.label}: ${o.footer.url}` : ''}`;
  return { subject: o.title, text, html };
}

export function verifyEmailMail(publicUrl: string, name: string, token: string): Mail {
  return layout(publicUrl, {
    title: 'Confirma o teu e-mail',
    intro: `Olá, ${name}! Falta só confirmar que este e-mail é teu para poderes publicar, comentar e conversar no Txillapp.`,
    button: 'Confirmar e-mail',
    url: `${publicUrl}/verify-email?token=${encodeURIComponent(token)}`,
    outro: 'O link vale 48 horas. Se não criaste uma conta no Txillapp, ignora esta mensagem.',
  });
}

export function resetPasswordMail(publicUrl: string, name: string, token: string): Mail {
  return layout(publicUrl, {
    title: 'Define uma senha nova',
    intro: `Olá, ${name}! Recebemos um pedido para mudar a senha da tua conta. Carrega no botão para escolheres uma nova.`,
    button: 'Escolher nova senha',
    url: `${publicUrl}/reset-password?token=${encodeURIComponent(token)}`,
    outro: 'O link vale 1 hora e só funciona uma vez. Se não foste tu, ignora esta mensagem: a tua senha continua a mesma.',
  });
}

/** Pedido de apagar a conta feito sem sessão (txillapp.com/apagar-conta): a ligação abre a página que pede a confirmação final. */
export function deleteAccountMail(publicUrl: string, name: string, token: string): Mail {
  return layout(publicUrl, {
    title: 'Confirma que queres apagar a conta',
    intro: `Olá, ${name}! Recebemos um pedido para apagar a tua conta do Txillapp e os teus dados. Ainda não apagámos nada: carrega no botão e confirma na página que abre.`,
    button: 'Ver e confirmar',
    url: `${publicUrl}/apagar-conta?token=${encodeURIComponent(token)}`,
    outro: 'O link vale 1 hora. Se não foste tu, ignora esta mensagem: a tua conta continua igual.',
  });
}

/* ───── avisos de segurança (sem ligações com códigos: só para a app e para o «Esqueci-me da senha») ───── */

const when = (d: Date) =>
  d.toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' (hora de Maputo)';

/** Várias senhas erradas seguidas: a conta ficou bloqueada um bocado. */
export function loginLockedMail(publicUrl: string, name: string, o: { until: Date; device: string }): Mail {
  return layout(publicUrl, {
    title: 'Alguém tentou entrar na tua conta',
    intro: `Olá, ${name}! Houve várias tentativas seguidas de entrar na tua conta do Txillapp com a senha errada (a última num aparelho «${o.device}»). Para te proteger, bloqueámos as entradas com senha até ${when(o.until)}.`,
    button: 'Mudar a senha',
    url: `${publicUrl}/forgot-password`,
    outro: 'Se foste tu, espera e tenta outra vez, ou recupera a senha (isso também desbloqueia a conta). Se não foste tu, a tua senha continua segura: escolhe uma senha que não uses noutros sítios. Nunca te pedimos a senha por mensagem.',
  });
}

/** Entrou-se na conta num aparelho novo. */
export function newLoginMail(publicUrl: string, name: string, o: { at: Date; device: string; how: string }): Mail {
  return layout(publicUrl, {
    title: 'Novo início de sessão no Txillapp',
    intro: `Olá, ${name}! Alguém entrou na tua conta ${o.how} num aparelho novo: «${o.device}», a ${when(o.at)}.`,
    button: 'Ver os meus aparelhos',
    url: `${publicUrl}/settings/aparelhos`,
    outro: 'Se foste tu, não precisas de fazer nada. Se não foste tu, muda já a senha (em «Esqueci-me da senha») e termina as outras sessões em Definições → Segurança → «Os teus aparelhos».',
  });
}

/** Um token de sessão antigo foi usado outra vez (sinal de cópia): a sessão desse aparelho terminou. */
export function sessionReuseMail(publicUrl: string, name: string, o: { at: Date; device: string }): Mail {
  return layout(publicUrl, {
    title: 'Terminámos uma sessão por segurança',
    intro: `Olá, ${name}! A sessão do aparelho «${o.device}» foi usada de uma forma estranha a ${when(o.at)} (como se tivesse sido copiada), por isso terminámo-la. Nesse aparelho é preciso entrar outra vez.`,
    button: 'Ver os meus aparelhos',
    url: `${publicUrl}/settings/aparelhos`,
    outro: 'Às vezes isto acontece com uma rede fraca. Se não reconheces o aparelho, muda a senha e termina as outras sessões em Definições → Segurança → «Os teus aparelhos».',
  });
}

/**
 * Lembrete de regresso por e-mail (só quando não há push que chegue): o mesmo texto do aviso, um botão para o sítio certo
 * e, no rodapé, "Deixar de receber estes lembretes" (um clique, sem entrar na conta). `unsubscribeUrl` também vai no
 * cabeçalho List-Unsubscribe (com List-Unsubscribe-Post, para o botão "Cancelar subscrição" do Gmail e do Outlook).
 */
export function comebackMail(publicUrl: string, name: string, o: { title: string; body: string; path: string; unsubscribeUrl: string }): Mail {
  const mail = layout(publicUrl, {
    title: o.title,
    intro: `Olá, ${name}! ${o.body}`,
    button: 'Abrir o Txillapp',
    url: `${publicUrl}${o.path}`,
    outro: 'Enviamos isto de vez em quando a quem não passa pelo Txillapp há uns dias. Podes desligar estes lembretes em Definições → Notificações ou na ligação aqui em baixo.',
    footer: { label: 'Deixar de receber estes lembretes', url: o.unsubscribeUrl },
  });
  return { ...mail, headers: { 'List-Unsubscribe': `<${o.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}
