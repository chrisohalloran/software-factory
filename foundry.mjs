#!/usr/bin/env node
/**
 * Foundry — a tiny software factory.
 *
 * Outer loop (Ralph / Anthropic long-running harness):
 *   gather context → LLM writes the prompts → pick one slice
 * Inner loop:
 *   builder model implements → reviewer model (different) grades → fixer patches
 * Repeat until the feature list is done.
 *
 *   XAI_API_KEY=... node foundry.mjs ./spec.md --out ./workspace
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const FALLBACK = "grok-4.5";
const DEFAULTS = {
  planner: "grok-4.3",
  builder: "grok-build-0.1",
  reviewer: "grok-4.5",
  maxOuter: 8,
  maxInner: 3,
};

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function has(flag) {
  return process.argv.includes(flag);
}

function extractJson(text) {
  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

function parseFiles(text) {
  const files = [];
  const re = /===FILE\s+path=([^\n=]+)===\r?\n([\s\S]*?)===END FILE===/g;
  let m;
  while ((m = re.exec(text))) {
    files.push({ path: m[1].trim().replace(/^\/+/, ""), content: m[2].replace(/^\n/, "").replace(/\n$/, "") });
  }
  let summary = "";
  const meta = text.match(/===META===\r?\n([\s\S]*)$/);
  if (meta) {
    try {
      summary = extractJson(meta[1]).summary ?? "";
    } catch {
      summary = meta[1].trim().slice(0, 240);
    }
  }
  return { files, summary };
}

async function chat({ model, system, user, maxTokens, temperature = 0.3, json = false }) {
  const key = process.env.XAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Set XAI_API_KEY (or OPENAI_API_KEY)");
  const base = process.env.LLM_BASE_URL || (process.env.XAI_API_KEY ? "https://api.x.ai/v1" : "https://api.openai.com/v1");

  const once = async (useModel) => {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: useModel,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${useModel} ${res.status}: ${t.slice(0, 280)}`);
    }
    const body = await res.json();
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("Empty model response");
    return { text, model: useModel };
  };

  try {
    return await once(model);
  } catch (err) {
    if (model !== FALLBACK) {
      console.warn(`  retrying with ${FALLBACK}: ${err.message}`);
      return await once(FALLBACK);
    }
    throw err;
  }
}

async function writeAll(root, files) {
  for (const f of files) {
    const dest = join(root, f.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.content, "utf8");
  }
}

function tree(files, cap = 7000) {
  if (!files.length) return "(empty)";
  return files
    .map((f) => {
      const body = f.content.length > 1800 ? f.content.slice(0, 1800) + "\n…" : f.content;
      return `## ${f.path}\n${body}`;
    })
    .join("\n\n")
    .slice(0, cap);
}

async function main() {
  if (has("--help") || has("-h") || process.argv.length < 3) {
    console.log(`Foundry — inner/outer loop software factory

Usage:
  XAI_API_KEY=... node foundry.mjs <spec.md> --out ./workspace

Options:
  --planner MODEL     outer loop + prompt writer  (default ${DEFAULTS.planner})
  --builder MODEL     implements / fixes          (default ${DEFAULTS.builder})
  --reviewer MODEL    independent review          (default ${DEFAULTS.reviewer})
  --max-outer N       (default ${DEFAULTS.maxOuter})
  --max-inner N       (default ${DEFAULTS.maxInner})
  --out DIR           workspace root
`);
    process.exit(0);
  }

  const specPath = resolve(process.argv[2]);
  const outDir = resolve(arg("--out", "./workspace"));
  const models = {
    planner: arg("--planner", DEFAULTS.planner),
    builder: arg("--builder", DEFAULTS.builder),
    reviewer: arg("--reviewer", DEFAULTS.reviewer),
  };
  const maxOuter = Number(arg("--max-outer", DEFAULTS.maxOuter));
  const maxInner = Number(arg("--max-inner", DEFAULTS.maxInner));
  const spec = await readFile(specPath, "utf8");

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "SPEC.md"), spec);

  console.log(`\nFoundry  planner=${models.planner}  builder=${models.builder}  reviewer=${models.reviewer}\n`);

  const init = await chat({
    model: models.planner,
    json: true,
    maxTokens: 1600,
    temperature: 0.35,
    system: `You initialize a software factory. Return JSON:
{"title":"...","features":[{"id":"f1","title":"...","acceptance":"..."}]}
4-6 ordered slices. First slice creates a working index.html. No code yet.`,
    user: spec,
  });
  const boot = extractJson(init.text);
  const features = (boot.features ?? []).map((f, i) => ({
    id: f.id || `f${i + 1}`,
    title: f.title,
    acceptance: f.acceptance || f.title,
    status: "pending",
  }));
  const progress = [`Initialized ${boot.title} with ${features.length} slices.`];
  await writeFile(join(outDir, "features.json"), JSON.stringify(features, null, 2));
  await writeFile(join(outDir, "progress.md"), progress.join("\n"));
  console.log(`init  ${boot.title}  ${features.length} slices`);

  let files = [];
  let lastReview = null;

  for (let turn = 1; turn <= maxOuter; turn++) {
    const pending = features.filter((f) => f.status !== "done");
    if (!pending.length) break;

    console.log(`\n── outer ${turn}  gathering + writing prompts`);
    const planRes = await chat({
      model: models.planner,
      json: true,
      maxTokens: 1800,
      temperature: 0.4,
      system: `You are the OUTER LOOP and the prompt writer.
Gather state, pick ONE next slice, WRITE builderPrompt and reviewerPrompt.
JSON: {gatherSummary, done, nextFeatureId, rationale, builderPrompt, reviewerPrompt}
Builder output format:
===FILE path=index.html===
...
===END FILE===
===META===
{"summary":"..."}
Do not write application code.`,
      user: `SPEC\n${spec}\n\nFEATURES\n${features.map((f) => `[${f.status}] ${f.id} ${f.title} — ${f.acceptance}`).join("\n")}\n\nPROGRESS\n${progress.slice(-8).join("\n")}\n\nLAST REVIEW\n${JSON.stringify(lastReview)}\n\nFILES\n${tree(files)}`,
    });
    const plan = extractJson(planRes.text);
    if (plan.done) {
      console.log("prompt writer: product complete");
      break;
    }
    const feature = features.find((f) => f.id === plan.nextFeatureId) || pending[0];
    feature.status = "in_progress";
    await writeFile(join(outDir, "builder.prompt.md"), plan.builderPrompt ?? "");
    await writeFile(join(outDir, "reviewer.prompt.md"), plan.reviewerPrompt ?? "");
    console.log(`plan   ${feature.id}  ${feature.title}`);
    console.log(`       ${plan.rationale || plan.gatherSummary || ""}`);

    const built = await chat({
      model: models.builder,
      maxTokens: 5000,
      temperature: 0.25,
      system: `Builder. Implement one slice. Output file blocks only.
===FILE path=index.html===\n...\n===END FILE===\n===META===\n{"summary":"..."}`,
      user: `${plan.builderPrompt}\n\nCURRENT FILES\n${tree(files, 8000)}`,
    });
    const produced = parseFiles(built.text);
    if (!produced.files.length) throw new Error("Builder produced no files");
    const map = new Map(files.map((f) => [f.path, f]));
    for (const f of produced.files) map.set(f.path, f);
    files = [...map.values()];
    await writeAll(outDir, files);
    console.log(`build  ${produced.summary || produced.files.map((f) => f.path).join(", ")}`);

    let passed = false;
    for (let inner = 1; inner <= maxInner; inner++) {
      const reviewed = await chat({
        model: models.reviewer,
        json: true,
        maxTokens: 1200,
        temperature: 0.15,
        system: `Reviewer. Different model wrote this. JSON:
{"verdict":"pass"|"fail","score":1,"issues":[{"severity":"must"|"should","detail":"..."}],"summary":"..."}
Fail on missing acceptance or broken HTML/JS.`,
        user: `${plan.reviewerPrompt}\n\nSLICE ${feature.title} — ${feature.acceptance}\n\nFILES\n${tree(files, 9000)}`,
      });
      lastReview = extractJson(reviewed.text);
      const must = (lastReview.issues || []).some((i) => i.severity === "must");
      passed = lastReview.verdict === "pass" && !must;
      console.log(`review ${lastReview.verdict}  ${lastReview.summary || ""}`);
      if (passed) break;
      if (inner === maxInner) break;

      const fixed = await chat({
        model: models.builder,
        maxTokens: 5000,
        temperature: 0.2,
        system: `Fixer. Patch listed issues only. Output full updated file blocks.`,
        user: `ISSUES\n${(lastReview.issues || []).map((i) => `- (${i.severity}) ${i.detail}`).join("\n")}\n\nFILES\n${tree(files, 9000)}`,
      });
      const patched = parseFiles(fixed.text);
      for (const f of patched.files) map.set(f.path, f);
      files = [...map.values()];
      await writeAll(outDir, files);
      console.log(`fix    ${patched.summary || "patched"}`);
    }

    feature.status = passed ? "done" : "blocked";
    progress.push(`Turn ${turn}: ${feature.title} → ${feature.status}`);
    await writeFile(join(outDir, "features.json"), JSON.stringify(features, null, 2));
    await writeFile(join(outDir, "progress.md"), progress.join("\n") + "\n");
    if (!passed) console.warn("slice blocked — outer loop will decide whether to retry");
  }

  const left = features.filter((f) => f.status !== "done");
  console.log(left.length ? `\nstopped with ${left.length} slices open` : "\ndone — all slices passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
