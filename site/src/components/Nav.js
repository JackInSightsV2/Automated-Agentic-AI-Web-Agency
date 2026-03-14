export function Nav() {
  return `
    <nav class="nav" id="nav">
      <div class="container nav__inner">
        <a href="#" class="nav__logo">
          <span class="logo-soda">Soda</span><span class="logo-pop">Pop</span><span class="logo-six">6</span>
        </a>
        <ul class="nav__links" id="navLinks">
          <li><a href="#services">What You Get</a></li>
          <li><a href="#work">Examples</a></li>
          <li><a href="#process">How It Works</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#contact" class="btn btn--small">Get Started</a></li>
        </ul>
        <button class="nav__toggle" id="navToggle" aria-label="Toggle menu">
          <span></span><span></span><span></span>
        </button>
      </div>
    </nav>
  `;
}

export function initNav() {
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('nav--scrolled', window.scrollY > 40);
  }, { passive: true });

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open');
    links.classList.toggle('open');
  });

  links.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      toggle.classList.remove('open');
      links.classList.remove('open');
    });
  });

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = nav.offsetHeight + 16;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });
}
