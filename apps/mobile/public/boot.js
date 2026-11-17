// Ecrã de arranque: nunca deixa a página em branco enquanto a app descarrega (rede lenta) e oferece recarregar se demorar.
(function () {
  // A versão desta build vem nos <meta> do HTML (sem scripts embutidos, por causa da política de conteúdo).
  try {
    var meta = function (n) { var e = document.querySelector('meta[name="' + n + '"]'); return e ? e.getAttribute('content') : null; };
    window.__TX_BUILD = meta('tx-build');
    window.__TX_VERSION = meta('tx-version');
  } catch (x) { /* sem DOM */ }
  // Idioma (lib/i18n: o guardado em txill_lang, senão o do browser). As páginas estáticas vêm em português: noutro idioma
  // a app monta de raiz no cliente, sem hidratar o HTML português (nem erro de hidratação nem português a piscar), e o
  // HTML pré-gerado fica escondido até a app montar (o _layout tira o estilo). Em português, hidrata como sempre.
  var lang = 'pt';
  try {
    var saved = window.localStorage && localStorage.getItem('txill_lang');
    var sys = (navigator.languages && navigator.languages[0]) || navigator.language || 'pt';
    lang = String(saved || sys).toLowerCase().split(/[-_]/)[0] || 'pt';
  } catch (x) { /* sem armazenamento: português */ }
  if (lang !== 'pt') {
    try { Object.defineProperty(window, '__EXPO_ROUTER_HYDRATE__', { configurable: true, get: function () { return false; }, set: function () {} }); } catch (x) { /* fica a hidratar */ }
    var hide = document.createElement('style');
    hide.id = 'tx-lang-hide';
    hide.textContent = '#root{visibility:hidden}';
    (document.head || document.documentElement).appendChild(hide);
  }
  var EN = lang !== 'pt';
  function show() {
    if (document.getElementById('tx-boot')) return;
    var d = document.createElement('div');
    d.id = 'tx-boot';
    d.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;color:#18181b');
    d.innerHTML =
      '<img src="/icon-192.png" alt="" width="84" height="84" style="border-radius:20px"/>' +
      '<div style="position:relative;margin-top:18px;width:32px;height:48px;display:flex;align-items:flex-end;justify-content:center"><span style="position:absolute;bottom:0;width:20px;height:5px;border-radius:50%;background:#000;opacity:.2;animation:txsombra .95s ease-in-out infinite"></span><span style="display:block;width:20px;height:20px;margin-bottom:2px;border-radius:50%;background:#d6334f;transform-origin:50% 100%;animation:txponto .95s ease-in-out infinite"></span></div>' +
      '<p id="tx-boot-slow" style="display:none;margin:22px 24px 0;text-align:center;font-size:15px;color:#52525b">' + (EN ? 'This is taking longer than usual…' : 'Está a demorar mais do que o normal…') + '</p>' +
      '<button id="tx-boot-btn" style="display:none;margin-top:14px;height:44px;padding:0 22px;border:0;border-radius:22px;background:#d6334f;color:#fff;font-size:16px;font-weight:600">' + (EN ? 'Reload' : 'Recarregar') + '</button>' +
      '<style>@keyframes txponto{0%,100%{transform:translateY(0) scale(1.18,.82)}38%{transform:translateY(-23px) scale(.9,1.12)}62%{transform:translateY(-2px) scale(1,1)}78%{transform:translateY(0) scale(1.1,.9)}}@keyframes txsombra{0%,100%{transform:scaleX(1);opacity:.22}38%{transform:scaleX(.45);opacity:.08}}</style>';
    document.body.appendChild(d);
    document.getElementById('tx-boot-btn').onclick = function () { location.reload(); };
    setTimeout(function () {
      var s = document.getElementById('tx-boot-slow');
      var b = document.getElementById('tx-boot-btn');
      if (s && b) { s.style.display = 'block'; b.style.display = 'block'; }
    }, 9000);
  }
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
  // Falha a carregar um ficheiro da app (por exemplo, depois de uma versão nova): recarrega uma vez sozinho.
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'SCRIPT' && /\/_expo\//.test(t.src || '')) {
      try {
        if (!sessionStorage.getItem('tx_reload')) { sessionStorage.setItem('tx_reload', '1'); location.reload(); }
      } catch (x) { /* sem armazenamento */ }
    }
  }, true);
})();
