# PremiumCMS SaaSTEMLY theme

A complete website for a software studio or digital agency: a landing page with services, selected work, engagement models, team, testimonials and FAQ; a portfolio of case studies; an about page with values, full team bios and a company timeline; a milestone-by-milestone process page; indicative pricing; a blog; a contact page; and Terms and Privacy.

Served by PremiumCMS as is, or forked to your GitHub and hosted on GitHub Pages with one-click theme updates. Everything on the pages is designed in the page builder; the seed in `seed/` also creates the contact form and the Site Kit business profile.

## Pages

| Page | Path | What it holds |
| --- | --- | --- |
| Home | `/` | hero, tech strip, six services, four featured projects, three engagement models, team, testimonials, FAQ, latest posts, CTA |
| Portfolio | `/portfolio` | every project as a case study — screenshot, industry, duration, team size, stack, live link |
| About | `/about` | mission, stats, values, full team bios, company timeline |
| Process | `/process` | discovery → the milestone loop → delivery, including the decision points |
| Pricing | `/pricing` | three indicative packages and the three engagement models |
| FAQ | `/faq` | the full FAQ, with FAQ structured data via Site Kit |
| Contact | `/contact` | contact details plus the seeded `contact` form |
| Blog | `/posts` | the `posts` collection, with `category` and `tag` taxonomies |
| Legal | `/terms`, `/privacy` | Terms of Service and Privacy Policy |

`/blog`, `/blogs` and `/work` redirect to their current paths.

## Plugins

- `premium-forms` — the contact form (name, email, subject, budget, engagement model, message)
- `premium-site-kit` — schema.org ProfessionalService profile, analytics, FAQ structured data, cookie consent

## Customise

Admin → Pages for copy and layout (each page is one page-builder block, so the whole design is editable in place). Plugins → Forms → Contact for the form fields and notification emails. Plugins → Site Kit → Settings for the business profile, GA4 and the consent banner. Admin → Colour schemes to change the palette — the theme ships with `tangerine` and reads every colour from the scheme tokens, so a swap re-themes the whole site.

Project screenshots live in `public/projects/`, team photos in `public/team/` and the logo in `public/logo/`; replace them there and update the matching page in the admin (or in `seed/content/pages/`).
