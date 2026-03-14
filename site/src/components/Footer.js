export function Footer() {
  return `
    <footer class="footer">
      <div class="container footer__inner">
        <div class="footer__brand">
          <a href="#" class="nav__logo">
            ${import.meta.env.VITE_AGENCY_NAME || 'Web Agency'}
          </a>
          <p>Professional websites for local businesses. £35 to get started.</p>
        </div>
        <div class="footer__links">
          <div class="footer__col">
            <h4>Company</h4>
            <a href="#services">What You Get</a>
            <a href="#work">Examples</a>
            <a href="#process">How It Works</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div class="footer__col">
            <h4>Get Started</h4>
            <a href="#contact">Contact Us</a>
            <a href="mailto:${import.meta.env.VITE_AGENCY_EMAIL || 'hello@example.com'}">Email Us</a>
          </div>
        </div>
        <div class="footer__bottom">
          <p>&copy; 2026 ${import.meta.env.VITE_AGENCY_NAME || 'Web Agency'}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  `;
}
