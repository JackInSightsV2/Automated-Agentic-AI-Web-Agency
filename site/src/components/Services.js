const services = [
  {
    icon: `<svg viewBox="0 0 48 48" fill="none"><rect x="4" y="8" width="40" height="28" rx="3" stroke="currentColor" stroke-width="2.5"/><line x1="4" y1="16" x2="44" y2="16" stroke="currentColor" stroke-width="2.5"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="14" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/><line x1="16" y1="40" x2="32" y2="40" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="24" y1="36" x2="24" y2="40" stroke="currentColor" stroke-width="2.5"/></svg>`,
    title: 'A Professional Website',
    desc: 'A clean, modern website that tells your customers who you are, what you do, and how to get in touch. Simple as that.',
  },
  {
    icon: `<svg viewBox="0 0 48 48" fill="none"><rect x="12" y="4" width="24" height="40" rx="3" stroke="currentColor" stroke-width="2.5"/><line x1="12" y1="12" x2="36" y2="12" stroke="currentColor" stroke-width="2.5"/><line x1="12" y1="36" x2="36" y2="36" stroke="currentColor" stroke-width="2.5"/><circle cx="24" cy="40" r="1.5" fill="currentColor"/></svg>`,
    title: 'Works on Every Device',
    desc: 'Looks great on phones, tablets, and desktops. Most of your customers will find you on their phone — your site will be ready for them.',
  },
  {
    icon: `<svg viewBox="0 0 48 48" fill="none"><path d="M24 4L6 14v20l18 10 18-10V14L24 4z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 24L6 14" stroke="currentColor" stroke-width="2.5"/><path d="M24 24l18-10" stroke="currentColor" stroke-width="2.5"/><path d="M24 24v20" stroke="currentColor" stroke-width="2.5"/></svg>`,
    title: 'Hosted &amp; Secured',
    desc: 'We take care of hosting, SSL certificates, and keeping your site live. You don\'t need to worry about any of the technical stuff.',
  },
  {
    icon: `<svg viewBox="0 0 48 48" fill="none"><path d="M8 24c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M14 24c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="24" r="3" stroke="currentColor" stroke-width="2.5"/><path d="M24 27v13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M18 40h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    title: 'Found on Google',
    desc: 'Your site is built with SEO basics baked in, so customers searching for your type of business in your area can actually find you.',
  },
  {
    icon: `<svg viewBox="0 0 48 48" fill="none"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="2.5" transform="translate(12,10)"/><polyline points="14,16 24,23 34,16" stroke="currentColor" stroke-width="2.5" fill="none"/></svg>`,
    title: 'Contact Info Front &amp; Centre',
    desc: 'Your phone number, email, address, and opening hours — all easy to find. Customers can reach you in one tap.',
  },
  {
    icon: `<svg viewBox="0 0 48 48" fill="none"><path d="M24 4v8m0 24v8M4 24h8m24 0h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="24" r="8" stroke="currentColor" stroke-width="2.5"/><path d="M10.1 10.1l5.66 5.66m16.48 16.48l5.66 5.66M37.9 10.1l-5.66 5.66M15.76 32.24l-5.66 5.66" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    title: 'Changes Whenever You Need',
    desc: 'Need to update your hours or add a new service? That\'s covered in your monthly retainer. Just drop us a message.',
  },
];

export function Services() {
  const cards = services
    .map(
      (s) => `
    <div class="service-card">
      <div class="service-card__icon">${s.icon}</div>
      <h3>${s.title}</h3>
      <p>${s.desc}</p>
    </div>`
    )
    .join('');

  return `
    <section class="services" id="services">
      <div class="container">
        <span class="section-badge">What You Get</span>
        <h2 class="section-title">Everything Your Business Needs to <span class="gradient-text">Get Online</span></h2>
        <p class="section-subtitle">A proper website for your business. No fuss, no jargon — just what works.</p>
        <div class="services__grid">${cards}</div>
      </div>
    </section>
  `;
}
