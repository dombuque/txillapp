// Regista o service worker da app (cache leve e notificações push) e trata das versões novas:
//  - sempre que a app volta a estar à vista (no iPhone a PWA fica só suspensa quando se "fecha"), pergunta ao servidor
//    se há um service worker novo (cada build é um novo); o sw.js nunca vem da cache HTTP;
//  - quando o novo toma conta das janelas, recarrega uma vez, para a app passar logo à versão nova.
if ('serviceWorker' in navigator) {
  var had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (had) location.reload();
    had = true;
  });
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(function (reg) {
      var check = function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); };
      document.addEventListener('visibilitychange', check);
      window.addEventListener('focus', check);
      window.addEventListener('pageshow', check);
      setInterval(check, 30 * 60 * 1000);
    }).catch(function () { /* sem service worker: a app funciona na mesma */ });
  });
}

// O Chrome (Android) avisa uma só vez, cedo, que dá para instalar: guarda-se aqui para as Definições poderem mostrar o botão.
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window.__txInstall = e;
});
window.addEventListener('appinstalled', function () {
  window.__txInstall = null;
});
