export function Contact() {
  return `
    <section class="contact" id="contact">
      <div class="container">
        <div class="contact__grid">
          <div class="contact__info">
            <span class="section-badge">Get In Touch</span>
            <h2 class="section-title">Ready to Get <span class="gradient-text">Your Website?</span></h2>
            <p>Send us a message with your business name and what you do. We'll take it from there — no tech knowledge needed.</p>
            <div class="contact__details">
              <div class="contact__item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
                <span>${import.meta.env.VITE_AGENCY_EMAIL || 'hello@example.com'}</span>
              </div>
              <div class="contact__item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <span>${import.meta.env.VITE_AGENCY_DOMAIN || 'example.com'}</span>
              </div>
            </div>
          </div>
          <form class="contact__form" id="contactForm">
            <div class="form-group">
              <label for="name">Your Name</label>
              <input type="text" id="name" name="name" placeholder="John Smith" required />
            </div>
            <div class="form-group">
              <label for="email">Email Address</label>
              <input type="email" id="email" name="email" placeholder="john@mybusiness.com" required />
            </div>
            <div class="form-group">
              <label for="business">Business Name</label>
              <input type="text" id="business" name="business" placeholder="My Business Ltd" />
            </div>
            <div class="form-group">
              <label for="message">What does your business do?</label>
              <textarea id="message" name="message" rows="4" placeholder="e.g. We're a plumbing company based in Manchester..." required></textarea>
            </div>
            <button type="submit" class="btn btn--primary btn--full">Send Message</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

export function initContactForm() {
  const form = document.getElementById('contactForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.textContent = 'Message Sent!';
    btn.style.background = 'var(--green)';
    btn.style.borderColor = 'var(--green)';
    btn.disabled = true;

    setTimeout(() => {
      btn.textContent = 'Send Message';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.disabled = false;
      form.reset();
    }, 3000);
  });
}
