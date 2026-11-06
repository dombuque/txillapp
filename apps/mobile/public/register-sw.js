// Regista o service worker da app (cache leve e notificações push).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { /* sem service worker: a app funciona na mesma */ });
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
