import { Controller, Get, Header, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ComebackReminderService } from './comeback-reminder.service';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Página simples (sem a app): diz o que aconteceu e onde voltar a ligar. */
function page(title: string, text: string) {
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Txillapp</title></head>
<body style="margin:0;background:#ebebea;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#18181b">
<main style="max-width:480px;margin:48px auto;padding:32px;background:#fff;border-radius:24px">
<h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1>
<p style="font-size:16px;line-height:1.5;color:#3f3f46;margin:0 0 20px">${esc(text)}</p>
<a href="/" style="display:inline-block;background:#d6334f;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Abrir o Txillapp</a>
</main></body></html>`;
}

/**
 * "Deixar de receber estes lembretes" (a ligação do e-mail dos lembretes de regresso): um clique, sem entrar na conta.
 * - GET  /comeback/unsubscribe?token=  -> desliga e mostra uma página a confirmar
 * - POST /comeback/unsubscribe?token=  -> o mesmo, para o "Cancelar subscrição" do Gmail e do Outlook (RFC 8058)
 * Voltar a ligar: Definições → Notificações → "Lembretes quando não passo por cá".
 */
@Controller('comeback')
export class ComebackController {
  constructor(private readonly comeback: ComebackReminderService) {}

  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async unsubscribePage(@Query('token') token?: string) {
    return (await this.comeback.unsubscribe(String(token ?? '')))
      ? page('Pronto, já não te lembramos', 'Deixas de receber os lembretes quando não passas pelo Txillapp. Podes voltar a ligá-los em Definições → Notificações.')
      : page('Esta ligação não serve', 'Não conseguimos usar esta ligação. Podes desligar os lembretes na app, em Definições → Notificações.');
  }

  @Post('unsubscribe')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async unsubscribeOneClick(@Query('token') token?: string) {
    return { ok: await this.comeback.unsubscribe(String(token ?? '')) };
  }
}
