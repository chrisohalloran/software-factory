# Foundry

A small **software factory**. You give it a spec. It loops until the product is done.

Inspired by the [Ralph Wiggum loop](https://github.com/yy/wiggum) (fresh context, state on disk), Anthropic’s [long-running agent harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (initializer + coding agent, feature list, progress file), and [mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent) (a tiny inner loop). The twist: **an LLM writes the prompts each turn**, and **builder and reviewer are different models**.

```text
SPEC
  │
  ▼
INITIALIZER ──► features.json + progress.md
  │
  ▼
┌──────────── OUTER LOOP (fresh each turn) ─────────────┐
│  1. Gather: spec, features, progress, files, review   │
│  2. Prompt writer (planner model) drafts this turn    │
│  3. Pick the next-best slice                          │
│                                                       │
│     ┌──── INNER LOOP ──────────────────────────┐      │
│     │  Builder model implements the slice      │      │
│     │  Reviewer model (different) grades it    │      │
│     │  Fixer patches  ──► review again         │      │
│     │  until pass or inner cap                 │      │
│     └──────────────────────────────────────────┘      │
│  4. Record progress, mark the slice, repeat           │
└───────────────────────────────────────────────────────┘
```

## CLI

Zero npm dependencies. Node 22+.

```bash
git clone https://github.com/chrisohalloran/software-factory
cd software-factory
export XAI_API_KEY=...          # or OPENAI_API_KEY + LLM_BASE_URL
node foundry.mjs examples/pomodoro.md --out ./workspace
```

```text
node foundry.mjs <spec.md> --out ./workspace
  --planner           grok-4.3
  --builder-harness   grok-build | codex | kimi | deepseek
  --reviewer-harness  grok-build | codex | kimi | deepseek
  --builder           grok-build-0.1     API fallback model
  --reviewer          grok-4.6
  --max-outer 8
  --max-inner 3
```

## Inner harnesses

Foundry is the **outer** loop. Each inner slice is dispatched to a named harness. If the binary is on your `PATH`, Foundry shells out to it in the workspace. Otherwise it runs that harness's protocol through the xAI API.

| Harness | Binary | Protocol |
| --- | --- | --- |
| Grok Build | (xAI API) | `grok-build-0.1` file-block patch |
| Codex | `codex exec --ephemeral` | [openai/codex](https://github.com/openai/codex) |
| Kimi Code | `kimi -p --quiet` | [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code) |
| DeepSeek | `dsh run` | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |

Default: builder **Grok Build**, reviewer **Codex** (a different harness).

On disk after a run:

| File | Role |
| --- | --- |
| `SPEC.md` | Original request (immutable) |
| `features.json` | Slice checklist — source of truth |
| `progress.md` | What each turn learned |
| `builder.prompt.md` | Last LLM-written builder prompt |
| `reviewer.prompt.md` | Last LLM-written reviewer prompt |
| `index.html` | The product |

## Why two loops

Context windows rot. The **outer loop** is stateless: every turn rereads the spec, the feature list, git-less file state, and the progress log, then decides the next bounded slice. The **inner loop** is a specialist fight: one **harness** writes, a *different* harness reviews, the writer fixes, until the slice’s acceptance is met.

The prompt writer is the point. Static `PROMPT.md` files go stale. Here the planner model composes builder and reviewer prompts from the actual workspace, every turn.

## License

MIT
