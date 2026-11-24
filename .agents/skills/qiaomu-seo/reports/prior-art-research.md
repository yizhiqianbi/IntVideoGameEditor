# Qiaomu SEO 1.2 Prior-Art Research

- Researched at: 2026-08-03
- Catalogs: skills.sh and SkillsMP through Qiaomu Meta's built-in discovery workflow
- Queries: `technical seo audit`, `seo content strategy`, `international ecommerce seo`, `seo measurement experimentation`, `programmatic seo`, `ai seo`, `seo audit`, `ecommerce seo`
- Rating evidence: unavailable. Neither catalog exposed a trustworthy per-skill user rating/review field.
- Metric semantics: skills.sh numbers are installs; SkillsMP numbers are repository stars, not installs or skill ratings.
- SkillsMP quality note: several broad queries returned unrelated high-star repository skills; candidates were deduplicated and source-inspected before inclusion.

## Shortlist

| Candidate | Dated discovery signal | Concrete contribution | Rejected or constrained | License |
|---|---|---|---|---|
| `coreyhaines31/marketingskills@seo-audit` | 177.3K skills.sh installs | blocker-first sequencing, rendered-DOM caution, action-oriented audit | fixed metadata/H1/word-count rules and unsupported causal percentages | MIT |
| `coreyhaines31/marketingskills@programmatic-seo` | 112.5K skills.sh installs | page-specific value, defensible data, staged architecture and monitoring | “subfolders always beat subdomains,” demand metrics without source, and index-volume heuristics as laws | MIT |
| `agricidaniel/claude-seo@seo-ecommerce` | 3.5K skills.sh installs | optional live-data degradation, cost guardrail, product/variant and marketplace separation prompts | fixed title/description/word/image thresholds, universal weighted scores, provider lock-in, and mixing organic with paid Shopping | MIT |
| `affaan-m/ECC@seo` | found through SkillsMP; 233,627 repository stars | concise implementation-oriented finding/action format | repository stars as skill quality, brittle thresholds, and generic certainty | MIT |

Supporting references retained from 1.1: `firecrawl/firecrawl-workflows@firecrawl-seo-audit` (30.1K installs) for source collection/rerun inputs and `coreyhaines31/marketingskills@ai-seo` (101.4K installs) for separating citation, mention, recommendation, and conversion. Their unsupported AI percentages, special-file promises, and universal crawler claims remain rejected.

## Official knowledge research

Skill prior art shaped workflow mechanics; it was not used as authority for search-engine behavior. Version 1.2 separately reviewed 33 first-party sources across Google, Bing, IndexNow, Schema.org, web.dev, OpenAI, Microsoft, and Perplexity. See `reports/seo-knowledge-research.md` and `data/seo-source-registry.json`.

Material corrections included:

- a newer dedicated Google Generative AI performance report alongside broader Web performance reporting
- Google explicitly ignoring `llms.txt` for Search visibility/ranking and rejecting AI-only chunking/rewrite folklore
- FAQ rich-result removal and Search Console appearance deprecation
- OpenAI search, training, and user-triggered crawlers as separate controls
- IndexNow receipt as notification evidence rather than index evidence
- Search Console privacy, row, grouping, and aggregation limitations

## Synthesis ledger

### Keep

- dependency-ordered diagnosis and rendered evidence
- page-specific actions and rerun inputs
- page-specific value and defensible data before programmatic scale
- graceful degradation when commercial data sources are unavailable

### Adapt

- replace universal scoring with finding-level impact, confidence, evidence, dependency, and verification
- turn “SEO knowledge” into stable principles plus dated platform rules and observed market state
- separate organic web, merchant feeds, shopping surfaces, paid campaigns, image/video, and AI search
- turn content pruning into page-inventory decisions with rollback rather than a zero-traffic rule

### Reject

- exact title/meta/word/image/link thresholds as ranking laws
- self-assigned ranking-factor weights, universal SEO scores, and guaranteed outcomes
- URL-scale, repository-star, install, or tool score as proof of quality
- vendor-specific APIs as mandatory dependencies
- bot, schema, reporting, or rich-result behavior generalized across providers or time

### Invent

- 33-source registry with stability class, review cadence, lifecycle notes, and official-domain validation
- deterministic stale-claim guard that caught and removed a real 1.1 claim
- a search-engine/crawler purpose matrix separating search, training, and user-triggered access
- four-stage implementation outcome: implemented, deployed, processed by platform, outcome observed
- experiment gate and destructive-content decision ledger

## Missing evidence

- No provider-backed head-to-head output benchmark or human blind comparison was run.
- Catalog popularity metrics do not demonstrate correctness, safety, or user satisfaction.
- Official documentation does not guarantee behavior for a particular URL or account rollout.
- Search features, policies, crawlers, reports, and API limits remain mutable after the review date.
