export function Pricing() {
  return `
    <section class="pricing" id="pricing">
      <div class="container">
        <span class="section-badge">Pricing</span>
        <h2 class="section-title">One Plan. <span class="gradient-text">One Price.</span></h2>
        <p class="section-subtitle">No tiers, no upsells, no hidden fees. Just a website for your business.</p>

        <div class="pricing__single">
          <div class="pricing-card pricing-card--featured pricing-card--solo">
            <div class="pricing-card__badge">Everything Included</div>
            <div class="pricing-card__header">
              <h3>Your Business Website</h3>
              <p>A professional, mobile-friendly website with your business details, services, and contact information — live and ready to go.</p>
            </div>
            <div class="pricing-card__price-row">
              <div class="pricing-card__price">
                <span class="price">&pound;35</span>
                <span class="period">one-off to get started</span>
              </div>
              <div class="pricing-card__divider">+</div>
              <div class="pricing-card__price">
                <span class="price">&pound;5</span>
                <span class="period">per month for hosting &amp; changes</span>
              </div>
            </div>
            <ul class="pricing-card__features">
              <li>Professional business website</li>
              <li>Works on mobile, tablet &amp; desktop</li>
              <li>Your services, hours &amp; contact info</li>
              <li>Google Maps location</li>
              <li>SEO basics so you show up on Google</li>
              <li>SSL secured &amp; fast hosting</li>
              <li>Request changes anytime</li>
              <li>No contracts — cancel whenever</li>
            </ul>
            <a href="#contact" class="btn btn--primary btn--full">Get Your Website</a>
          </div>
        </div>
      </div>
    </section>
  `;
}
