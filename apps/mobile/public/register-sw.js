// Regista o service worker da app (cache leve e notificações push).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { /* sem service worker: a app funciona na mesma */ });
  });
}
