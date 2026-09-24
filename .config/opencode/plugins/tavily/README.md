# Tavily tools for OpenCode V2

This native V2 plugin calls the Tavily REST API for capabilities not covered by
OpenCode's web search provider:

- `tavily_extract` extracts content from known URLs.
- `tavily_map` discovers URLs on a site.
- `tavily_crawl` discovers pages and extracts their content.
- `tavily_research` starts deep research asynchronously by default.
- `tavily_research_status` checks an asynchronous request once.
- `tavily_research_poll` waits for an asynchronous request to finish.

It intentionally leaves OpenCode's built-in search unchanged and does not add
login, logout, streaming, or filesystem-output tools.

## Prerequisites

Connect OpenCode's built-in Tavily integration or set `TAVILY_API_KEY` in the
environment available to OpenCode. Each invocation first resolves the active
`tavily` integration and uses its API-key credential, then falls back to the
environment variable. OAuth tokens and CLI credential files are not used.

## Usage

Use extract when URLs are already known, map for site discovery, and crawl when
page content is needed. Use research for a comprehensive synthesis. For long
research tasks, retain the returned request ID, then pass it to research_status
or research_poll. This asynchronous behavior is the default and recommended
mode. Set `no_wait: false` only when the call should wait for completion.

`chunks_per_source` requires `query` for extract and `instructions` for crawl.
Regex filters are sent as arrays, so patterns containing commas are preserved.
Research `output_schema` accepts a bounded inline Tavily schema with up to four
nested object/array levels; it never accepts a file path. `poll_interval` and
research `timeout` control local polling only and are never sent to Tavily.

## Safety and defaults

Inputs are strictly validated and only documented REST fields are allowlisted.
HTTP URLs cannot contain credentials. The API origin and credential are fixed by
the plugin and cannot be supplied by a model. POST requests are never retried.

All six tools use the distinct `tavily` permission action as metadata for
blanket tool filtering. Per the installation policy, the plugin itself does not
issue per-call prompts or enforce `webfetch` URL rules. Responses are streamed
with a 10 MiB cap, checked for valid JSON, and protected by bounded HTTP and
polling timeouts. OpenCode 2.0.3 does not expose cancellation on native tool
execution context, so the plugin uses its documented local timeout bounds rather
than an undocumented signal. OpenCode handles normal tool-result truncation.
Diagnostics are bounded and common credential forms are redacted. If waiting
after research creation fails or times out, the error retains `request_id` so a
paid task can be recovered without submitting a duplicate.
