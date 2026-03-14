// Styles
import './styles/variables.css';
import './styles/base.css';
import './styles/nav.css';
import './styles/hero.css';
import './styles/sections.css';
import './styles/responsive.css';

// Components
import { Nav, initNav } from './components/Nav.js';
import { Hero } from './components/Hero.js';
import { Services } from './components/Services.js';
import { Work } from './components/Work.js';
import { Process } from './components/Process.js';
import { Testimonials } from './components/Testimonials.js';
import { Pricing } from './components/Pricing.js';
import { Cta } from './components/Cta.js';
import { Contact, initContactForm } from './components/Contact.js';
import { Footer } from './components/Footer.js';
import { initScrollAnimations } from './components/animations.js';

// Render
const app = document.getElementById('app');

app.innerHTML = [
  Nav(),
  Hero(),
  Services(),
  Work(),
  Process(),
  Testimonials(),
  Pricing(),
  Cta(),
  Contact(),
  Footer(),
].join('');

// Init interactions
initNav();
initContactForm();
initScrollAnimations();
