#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# Automated Agentic AI Web Agency — Setup Script
# ══════════════════════════════════════════════════════════════
# Installs all dependencies, CLI tools, skills, and plugins
# so you just need to fill in .env and you're good to go.
#
# Prerequisites: Claude Code CLI and Gemini CLI must already
# be installed and authenticated before running this script.
#
# Usage:
#   chmod +x setup.sh && ./setup.sh
# ══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colours & helpers ────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No colour

info()  { printf "${CYAN}ℹ${NC}  %s\n" "$1"; }
ok()    { printf "${GREEN}✔${NC}  %s\n" "$1"; }
warn()  { printf "${YELLOW}⚠${NC}  %s\n" "$1"; }
fail()  { printf "${RED}✖${NC}  %s\n" "$1"; }
header(){ printf "\n${BOLD}── %s ──${NC}\n\n" "$1"; }

# ── Detect OS ────────────────────────────────────────────────

OS="$(uname -s)"
case "$OS" in
  Linux*)  PLATFORM="linux"  ;;
  Darwin*) PLATFORM="macos"  ;;
  *)       fail "Unsupported OS: $OS"; exit 1 ;;
esac
info "Detected platform: ${BOLD}$PLATFORM${NC}"

# ── Check prerequisites ─────────────────────────────────────

header "Checking prerequisites"

MISSING=0

# Check Claude Code CLI
if command -v claude &>/dev/null; then
  ok "Claude Code CLI found: $(command -v claude)"
else
  fail "Claude Code CLI not found."
  info "Install it: https://docs.anthropic.com/en/docs/claude-code"
  MISSING=1
fi

# Check Gemini CLI
if command -v gemini &>/dev/null; then
  ok "Gemini CLI found: $(command -v gemini)"
else
  fail "Gemini CLI not found."
  info "Install it: npm install -g @anthropic-ai/gemini-cli"
  info "Or see: https://github.com/google-gemini/gemini-cli"
  MISSING=1
fi

# Check Bun
if command -v bun &>/dev/null; then
  ok "Bun found: $(bun --version)"
else
  warn "Bun not found — will attempt to install it."
fi

# Check Git
if command -v git &>/dev/null; then
  ok "Git found"
else
  fail "Git is required. Please install git first."
  MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
  echo ""
  fail "Missing prerequisites above. Please install them first, then re-run this script."
  exit 1
fi

# ── Install Bun (if missing) ────────────────────────────────

if ! command -v bun &>/dev/null; then
  header "Installing Bun"
  curl -fsSL https://bun.sh/install | bash
  # Source the updated profile so bun is available in this session
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if command -v bun &>/dev/null; then
    ok "Bun installed: $(bun --version)"
  else
    fail "Bun installation failed. Please install manually: https://bun.sh"
    exit 1
  fi
fi

# ── Install project dependencies ────────────────────────────

header "Installing project dependencies"

cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"

bun install
ok "All workspace dependencies installed"

# ── Set up .env file ─────────────────────────────────────────

header "Setting up environment"

if [ -f "$PROJECT_ROOT/.env" ]; then
  warn ".env file already exists — skipping copy (your existing config is safe)"
else
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
  ok "Created .env from .env.example"
  info "You'll need to fill in your API keys and config — see docs/SETUP.md for details"
fi

# ── Configure Claude Code permissions ───────────────────────

header "Configuring Claude Code"

CLAUDE_DIR="$PROJECT_ROOT/.claude"
CLAUDE_SETTINGS="$CLAUDE_DIR/settings.local.json"

if [ -f "$CLAUDE_SETTINGS" ]; then
  ok "Claude Code project settings already configured"
else
  mkdir -p "$CLAUDE_DIR"
  cat > "$CLAUDE_SETTINGS" << 'SETTINGS_EOF'
{
  "permissions": {
    "allow": [
      "Bash(npx tsc:*)",
      "Bash(ls:*)",
      "Bash(bun build:*)",
      "Bash(for f:*)",
      "Bash(mkdir:*)",
      "Bash(find:*)",
      "Bash(bun install:*)",
      "Bash(bun test:*)",
      "Bash(cd:*)",
      "Bash(bunx:*)",
      "Bash(bunx tsc:*)",
      "Bash(bun run:*)",
      "Bash(grep:*)"
    ]
  }
}
SETTINGS_EOF
  ok "Created Claude Code project settings"
