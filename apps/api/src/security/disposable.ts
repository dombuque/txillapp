/**
 * Domínios de email temporário (descartável). Lista local: nada sai do servidor, nenhum serviço externo é consultado.
 *
 * Esta é uma seleção dos mais usados. A lista completa e mantida pela comunidade é a do projeto
 * github.com/disposable-email-domains/disposable-email-domains (domínio público, CC0, ~4000 domínios): para a pôr toda,
 * copia o ficheiro `disposable_email_blocklist.conf` para aqui (um domínio por linha, numa string) de vez em quando.
 * Os subdomínios contam (abc.mailinator.com é mailinator.com).
 */
const LIST = `
0-mail.com 0815.ru 10mail.org 10minutemail.co.uk 10minutemail.com 10minutemail.de 10minutemail.net 10minutemail.org 123-m.com
1secmail.com 1secmail.net 1secmail.org 20minutemail.com 20minutemail.it 33mail.com 4warding.com 6paq.com 7tags.com 9ox.net
anonbox.net anonymbox.com antispam.de armyspy.com bccto.me beefmilk.com binkmail.com bobmail.info bofthew.com boximail.com
burnermail.io byom.de chacuo.net cuvox.de dayrep.com deadaddress.com despam.it devnullmail.com dingbone.com discard.email
discardmail.com discardmail.de dispostable.com dodgeit.com dodgit.com dropmail.me drdrb.com dumpmail.de e4ward.com
easytrashmail.com einrot.com email-fake.com emailfake.com emailisvalid.com emailondeck.com emailsensei.com emailtemporanea.com
emailtemporanea.net emailtemporario.com.br emailwarden.com emltmp.com ephemail.net etranquil.com explodemail.com fakeinbox.com
fakemail.net fakemailgenerator.com fastacura.com filzmail.com fleckens.hu getairmail.com getnada.com gishpuppy.com guerillamail.com
guerillamail.net guerillamail.org guerrillamail.biz guerrillamail.com guerrillamail.de guerrillamail.info guerrillamail.net
guerrillamail.org guerrillamailblock.com gustr.com harakirimail.com hidemail.de hmamail.com hulapla.de imgof.com imgv.de incognitomail.com
incognitomail.net incognitomail.org inboxbear.com inboxkitten.com jetable.com jetable.net jetable.org jourrapide.com kasmail.com
killmail.com killmail.net klzlk.com koszmail.pl kurzepost.de lhsdv.com linshiyouxiang.net lroid.com mail-temp.com mail.tm mail7.io
mailcatch.com maildrop.cc maildu.de maileater.com mailexpire.com mailforspam.com mailfreeonline.com mailimate.com mailinator.com
mailinator.net mailinator.org mailinator2.com mailmetrash.com mailmoat.com mailnesia.com mailnull.com mailpoof.com mailsac.com
mailshell.com mailtemp.info mailtothis.com mailzilla.com meltmail.com mintemail.com moakt.com moakt.ws mohmal.com mt2015.com
mvrht.com mytemp.email mytempemail.com mytrashmail.com nada.email nada.ltd neomailbox.com nepwk.com nervmich.net nomail.xl.cx
nospam.ze.tc nospamfor.us nowmymail.com objectmail.com obobbo.com onewaymail.com oneoffemail.com opayq.com owlpic.com
pookmail.com proxymail.eu punkass.com putthisinyourspamdatabase.com quickinbox.com rcpt.at receiveee.com rhyta.com rmqkr.net
s0ny.net safetymail.info sharklasers.com shieldemail.com shitmail.me shortmail.net sibmail.com smashmail.de sogetthis.com
spam4.me spambob.com spambog.com spambox.us spamcero.com spamdecoy.net spamex.com spamfree24.org spamgourmet.com spamhole.com
spaml.de spammotel.com spamspot.com spamthis.co.uk superrito.com suremail.info tafmail.com teleworm.us temp-mail.io temp-mail.org
temp-mail.ru tempail.com tempemail.co tempemail.com tempemail.net tempinbox.com tempmail.com tempmail.de tempmail.net tempmail.plus
tempmail.us tempmail.ws tempmailaddress.com tempmailo.com tempomail.fr temporaryemail.net temporaryinbox.com tempr.email
thankyou2010.com thisisnotmyrealemail.com throwam.com throwawayemail.com throwawaymail.com tmail.ws tmailinator.com tmpmail.net
tmpmail.org tmpnator.live trash-mail.com trash-mail.de trash2009.com trashdevil.com trashmail.at trashmail.com trashmail.de
trashmail.me trashmail.net trashmail.org trashmail.ws trashmailer.com trashymail.com trbvm.com tyldd.com uggsrock.com
upliftnow.com uroid.com veryrealemail.com vomoto.com wegwerfmail.de wegwerfmail.net wegwerfmail.org wh4f.org whyspam.me
willselfdestruct.com wuzupmail.net xagloo.com xemaps.com xents.com xmaily.com yepmail.net yomail.info yopmail.com yopmail.fr
yopmail.net yuurok.com zehnminutenmail.de zetmail.com zippymail.info zoemail.org zzrgg.com
`;

const DOMAINS = new Set(LIST.split(/\s+/).map((d) => d.trim().toLowerCase()).filter(Boolean));

/** O domínio do email (ou um domínio-pai dele) está na lista de temporários? */
export function isDisposableEmail(email: string): boolean {
  const domain = (email.split('@')[1] ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!domain) return false;
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) if (DOMAINS.has(parts.slice(i).join('.'))) return true;
  return false;
}

export const disposableDomainCount = () => DOMAINS.size;
