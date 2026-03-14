const reviews = [
  {
    text: '"I didn\'t even know I needed a website until they showed me one already built for my shop. Paid £35 and it was live the same day. Brilliant."',
    initials: 'JR',
    name: 'James R.',
    company: 'Local Bakery Owner',
  },
  {
    text: '"I\'d been meaning to get a website for years but never got round to it. These guys made it so easy — and the price is unbeatable."',
    initials: 'SP',
    name: 'Sarah P.',
    company: 'Landscaping Business',
  },
  {
    text: '"Really impressed with how professional the site looks. My customers can find my number, services, and location straight away. Well worth it."',
    initials: 'MK',
    name: 'Michelle K.',
    company: 'Beauty Salon Owner',
  },
];

export function Testimonials() {
  const cards = reviews
    .map(
      (r) => `
    <div class="testimonial-card">
      <div class="testimonial-card__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
      <p>${r.text}</p>
      <div class="testimonial-card__author">
        <div class="testimonial-card__avatar">${r.initials}</div>
        <div>
          <strong>${r.name}</strong>
          <span>${r.company}</span>
        </div>
      </div>
    </div>`
    )
    .join('');

  return `
    <section class="testimonials">
      <div class="container">
        <span class="section-badge">Happy Customers</span>
        <h2 class="section-title">Businesses That Got <span class="gradient-text">Online With Us</span></h2>
        <div class="testimonials__grid">${cards}</div>
      </div>
    </section>
  `;
}
