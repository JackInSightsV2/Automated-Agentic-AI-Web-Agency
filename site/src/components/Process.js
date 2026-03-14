const steps = [
  {
    num: '01',
    title: 'We Find You',
    desc: "We spot local businesses that don't have a website yet. If we've reached out to you, it's because we think we can help.",
  },
  {
    num: '02',
    title: 'We Build Your Site',
    desc: 'We put together a professional website for your business — with your details, services, and contact information.',
  },
  {
    num: '03',
    title: 'You Take a Look',
    desc: "We'll show you a live preview of your site. Happy with it? Great. Want changes? We'll sort them out.",
  },
  {
    num: '04',
    title: 'Go Live',
    desc: "Pay £35 and your site goes live. We handle the hosting and you can request changes anytime for £5/month. That's it.",
  },
];

export function Process() {
  const items = steps
    .map(
      (s) => `
    <div class="step">
      <div class="step__number">${s.num}</div>
      <div class="step__content">
        <h3>${s.title}</h3>
        <p>${s.desc}</p>
      </div>
    </div>`
    )
    .join('');

  return `
    <section class="process" id="process">
      <div class="container">
        <span class="section-badge">How It Works</span>
        <h2 class="section-title">Dead <span class="gradient-text">Simple.</span></h2>
        <p class="section-subtitle">No meetings, no contracts, no complicated process. Here's how it works.</p>
        <div class="process__steps">${items}</div>
      </div>
    </section>
  `;
}
