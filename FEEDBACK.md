# Feedback: Nebius Token Factory, NVIDIA Nemotron & OpenShell, Tavily

A running log kept while building Vouch. Each item: **what happened → impact → suggestion**. Items are marked
with how we know: **[observed]** = happened to us during the build; **[measured]** = counted by Vouch's router
diagnostics during the published eval run (`provider_diagnostics` in `evals/results/latest.json`). We do not
include anything we did not experience.

## Nebius Token Factory

1. **[observed] Base URL is ambiguous across sources.** Third-party integration docs disagree on whether the
   OpenAI-compatible base is `https://api.tokenfactory.nebius.com/v1` or the bare host; the product page shows
   the bare host. → We lost time and made it configurable with a `/v1/` default. → *Suggestion:* one canonical
   "OpenAI SDK quickstart" snippet at the top of the docs (`base_url=".../v1/"`), and accept both forms server-side.
2. **[observed] No documented way to toggle Nemotron reasoning per request.** Nemotron's chat template supports
   `enable_thinking`, but we could not find Token Factory docs saying whether `chat_template_kwargs` is passed
   through, or whether there is a native `reasoning` parameter / budget. → Vouch sends
   `extra_body={"chat_template_kwargs": {"enable_thinking": …}}` and auto-drops it if rejected (counted as
   `rejected_chat_template_kwargs`). → *Suggestion:* document per-model reasoning controls (on/off, budget) and
   whether reasoning tokens come back in `reasoning_content` or inline `<think>` tags (we count
   `think_tags_in_content`).
3. **[observed] Model IDs are hard to predict.** Third-party catalogs list Lightning as
   `nvidia/Nemotron-3_5-Lightning` (underscore in the version) while other families use dashes and dots. →
   Hard-coding IDs is brittle, so Vouch resolves roles from `GET /models` by normalised substrings and lets env
   vars override. → *Suggestion:* stable aliases (e.g. `nemotron-lightning-latest`) and model metadata on
   `/models` (context length, supports JSON schema / tools / reasoning, price per 1M tokens) so routers can
   self-configure. Prices on `/models` would let apps do accurate cost accounting without a hand-kept table.
4. **[observed] Structured-output support is not stated per model.** We could not tell in advance which models
   accept `response_format: json_schema` vs `json_object`. → Vouch tries JSON schema, falls back to JSON mode,
   then to prompt-only plus a repair round, and counts each step (`rejected_json_schema`, `json_repair_round`).
   → *Suggestion:* a capability matrix per model in the docs and in `/models`.
5. **[observed] Hackathon credit visibility.** For an always-on agent, the key question is "how much does a day
   cost?". → We built per-call accounting and a per-session/global cap ourselves. → *Suggestion:* a usage API
   (spend by model and API key, per day) so hosted demos can enforce budgets from the source of truth.
6. **[measured — filled by the published run]** JSON validity, repair rounds, retries/rate limits and latency
   per role: see `provider_diagnostics` and the latency table in `evals/results/latest.md`. We will summarise the
   real numbers here after the Token Factory run; we are not guessing them in advance.

## NVIDIA Nemotron (roles we use)

7. **[observed] The family maps cleanly onto an agent's trust boundaries.** Having Nano (cheap, constrained
   reader), Lightning (always-on loop), Super (planner) and Ultra (rare deep audit) from one family made the
   CaMeL-style split practical: the expensive model never has to read untrusted text, and the model that does is
   cheap enough to run on every page and email. → *Suggestion:* publish recommended settings for "quarantined
   extractor" use (thinking off, schema decoding) — it is a common security pattern.
8. **[measured — filled by the published run]** Per-role JSON reliability and instruction-detection quality vs
   our deterministic detector (the reader output records `source: detector | model | both` for every detected
   instruction).

## NVIDIA OpenShell

9. **[observed] Policy schema docs are good; non-interactive exec is undocumented.** The policy reference
   (`filesystem_policy`, `network_policies` with per-binary endpoints, `process`) let us generate a policy from
   each skill's permission manifest. But the docs only show `openshell sandbox create` dropping into an
   interactive shell; we found no documented way to run one command non-interactively, pass stdin, or copy files
   in/out. → Vouch's hosted demo falls back to a subprocess sandbox; the OpenShell adapter needs a user-supplied
   exec template. → *Suggestion:* document `openshell sandbox exec <name> -- <cmd>` (or equivalent) with stdin/
   stdout semantics and a file upload/download command — that is exactly what agent frameworks need to run
   third-party skills.
10. **[observed] Platform support.** Windows needs WSL2 (experimental) and Docker/Podman or virtualization, and
    free CPU hosting like Hugging Face Spaces cannot run nested sandboxes. → *Suggestion:* a "policy-only" mode
    or library that enforces the same YAML policy in-process (e.g. Landlock + seccomp profile generator) for
    environments where a gateway is not possible.

## Tavily

11. **[observed] `research()` is asynchronous in the Python SDK.** `TavilyClient.research()` returns a
    `request_id` and you poll `get_research()`; the SDK reference URL we tried returned 404 and search results
    did not show the method. → We implemented polling with a timeout and a fallback to `search`. →
    *Suggestion:* document `research`/`get_research` with a polling example and the response shape (content,
    sources) next to `search` and `extract`.
12. **[observed] Raw HTML.** `extract` returns cleaned markdown/text. For security tooling we want the raw HTML
    too, because hidden-text attacks are only visible there (CSS `display:none`, white-on-white, comments). →
    Vouch keeps raw HTML for its own demo pages and relies on Tavily's text for others. → *Suggestion:* an
    `include_raw_html` option on `extract` (or a flag listing text that was hidden by CSS).
13. **[observed] Caching is the user's job.** Deterministic demos and eval reproducibility needed a request-keyed
    cache. → *Suggestion:* an official cache/ETag or `request_id` replay so evals can be re-run byte-identically.

## Other tools we touched

14. **[observed] MCP Python SDK 2.x renamed `FastMCP` to `MCPServer`.** `from mcp.server.fastmcp import FastMCP`
    raises with a migration message in mcp 2.3. → Vouch imports either. (Not a Nebius/NVIDIA product, but it
    affects anyone wiring Hermes/NemoClaw stacks to MCP servers.)
15. **[observed] Hermes Agent custom-provider docs are spread across vendor guides.** We found the
    `model: {provider: custom, base_url, default}` and `mcp_servers` shape in third-party integration pages
    rather than one reference. → *Suggestion (to NVIDIA/Nebius):* an official "Hermes/NemoClaw on Token Factory"
    page with a copy-paste `config.yaml`.
