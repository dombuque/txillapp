/** E-mails do Txillapp: texto simples e uma versão HTML limpa (logótipo, um botão e o link por extenso). */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface Mail {
  subject: string;
  text: string;
  html: string;
}

function layout(publicUrl: string, o: { title: string; intro: string; button: string; url: string; outro: string }): Mail {
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
</td></tr></table></body></html>`;
  const text = `${o.title}\n\n${o.intro}\n\n${o.button}: ${o.url}\n\n${o.outro}\n\nTxillapp · ${publicUrl}`;
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
