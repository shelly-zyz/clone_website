import "server-only";

import { createHash } from "node:crypto";
import { withBusinessAction } from "@/lib/agent-runtime/policy.server";
import { assertDataProject, readDataSession } from "@/lib/data-agent/state.server";
import { themes, type FigureEdit, type VisualizationJob, type VisualizationResult, type WorkspaceRequest, VisualizationError } from "./contracts";
import { researchCatalog, resolveDatasets, type ProjectAccess } from "./datasets.server";
import { cachePreview, listFigures, readFigure, readPreview, saveFigure, type Artifact, type SavedFigure } from "./library.server";
import { planFigure, type Recipe } from "./planner";
import { availableEngines, exportECharts, exportPaper, pythonSource, renderingCapabilities, renderFigure } from "./render.server";
import { domainTools, engineCharts, skillRegistry } from "./registry";

function capabilities() {
  const engines = renderingCapabilities();
  return { engines: Object.entries(engines).map(([id, info]) => ({ id, ...info, charts: engineCharts[id as keyof typeof engines] })),
    themes,
    skills: skillRegistry, domain_tools: domainTools };
}
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => JSON.stringify(key) + ":" + stable(entry)).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
};

type Entry = { artifact: Artifact; at: number };
const cache = new Map<string, Entry>();
const preparing = new Map<string, { fingerprint: string; promise: Promise<Artifact> }>();
const lifetime = 20 * 60_000;
const maxArtifacts = 24;
const cacheId = (project: string, id: string) => project + "/" + id;
const fromCache = (key: string) => {
  const entry = cache.get(key);
  if (entry && entry.at + lifetime < Date.now()) { cache.delete(key); return; }
  return entry;
};

async function reference(project: string, id: string) {
  const key = cacheId(project, id);
  const artifact = fromCache(key)?.artifact ?? await readPreview(project, id);
  if (!artifact) throw new VisualizationError("NOT_FOUND", "当前图件已过期，请重开保存的修订或重新生成。");
  return artifact;
}
function put(key: string, entry: Entry) {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > maxArtifacts) cache.delete(cache.keys().next().value!);
}

function sameSources(a: Recipe, b: Recipe) { return stable(a.datasets) === stable(b.datasets); }

export function patchFigure(base: Recipe, { clear, ...patch }: FigureEdit): Recipe {
  const style = { ...base.style, ...patch.style };
  // Changing mode also selects its default engine and visual theme unless the user supplied replacements.
  if (patch.mode && patch.mode !== base.mode) {
    if (!patch.engine) patch = { ...patch, engine: "auto" };
    if (!patch.style?.theme) delete style.theme;
  }
  const recipe = { ...base, ...patch, style };
  for (const field of clear ?? []) {
    if (field === "title") delete recipe.title;
    else delete recipe.style[field];
  }
  return recipe;
}

function receipt(artifact: Artifact, saved?: SavedFigure): VisualizationResult {
  const { model, plan, validation, statistics, insights } = artifact.prepared;
  const panelCount = model.panels.length;
  return {
    task_id: artifact.task, artifact_id: artifact.artifact_id, figure_id: saved?.figure_id ?? artifact.artifact_id, revision: saved?.revision ?? null,
    recipe: artifact.recipe, plan, validation, statistics, insights, render: artifact.render, engine_version: artifact.engine_version,
    viewport: { panels: panelCount, rows: model.focus ? 1 + Math.ceil((panelCount - 1) / model.columns) : Math.ceil(panelCount / model.columns),
      compact_model: plan.engine === "echarts" ? model : undefined },
  };
}

async function build(job: VisualizationJob, access: ProjectAccess, signal: AbortSignal, prior?: Artifact): Promise<Artifact> {
  const key = cacheId(access.project_id, job.task_id);
  const mark = stable(job.configuration);
  const priorRun = fromCache(key);
  const pending = preparing.get(key);
  if (priorRun || pending) {
    if ((priorRun?.artifact.fingerprint ?? pending?.fingerprint) !== mark) throw new VisualizationError("CONFLICT", "此任务编号已绑定其他绘图配置。");
    return priorRun?.artifact ?? await pending!.promise;
  }
  if (preparing.size >= 4) throw new VisualizationError("BUSY", "制图任务已达到并发上限，请稍后重试。");
  const promise = (async () => {
    const completed = await readPreview(access.project_id, job.task_id);
    if (completed) {
      if (completed.fingerprint !== mark) throw new VisualizationError("CONFLICT", "此任务编号已绑定其他绘图配置。");
      return completed;
    }
    const evidence = prior && sameSources(prior.recipe, job.configuration)
      ? prior.evidence : await resolveDatasets(job.configuration.datasets, access, signal);
    const prepared = planFigure(job, evidence, availableEngines());
    const recipe = { ...job.configuration, mode: prepared.plan.engine === "matplotlib" ? "paper" as const : "interactive" as const,
      datasets: evidence.map(item => item.profile.query) };
    signal.throwIfAborted();
    const render = await renderFigure(prepared, signal);
    if (render.kind === "echarts") await exportECharts(render.option, prepared);
    const generated = { task: job.task_id, artifact_id: job.task_id, recipe, evidence, prepared, render,
      fingerprint: mark, engine_version: renderingCapabilities()[prepared.plan.engine].version };
    const artifact = await cachePreview(access.project_id, generated, signal);
    put(key, { artifact, at: Date.now() });
    return artifact;
  })();
  preparing.set(key, { fingerprint: mark, promise });
  try { return await promise; } finally { preparing.delete(key); }
}

