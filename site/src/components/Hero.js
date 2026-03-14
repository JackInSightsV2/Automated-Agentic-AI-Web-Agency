export function Hero() {
  return `
    <header class="hero" id="hero">
      <div class="hero__bg">
        <div class="bubble bubble--1"></div>
        <div class="bubble bubble--2"></div>
        <div class="bubble bubble--3"></div>
        <div class="bubble bubble--4"></div>
        <div class="bubble bubble--5"></div>
      </div>
      <div class="container hero__content">
        <span class="hero__badge">Websites for Local Businesses</span>
        <h1 class="hero__title">
          Your Business Online.<br />
          <span class="gradient-text">Just £35.</span>
        </h1>
        <p class="hero__subtitle">
          No website? No problem. We build professional, mobile-friendly websites
          for local businesses — ready to go, from just £35.
        </p>
        <div class="hero__cta">
          <a href="#pricing" class="btn btn--primary btn--large">See What You Get</a>
          <a href="#work" class="btn btn--outline btn--large">View Examples</a>
        </div>
        <div class="hero__stats">
          <div class="stat">
            <span class="stat__number">£35</span>
            <span class="stat__label">To Get Started</span>
          </div>
          <div class="stat">
            <span class="stat__number">£5/mo</span>
            <span class="stat__label">For Changes &amp; Hosting</span>
          </div>
          <div class="stat">
            <span class="stat__number">Fast</span>
            <span class="stat__label">Turnaround</span>
          </div>
        </div>
      </div>
    </header>
  `;
}
