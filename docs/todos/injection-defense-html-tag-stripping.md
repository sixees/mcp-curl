# TODO: Strip HTML tags and markdown image beacons from responses

## Problem

HTML comment stripping (`<!-- ... -->`) was added in the prompt injection defense PR, but
full HTML tag content (`<script>`, `<style>`, inline event handlers) and markdown image
beacons (`![x](https://tracker.example.com/pixel)`) are not stripped. Both can be used
to embed injection payloads that survive comment removal.

## Proposed Fix

- Strip `<script>` and `<style>` blocks (tag + content) from `text/html` responses before
  returning to the LLM.
- Consider stripping markdown image syntax `![...](url)` where the URL points to an
  external domain (to prevent exfiltration via image loading).

## Scope

This is a follow-on to the injection defense feature. Significant new logic — warrants a
separate PR with its own test coverage and threat model analysis.

## Location

- `src/lib/response/processor.ts` — `processResponse()` (after HTML comment stripping)

## Source

PR #20 code review (coderabbitai)
