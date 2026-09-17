# Agent instructions

## Project

**Foundry** is a zero-dependency Node.js CLI (`foundry.mjs`) that runs an inner/outer-loop software factory: a planner model writes prompts, a builder implements slices, and a reviewer grades them until features pass.

- **Runtime:** Node.js 22+ (ES modules)
- **Dependencies:** none (`package.json` has no `dependencies`)
- **Entry point:** `node foundry.mjs <spec.md> --out ./workspace`

## Cursor Cloud specific instructions

Cloud agents boot from `.cursor/environment.json`, which builds `.cursor/Dockerfile` and runs `.cursor/install.sh` during Builds. The Dockerfile does not copy the repo; Cursor clones the correct commit at agent start.

### Verify the environment

```bash
node --version          # must be v22+
node foundry.mjs --help
```

### Running Foundry

Foundry calls LLM APIs. **Do not commit API keys.** Configure secrets in Cursor (Settings → Secrets) or export them in the agent session:

| Variable | Purpose |
| --- | --- |
| `XAI_API_KEY` | Primary API key for xAI models (default) |
| `OPENAI_API_KEY` | Alternative when using OpenAI-compatible endpoints |
| `LLM_BASE_URL` | Override API base URL (optional) |

Example (requires a secret):

```bash
export XAI_API_KEY=...   # from Cursor Secrets, never hard-coded
node foundry.mjs examples/pomodoro.md --out ./workspace
```

Outputs land in the `--out` directory (`features.json`, `progress.md`, generated `index.html`, etc.). The default output path `./workspace` is gitignored.

### Optional inner harness CLIs

Foundry can shell out to external builder/reviewer harnesses when their binaries are on `PATH` (`codex`, `kimi`, `dsh`). These are **not** installed by the Cloud environment. Use API fallback models (`--builder`, `--reviewer`) unless you explicitly install a harness.

### Testing changes to Foundry itself

1. Edit `foundry.mjs` or docs.
2. Run `node foundry.mjs --help` and, when API access is available, a short spec against a temp output dir:
   ```bash
   node foundry.mjs examples/pomodoro.md --out /tmp/foundry-test --max-outer 1 --max-inner 1
   ```
3. Do not commit `./workspace` or other generated output directories.

### Environment files

| File | Role |
| --- | --- |
| `.cursor/environment.json` | Cloud Agent build + install config |
| `.cursor/Dockerfile` | Node 22 base with git/sudo (no project COPY) |
| `.cursor/install.sh` | Idempotent smoke check |
