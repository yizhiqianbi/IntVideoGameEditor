# SEO Knowledge Research 2026-08-03

## Scope

This was a broad, primary-source web research pass rather than a claim to have exhausted every SEO page on the internet. It reviewed 33 current official sources across 10 official domains and compared relevant public agent skills through skills.sh and SkillsMP.

Research families:

- Google Search foundations, crawling, rendering, indexing, canonicalization, redirects, sitemaps, crawl budget, migrations, spam, structured data, international, ecommerce, images, video, traffic drops, testing, and Search Console APIs
- Google generative Search and 2026 AI optimization guidance
- Bing Webmaster Tools, sitemaps, crawl control, and IndexNow
- Schema.org vocabulary validation
- web.dev Core Web Vitals definitions and thresholds
- OpenAI Search/training/user-triggered crawlers and publisher measurement
- Perplexity crawler controls
- Microsoft public-web grounding guidance

Machine-readable evidence index: `data/seo-source-registry.json`.

## Material corrections discovered

### Google generative-AI reporting

The 1.1 reference said AI-feature traffic was only visible inside the Search Console Web type. Google's newer 2026 guide documents a dedicated Generative AI performance report, while broader documentation still describes AI-feature traffic as contributing to Web reporting. Version 1.2 records both views and requires property/rollout verification.

Sources:

- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://developers.google.com/search/docs/appearance/ai-features

### AI optimization myths

Google's current guide explicitly says no special AI schema, required AI text file, ideal chunk size, or AI-only rewriting pattern is needed. It says `llms.txt` neither helps nor harms Google Search visibility, while scaled fan-out pages created to manipulate results can violate policy.

### Structured-data lifecycle

Schema.org syntax validity, Google feature eligibility, and actual rich-result appearance are separate states. Current Search Console API documentation says FAQ rich results stopped appearing on 2026-05-07 and the related Search appearance support is being deprecated.

Sources:

- https://schema.org/docs/validator.html
- https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query

### Core Web Vitals

The current metrics are LCP, INP, and CLS, evaluated from field distributions at the 75th percentile. Lab tools remain diagnostic and cannot prove real-user status or ranking impact.

Source: https://web.dev/articles/defining-core-web-vitals-thresholds

### Search Console completeness

Tables and APIs can omit anonymized queries and lower-volume rows; page/query grouping can lose data; aggregation and search types change interpretation. Missing table rows cannot be reconstructed as factual keywords or volumes.

Sources:

- https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query

### Crawler purpose separation

OpenAI documents separate controls for `OAI-SearchBot`, `GPTBot`, and user-triggered `ChatGPT-User`; Perplexity separately documents its Search crawler. Search discovery, model training, and user-initiated agent access are not one permission.

Sources:

- https://developers.openai.com/api/docs/bots
- https://help.openai.com/en/articles/12627856-publishers-and-developers-faq
- https://docs.perplexity.ai/docs/resources/perplexity-crawlers

### Notification is not indexing

IndexNow success responses mean a URL notification was received or accepted. They do not prove crawl, index, ranking, or support by every engine. Sitemaps and crawlable architecture remain necessary.

Source: https://www.indexnow.org/documentation

## Stable synthesis

- Diagnose the search pipeline by stage, not with a single “indexed/not indexed” label.
- Keep engine, surface, market, device, date, evidence layer, and coverage visible.
- Prefer first-party and rendered evidence; use third-party metrics as dated estimates.
- Treat content creation and deletion as product/inventory decisions with user value, dependencies, and rollback.
- Use controlled experiments when possible; otherwise lower causal confidence.
- Store mutable platform rules with official sources and review cadence instead of hard-coding them as eternal truths.

## Limits

- Documentation describes intended provider behavior, not guaranteed outcomes for a particular site.
- Search layouts, reports, crawlers, and policies remain mutable.
- No provider-backed model output benchmark or human blind comparison was run in this upgrade.