type Command = Exclude<WorkspaceRequest, { action: "start" }>;
export function researchWorkspace(command: Command, access: ProjectAccess, signal: AbortSignal) {
  return withBusinessAction("visualization", "research_" + command.action, async () => {
    if (command.action === "catalog") return { ...capabilities(), sources: await researchCatalog() };
    await assertDataProject(access.project_id, access.key);
    signal = AbortSignal.any([signal, AbortSignal.timeout(40_000)]);
    switch (command.action) {
      case "session-source": {
        const session = await readDataSession(access.project_id, command.session_id, access.key);
        if (!session.last_result_id) throw new VisualizationError("DATA_GAP", "该问数会话没有可制图的查询结果。");
        return { result_id: session.last_result_id };
      }
      case "render": return receipt(await build(command.job, access, signal));
      case "profile": return { datasets: (await resolveDatasets(command.datasets, access, signal)).map(item => item.profile) };
      case "plan": {
        const evidence = await resolveDatasets(command.job.configuration.datasets, access, signal);
        const { plan, validation, statistics, insights } = planFigure(command.job, evidence, availableEngines());
        return { plan, validation, statistics, insights };
      }
      case "validate": {
        const artifact = await build(command.job, access, signal);
        return { artifact_id: artifact.artifact_id, plan: artifact.prepared.plan, validation: artifact.prepared.validation };
      }
      case "edit": {
        const artifact = await reference(access.project_id, command.artifact_id);
        return receipt(await build({ task_id: command.task_id, configuration: patchFigure(artifact.recipe, command.patch) }, access, signal, artifact));
      }
      case "ask": {
        const artifact = command.artifact_id ? await reference(access.project_id, command.artifact_id) : undefined;
        const { planIntent } = await import("./intent.server");
        const patch = await planIntent(command.message, command.domain, artifact, signal);
        const configuration = patchFigure(artifact?.recipe ?? { datasets: [] }, patch);
        if (!configuration.datasets.length) throw new VisualizationError("DATA_GAP", "情报空白。请提供已发布指标、数据引用或更明确的范围。");
        return receipt(await build({ task_id: command.task_id, configuration }, access, signal, artifact));
      }
      case "save": {
        const artifact = await reference(access.project_id, command.artifact_id);
        const saved = await saveFigure(access.project_id, artifact, command.figure_id, command.expected_revision, signal);
        return { saved, result: receipt(artifact, saved) };
      }
      case "list": return { figures: await listFigures(access.project_id) };
      case "open": {
        const { artifact, saved } = await readFigure(access.project_id, command.figure_id, command.revision);
        await cachePreview(access.project_id, artifact, signal);
        put(cacheId(access.project_id, artifact.artifact_id), { artifact, at: Date.now() });
        return { saved, result: receipt(artifact, saved) };
      }
      case "export": {
        const artifact = await reference(access.project_id, command.artifact_id);
        const { format } = command;
        if (!artifact.prepared.plan.output.includes(format)) throw new VisualizationError("INCOMPATIBLE", "此引擎没有所选格式的导出配方。");
        const filename = "opengridworks-" + artifact.artifact_id.slice(0, 8) + "." + (format === "python" ? "py" : format);
        const type = { svg: "image/svg+xml", png: "image/png", pdf: "application/pdf", json: "application/json", python: "text/x-python" }[format];
        if (format === "json") {
          const { model, plan, validation, statistics, insights } = artifact.prepared;
          const source_versions = plan.datasets.map(item => ({ id: item.dataset_id, version: item.source_version, digest: item.digest }));
          const manifest = { version: 1, artifact_id: artifact.artifact_id, recipe: artifact.recipe, plan,
            engine_version: artifact.engine_version, source_versions, model, validation, statistics, insights,
            option: artifact.render.kind === "echarts" ? artifact.render.option : undefined };
          const content = JSON.stringify(manifest, null, 2);
          return { filename, contentType: type, bytes: Buffer.from(content), sha256: createHash("sha256").update(content).digest("hex") };
        }
        if (format === "python") return { filename, contentType: type, bytes: await pythonSource(artifact.prepared) };
        if (artifact.render.kind === "echarts" && format === "svg") {
          return { filename, contentType: type, bytes: await exportECharts(artifact.render.option, artifact.prepared) };
        }
        if (format === "svg" && artifact.render.kind === "image") return { filename, contentType: type, bytes: Buffer.from(artifact.render.base64, "base64") };
        return { filename, contentType: type, bytes: await exportPaper(artifact.prepared, format, signal) };
      }
    }
  }, access.project_id);
}
