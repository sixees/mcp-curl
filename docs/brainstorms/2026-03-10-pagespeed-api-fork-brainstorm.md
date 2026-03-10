# PageSpeed Insights API Fork Configuration

**Date:** 2026-03-10
**Status:** Complete
**Branch:** `pagespeed`

## What We're Building

A fork-specific configuration of mcp-curl for the Google PageSpeed Insights API v5. This tests the fork workflow by creating a real, useful API integration using the `configs/` directory convention.

**Single tool** (`analyze_pagespeed`) that runs a PageSpeed analysis on any URL, with strategy selection (MOBILE/DESKTOP) and jq filter presets to extract the scores and metrics that matter.

### API Details

- **Endpoint:** `GET https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed`
- **Auth:** API key as query parameter (`key=`), sourced from `PAGESPEED_API_KEY` env var. Key is optional — API works without it at lower rate limits. Set `required: false` in schema.
- **Timeout:** Set to 60s. PageSpeed analysis routinely takes 15-45s for complex pages; the default 30s will cause failures.
- **Multi-category constraint:** API requires repeated `&category=X` params. The YAML schema doesn't support this, so the TypeScript entry point uses a `beforeRequest` hook to inject all 4 categories. Fallback: if the hook can't modify the URL, register the tool directly via `registerCustomTool()` instead of YAML generation.

### Metrics to Extract

**Category Scores** (0-1 float, multiply by 100 for percentage):
- `PERFORMANCE` (also serves as "Overall Score")
- `ACCESSIBILITY`
- `BEST_PRACTICES`
- `SEO`

**Core Web Vitals & Timing Metrics:**
- LCP (Largest Contentful Paint) — `lighthouseResult.audits.largest-contentful-paint`
- FCP (First Contentful Paint) — `lighthouseResult.audits.first-contentful-paint`
- CLS (Cumulative Layout Shift) — `lighthouseResult.audits.cumulative-layout-shift`
- Total Blocking Time — `lighthouseResult.audits.total-blocking-time`
- Interactive (TTI) — `lighthouseResult.audits.interactive`

### jq Filter Presets

1. **`scores`** — All 4 category scores as percentages
2. **`metrics`** — Core Web Vitals + timing metrics (display value + numeric)
3. **`summary`** — Compact view: all scores + all metrics in one object

## Why This Approach

### One tool with strategy parameter (not two separate tools)
- Simpler — the LLM can choose MOBILE or DESKTOP per request
- Less tool clutter in the MCP tool list
- Default to MOBILE (Google's primary ranking signal)

### beforeRequest hook for multi-category injection
- The YAML schema's parameter model is single-value per query param
- The PageSpeed API requires `&category=PERFORMANCE&category=ACCESSIBILITY&category=BEST_PRACTICES&category=SEO`
- A `beforeRequest` hook in the TypeScript entry point injects all 4 categories regardless of what the YAML defines
- This keeps the YAML clean and the endpoint definition simple

### CLS instead of FMP
- FMP (First Meaningful Paint) is deprecated since Lighthouse 6
- CLS (Cumulative Layout Shift) is a current Core Web Vital
- More useful and reliable data

### Performance score as "Overall Score"
- PageSpeed doesn't have an explicit overall score
- Performance is the primary category and closest to what users mean by "page speed score"
- All 4 categories still shown individually

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool count | 1 (`analyze_pagespeed`) | Simpler, strategy as parameter |
| Strategy default | MOBILE | Google's primary ranking signal |
| FMP replacement | CLS | FMP deprecated, CLS is Core Web Vital |
| Overall score | Performance category | Most intuitive, no synthetic average |
| Category injection | `beforeRequest` hook | YAML schema can't repeat query params |
| Auth env var | `PAGESPEED_API_KEY` | Descriptive, conventional |
| Auth required | No | API works without key at lower rate limits |
| Timeout | 60s | PageSpeed analysis takes 15-45s for complex pages |
| Hook fallback | `registerCustomTool()` | If `beforeRequest` can't modify URL params |

## Files to Create

```
configs/
  pagespeed.yaml          # API definition (gitignored)
  pagespeed.ts            # Entry point with hooks (gitignored)
```

## Resolved Questions

- **FMP deprecated?** — Yes, replaced with CLS
- **Overall score?** — Use Performance category score
- **Tool structure?** — Single tool with strategy parameter
