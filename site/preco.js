// Preço mostrado no site (index.html) e na tela de cadastro (entrar.html).
// Se você mudar o PLAN_PRICE no Netlify, troque o valor aqui também.
var PRECO = 'R$ 39,90';
document.querySelectorAll('[data-price]').forEach(function (el) { el.textContent = PRECO; });