fi

# ── Install Claude Code skills/plugins ──────────────────────

header "Installing Claude Code skills & plugins"

# Install available Claude Code plugins
# These are optional but enhance agent capabilities
PLUGINS=("content-marketing" "theme-factory")
INSTALLED_PLUGINS=0
FAILED_PLUGINS=()

for plugin in "${PLUGINS[@]}"; do
  info "Attempting to install Claude Code plugin: ${BOLD}$plugin${NC}"
  if claude plugins install "$plugin" 2>/dev/null; then
    ok "Installed: $plugin"
    INSTALLED_PLUGINS=$((INSTALLED_PLUGINS + 1))
  else
    warn "Could not install plugin: $plugin (may not be available — this is optional)"
    FAILED_PLUGINS+=("$plugin")
  fi
done

if [ "$INSTALLED_PLUGINS" -gt 0 ]; then
  ok "Installed $INSTALLED_PLUGINS Claude Code plugin(s)"
else
  warn "No Claude Code plugins were installed (this is fine — they're optional)"
fi

# ── Verify Gemini Nano Banana skill ─────────────────────────

header "Verifying Gemini skills"

NANOBANANA_SKILL="$PROJECT_ROOT/.gemini/skills/nanobanana-imaging/SKILL.md"
if [ -f "$NANOBANANA_SKILL" ]; then
  ok "Nano Banana imaging skill found at .gemini/skills/nanobanana-imaging/"
  info "This skill is used by the SEO agent to generate hero images for websites"
else
  warn "Nano Banana skill not found — SEO agent won't be able to generate images"
fi

# ── Run linting/type check to verify setup ──────────────────

header "Verifying project builds"

info "Running lint check..."
if bun run lint 2>/dev/null; then
  ok "Lint check passed"
else
  warn "Lint check had warnings (non-blocking)"
fi

info "Running type check..."
if bun run typecheck 2>/dev/null; then
  ok "Type check passed"
else
  warn "Type check had issues — you may need to fix these before running"
fi

# ── Summary ──────────────────────────────────────────────────

header "Setup complete"

echo ""
printf "${GREEN}${BOLD}All done!${NC} Here's what's left to do:\n\n"

STEP=1

if [ -f "$PROJECT_ROOT/.env" ] && grep -q '""' "$PROJECT_ROOT/.env" 2>/dev/null; then
  printf "  ${YELLOW}${STEP}.${NC} Fill in your API keys in ${BOLD}.env${NC}\n"
  printf "     See ${BOLD}docs/SETUP.md${NC} for step-by-step instructions for each service:\n"
  printf "     • Supabase (database)\n"
  printf "     • Vercel (deployments)\n"
  printf "     • Bland.ai (phone calls)\n"
  printf "     • Stripe (payments)\n"
  printf "     • Telegram (notifications)\n"
  printf "     • Resend (email)\n"
  printf "     • Google Places API (lead discovery)\n"
  printf "     • Gemini (image generation)\n"
  printf "     • Twilio (SMS/WhatsApp — optional)\n"
  printf "     • Calendly (scheduling)\n"
  echo ""
  STEP=$((STEP + 1))
fi

if [ ${#FAILED_PLUGINS[@]} -gt 0 ]; then
  printf "  ${YELLOW}${STEP}.${NC} ${BOLD}Failed plugins${NC} (optional — install manually if needed):\n"
  for fp in "${FAILED_PLUGINS[@]}"; do
    printf "     ${RED}•${NC} $fp  →  ${CYAN}claude plugins install $fp${NC}\n"
  done
  echo ""
  STEP=$((STEP + 1))
fi

printf "  ${YELLOW}${STEP}.${NC} Set up your Supabase database\n"
printf "     Run the migration SQL from ${BOLD}docs/DATABASE.md${NC}\n"
echo ""
STEP=$((STEP + 1))
printf "  ${YELLOW}${STEP}.${NC} Start the agency:\n"
printf "     ${CYAN}bun run dev${NC}        — Run everything (API + dashboard + site)\n"
printf "     ${CYAN}bun run api${NC}        — Run the API server only\n"
printf "     ${CYAN}bun run dashboard${NC}  — Run the dashboard only\n"
echo ""
STEP=$((STEP + 1))
printf "  ${YELLOW}${STEP}.${NC} Open the dashboard at ${BOLD}http://localhost:5173${NC}\n"
echo ""
