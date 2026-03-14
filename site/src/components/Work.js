const projects = [
  {
    wide: true,
    bg: 'linear-gradient(135deg, #1a1a2e, #16213e)',
    tag: 'Restaurant',
    title: 'The Rolling Pin Bakery',
    desc: 'Menu, location, opening hours, and a way to get in touch — everything a bakery needs online.',
    heroColor: 'var(--pink)',
    heroWidth: 180,
    hasBtn: true,
    hasLogoLine: true,
  },
  {
    bg: 'linear-gradient(135deg, #0f3443, #34e89e)',
    tag: 'Trades',
    title: 'GreenLeaf Landscaping',
    desc: 'Services, service areas, and a quick quote form.',
    heroColor: 'var(--teal)',
    heroWidth: 120,
  },
  {
    bg: 'linear-gradient(135deg, #2d1b69, #e84393)',
    tag: 'Beauty',
    title: 'Luxe Lash Studio',
    desc: 'Price list, booking info, and a gallery of their work.',
    heroColor: 'var(--purple)',
    heroWidth: 120,
  },
  {
    bg: 'linear-gradient(135deg, #1e3c72, #2a5298)',
    tag: 'Trades',
    title: 'Summit Plumbing &amp; Heating',
    desc: 'Phone number, services offered, and areas covered.',
    heroWidth: 120,
  },
  {
    wide: true,
    bg: 'linear-gradient(135deg, #c31432, #240b36)',
    tag: 'Fitness',
    title: 'Iron Core Gym',
    desc: 'Class timetable, membership info, and location details all in one place.',
    heroColor: 'var(--coral)',
    heroWidth: 200,
    hasBtn: true,
    hasLogoLine: true,
  },
];

function mockSite(p) {
  const heroH = p.wide ? 14 : 12;
  const subW = p.wide ? 160 : 100;
  const subH = p.wide ? 8 : 6;
  const colorStyle = p.heroColor ? `background:${p.heroColor}` : '';

  return `
    <div class="mock-site">
      <div class="mock-site__nav">
        <div class="mock-dot"></div>
        ${p.hasLogoLine ? '<div class="mock-line" style="width:60px"></div>' : ''}
        <div class="mock-nav-links">
          <div class="mock-line" style="width:30px"></div>
          <div class="mock-line" style="width:30px"></div>
          ${p.hasLogoLine ? '<div class="mock-line" style="width:30px"></div>' : ''}
        </div>
      </div>
      <div class="mock-site__hero">
        <div class="mock-line" style="width:${p.heroWidth}px;height:${heroH}px;${colorStyle}"></div>
        <div class="mock-line" style="width:${subW}px;height:${subH}px;opacity:0.5"></div>
        ${p.hasBtn ? '<div class="mock-btn"></div>' : ''}
      </div>
    </div>
  `;
}

export function Work() {
  const cards = projects
    .map(
      (p) => `
    <div class="work-card${p.wide ? ' work-card--wide' : ''}">
      <div class="work-card__preview" style="background: ${p.bg}">
        ${mockSite(p)}
      </div>
      <div class="work-card__info">
        <span class="work-card__tag">${p.tag}</span>
        <h3>${p.title}</h3>
        <p>${p.desc}</p>
      </div>
    </div>`
    )
    .join('');

  return `
    <section class="work" id="work">
      <div class="container">
        <span class="section-badge">Examples</span>
        <h2 class="section-title">Websites We've Built for <span class="gradient-text">Businesses Like Yours</span></h2>
        <p class="section-subtitle">Here's what a ${import.meta.env.VITE_AGENCY_NAME || 'Web Agency'} website looks like across different industries.</p>
        <div class="work__grid">${cards}</div>
      </div>
    </section>
  `;
}
