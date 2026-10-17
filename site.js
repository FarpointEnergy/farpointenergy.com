(() => {
  const allowedApplications = new Set(['data-center','solar','storage','utility','industrial','other']);
  const allowedProducts = new Set(['power','distribution','unsure']);
  const params = new URLSearchParams(location.search);
  const app = params.get('application');
  const combined = location.pathname.endsWith('/solar-storage.html') && ['solar','storage'].includes(app);
  if ((allowedProducts.has(document.body.dataset.product) || combined) && params.getAll('application').length === 1 && allowedApplications.has(app)) {
    document.body.dataset.application = app;
    document.querySelectorAll('a[href]').forEach(link => {
      const target = link.getAttribute('href');
      if (target.startsWith('#')) return;
      const url = new URL(target, location.href);
      if (url.origin === location.origin && ['/quote.html','/power-transformers.html','/distribution-transformers.html'].some(route => url.pathname.endsWith(route))) {
        url.searchParams.set('application', app);
        link.setAttribute('href', url.pathname.split('/').pop() + '?' + url.searchParams.toString() + url.hash);
      }
    });
  }
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.navbtn');
  const menu = document.getElementById('site-menu');
  if (nav && toggle && menu) {
    toggle.hidden = false;
    nav.classList.add('menu-ready');
    const close = () => { menu.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      menu.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); toggle.focus(); } });
    menu.addEventListener('click', event => { if (event.target.closest('a')) close(); });
    window.addEventListener('pageshow', close);
  }
})();
