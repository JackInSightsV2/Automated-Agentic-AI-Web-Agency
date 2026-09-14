/**
 * Slug for a lead's preview directory (preview/<slug>) and Vercel project name.
 * Builder, SEO, reviewer, deployer, and delivery must all agree on this.
 */
export function leadSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/, '')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'site'
}
