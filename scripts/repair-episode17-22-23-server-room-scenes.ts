import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../server/src/lib/prisma";
import { callConfiguredImageModel } from "../server/src/ai/imageModel";
import { buildClipPositioningBoardPrompt } from "../server/src/lib/workflowPositioningBoards";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const imageModelId = process.argv[3] || "cmqqg5el0004ml40te39s2edc";
const localUploadRoot = process.env.LOCAL_UPLOAD_ROOT || "/var/lib/loohii/uploads";

type CanvasNode = { id: string; type?: string; parentId?: string; data?: Record<string, unknown>; [key: string]: unknown };
type GeneratedScene = { imageUrl: string; assetId: string; generationId: string; prompt: string; revisedPrompt: string; model: unknown };

const EP17_LOCK = "Canonical scene: Omega Server Farm under Slumbering Orchard Motel. Keep it visually distinct from the later Black Spire B7 core: a hidden motel-basement server farm with matte-black racks, warm off-white concrete/tile walls, cramped service corridors, exposed motel basement pipes, crimson warning lights, blue monitor glow, and cat-face corporate branding. No frost, no ice, no white cold fog, no frozen surfaces, no cold-storage lockdown.";
const B7_NORMAL_LOCK = "Canonical scene: Black Spire B7 Core Server Room, normal pre-lockdown state. Preserve a vast corporate core server chamber with black server racks, golden fiber-optic cable glow, central main console/keyboard where Tangelo rests, red alarm accents, blue system monitors, blast-door access, and cat-admin props. Warm/dry server room air; no frost, no ice, no white cold fog until the lockdown trigger.";
const B7_COLD_LOCK = "Canonical scene: Black Spire B7 Core Server Room, cold lockdown state after the flash-freeze system activates. Preserve the same rack layout, main console/keyboard, highest server rack, blast-door access, red/blue alarms, golden cables, and cat-admin props, now filled with blue-white cold fog, rim frost on metal, visible freezing air, and emergency lockdown lighting.";
const B7_ELEVATOR_LOCK = "Canonical scene: Black Spire B7 Core Server Elevator access. A sealed corporate elevator descending into the B7 core: brushed black steel, gold trim, soft sterile elevator lighting, subtle cat-admin branding, red emergency indicators, no server racks as the main subject, no frost yet.";

const sceneTargets = [
  {
    key: "ep17-motel-server",
    episodeId: "episode-017",
    sceneNames: ["Omega Server Farm"],
    prompt: [
      "3D American cartoon dark-comedy environment concept art, cinematic, highly detailed, 16:9.",
      "Scene asset: Omega Server Farm under Slumbering Orchard Motel.",
      "Empty environment reference image only: no characters, no creatures, no readable text, no UI, no watermark.",
      "Depict a hidden ultra-advanced server farm inside an old motel basement: matte-black server racks in readable rows, central aisle, warm off-white concrete/tile walls, exposed basement pipes, utility conduits, low service ceiling, cramped motel-underbelly architecture.",
      "Use crimson warning lights, blue monitor glow, sterile corporate metal, and small cat-face branding symbols without readable text.",
      "Hard negatives: no frost, no ice, no snow, no cold fog, no condensation, no frozen surfaces, no flash-freeze effect, no B7 Black Spire megastructure.",
      `Scene continuity lock: ${EP17_LOCK}`,
    ].join("\n"),
    patch: {
      description: "hidden ultra-advanced motel-basement server farm with matte-black racks, warm off-white walls, crimson warning lights, blue monitor glow, exposed service pipes, and cat-face branding",
      timeOfDay: "interior night",
      colorPalette: "warm off-white basement walls, matte black racks, crimson warning red, blue monitor glow, sterile corporate metal",
      canonicalSceneId: "scene-omega-server-farm-motel",
      canonicalSceneName: "Omega Server Farm under Slumbering Orchard Motel",
      sceneVisualLock: EP17_LOCK,
    },
  },
  {
    key: "ep22-b7-elevator",
    episodeId: "episode-022",
    sceneNames: ["Core Server Elevator"],
    prompt: [
      "3D American cartoon dark-comedy environment concept art, cinematic, highly detailed, 16:9.",
      "Scene asset: Black Spire B7 Core Server Elevator access.",
      "Empty environment reference image only: no characters, no creatures, no readable text, no UI, no watermark.",
      "Depict a sealed corporate elevator descending toward the B7 core: brushed black steel walls, gold trim, soft sterile ceiling lights, red emergency indicators, subtle cat-face corporate symbols, elevator control panel without readable labels.",
      "It is not the server room itself: no rows of racks as the main subject, no main console, no cold fog, no frost.",
      `Scene continuity lock: ${B7_ELEVATOR_LOCK}`,
    ].join("\n"),
    patch: {
      description: "sealed corporate elevator access descending into Black Spire B7 core, brushed black steel, gold trim, red indicators, sterile corporate lighting",
      timeOfDay: "Interior elevator",
      colorPalette: "black steel, warm gold trim, red indicators, sterile white elevator light",
      canonicalSceneId: "scene-b7-core-server-elevator",
      canonicalSceneName: "B7 Core Server Elevator",
      sceneVisualLock: B7_ELEVATOR_LOCK,
    },
  },
  {
    key: "ep22-b7-normal",
    episodeId: "episode-022",
    sceneNames: ["B7 Core Server Room", "Main Control Console"],
    prompt: [
      "3D American cartoon dark-comedy environment concept art, cinematic, highly detailed, 16:9.",
      "Scene asset: Black Spire B7 Core Server Room, normal pre-lockdown state.",
      "Empty environment reference image only: no characters, no creatures, no readable text, no UI, no watermark.",
      "Depict a vast dry corporate core server chamber deep inside the Black Spire: black server racks, central main console with glowing golden keyboard, golden fiber-optic cables draped like pith, red alarm accents, blue system monitor glow, blast-door access, cat-admin props such as tuna cans and litter-box corner as environment details.",
      "Lighting is warm server amber mixed with blue monitor glow. No frost, no ice, no white cold fog, no frozen surfaces; this is before the lockdown/freezing system activates.",
      `Scene continuity lock: ${B7_NORMAL_LOCK}`,
    ].join("\n"),
    patch: {
      description: "warm dry Black Spire B7 core server room with black racks, golden fiber-optic cables, central main console/keyboard, red alarm accents, blue system monitors, and cat-admin props",
      timeOfDay: "Interior pre-lockdown",
      colorPalette: "black server racks, warm amber server glow, golden cables, red alarm accents, blue system monitors",
      canonicalSceneId: "scene-b7-core-server-room-normal",
      canonicalSceneName: "B7 Core Server Room - Normal",
      sceneVisualLock: B7_NORMAL_LOCK,
    },
  },
  {
    key: "b7-cold",
    episodeId: "episode-022",
    sceneNames: ["Highest Server Rack"],
    extraEpisodeNames: {
      "episode-023": ["Omega Server Farm", "Main Console Station", "B7 Blast Doors", "B7 Freight Elevator Approach"],
    } as Record<string, string[]>,
    prompt: [
      "3D American cartoon dark-comedy environment concept art, cinematic, highly detailed, 16:9.",
      "Scene asset: Black Spire B7 Core Server Room, cold lockdown state.",
      "Empty environment reference image only: no characters, no creatures, no readable text, no UI, no watermark.",
      "Depict the same Black Spire B7 core server chamber after the flash-freeze lockdown activates: black server racks, central main console, highest server rack, blast-door access, golden cables still visible, red/blue emergency alarms, cat-admin props, now filled with blue-white cold fog and rim frost on metal edges.",
      "This cold/frost state is allowed only after the lockdown trigger; make it visually distinct from the pre-lockdown warm dry version while keeping the same architecture.",
      `Scene continuity lock: ${B7_COLD_LOCK}`,
    ].join("\n"),
    patch: {
      description: "Black Spire B7 core server room in cold lockdown state with same racks, console, blast-door access, golden cables, red/blue alarms, blue-white fog and rim frost",
      timeOfDay: "Interior cold lockdown",
      colorPalette: "black racks, red emergency alarms, blue system glow, golden cables, blue-white cold fog, rim frost",
      canonicalSceneId: "scene-b7-core-server-room-cold-lockdown",
      canonicalSceneName: "B7 Core Server Room - Cold Lockdown",
      sceneVisualLock: B7_COLD_LOCK,
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function publicUploadUrl(key: string): string {
  return `https://loohii.com/api/uploads/public/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function parseImageDataUrl(value: string): { contentType: string; buffer: Buffer; extension: string } | null {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return { contentType, extension, buffer: Buffer.from(match[2].replace(/\s+/g, ""), "base64") };
}

async function downloadImage(value: string): Promise<{ contentType: string; buffer: Buffer; extension: string; originalUrl?: string }> {
  const data = parseImageDataUrl(value);
  if (data) return data;
  const response = await fetch(value, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 Loohii/1.0", Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`download failed ${response.status} ${value}`);
  const contentType = (response.headers.get("content-type") || "image/png").split(";")[0].toLowerCase();
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return { contentType, extension, buffer: Buffer.from(await response.arrayBuffer()), originalUrl: value };
}

function workflowFor(metadata: Record<string, unknown>, episodeId: string): Record<string, unknown> {
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : {};
  return isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
}

function writeWorkflow(metadata: Record<string, unknown>, episodeId: string, workflow: Record<string, unknown>) {
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : { id: episodeId };
  episodes[episodeId] = { ...episode, workflowCenter: workflow, updatedAt: new Date().toISOString() };
  metadata.episodes = episodes;
  if (stringValue(metadata.currentEpisodeId) === episodeId || stringValue(metadata.activeEpisodeId) === episodeId) metadata.workflowCenter = workflow;
}

function sceneTargetForKey(key: string) {
  return sceneTargets.find((target) => target.key === key);
}

async function generateScene(project: { ownerId: string }, key: string, prompt: string): Promise<GeneratedScene> {
  const target = sceneTargetForKey(key);
  const primaryAssetName = target?.patch.canonicalSceneName || target?.sceneNames[0] || key;
  const generation = await prisma.generation.create({
    data: {
      projectId,
      userId: project.ownerId,
      aiModelId: imageModelId,
      prompt,
      input: {
        kind: "workflow-asset-image",
        assetKind: "scenes",
        assetName: primaryAssetName,
        repairKey: key,
        size: "16:9",
        ...(target?.patch ?? {}),
      },
      parameters: { size: "16:9" },
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
  try {
    const result = await callConfiguredImageModel({ prompt, aiModelId: imageModelId, size: "16:9", parameters: { size: "16:9" } });
    const image = result.images[0];
    if (!image?.url) throw new Error("Image model returned no image URL.");
    const downloaded = await downloadImage(image.url);
    if (!downloaded.buffer.length) throw new Error("Image model returned empty image.");
    const keyPath = `${project.ownerId}/generated/${projectId}/asset-${generation.id}.${downloaded.extension}`;
    const filePath = path.join(localUploadRoot, keyPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, downloaded.buffer);
    const imageUrl = publicUploadUrl(keyPath);
    const asset = await prisma.asset.create({
      data: {
        projectId,
        uploadedById: project.ownerId,
        generationId: generation.id,
        type: "IMAGE",
        title: `${key} scene repair image`,
        url: imageUrl,
        mimeType: downloaded.contentType,
        metadata: {
          source: "repair-episode17-22-23-server-room-scenes",
          workflowAssetKind: "scenes",
          assetName: primaryAssetName,
          repairKey: key,
          prompt,
          size: "16:9",
          ...(target?.patch ?? {}),
          model: result.model,
          revisedPrompt: image.revisedPrompt,
          durationMs: result.durationMs,
          ...(downloaded.originalUrl ? { originalProviderImageUrl: downloaded.originalUrl } : {}),
        },
      },
    });
    await prisma.generation.update({
      where: { id: generation.id },
      data: {
        aiModelId: result.model.id,
        status: "SUCCEEDED",
        completedAt: new Date(),
        parameters: { size: "16:9", model: result.model, durationMs: result.durationMs },
      },
    });
    return { imageUrl, assetId: asset.id, generationId: generation.id, prompt, revisedPrompt: image.revisedPrompt || "", model: result.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.generation.update({ where: { id: generation.id }, data: { status: "FAILED", errorMessage: message, completedAt: new Date() } }).catch(() => undefined);
    throw error;
  }
}

function patchSceneAsset(asset: Record<string, unknown>, generated: GeneratedScene, patch: Record<string, string>) {
  return {
    ...asset,
    ...patch,
    referenceImageUrl: generated.imageUrl,
    generatedImageUrl: generated.imageUrl,
    referenceImageAssetId: generated.assetId,
    generatedImageAssetId: generated.assetId,
    generationId: generated.generationId,
    generatedImagePrompt: generated.prompt,
    generatedImageRevisedPrompt: generated.revisedPrompt,
    imageGenerationModel: generated.model,
    generatedImageAt: new Date().toISOString(),
    visualAuthority: "generated-asset-image",
    referenceAnalysisStatus: "generated",
    imageStatus: "ready",
    imageError: "",
    reusedImageFrom: "",
  };
}

function scenePatchFor(episodeId: string, sceneName: string, generatedByKey: Map<string, GeneratedScene>) {
  for (const target of sceneTargets) {
    const names = [
      ...(target.episodeId === episodeId ? target.sceneNames : []),
      ...(target.extraEpisodeNames?.[episodeId] ?? []),
    ];
    if (names.some((name) => name.toLowerCase() === sceneName.toLowerCase())) {
      return { generated: generatedByKey.get(target.key), patch: target.patch, key: target.key };
    }
  }
  return null;
}

function sanitizeSceneText(value: unknown, episodeId: string): string {
  let text = stringValue(value);
  if (!text) return text;
  if (episodeId === "episode-017") {
    text = text
      .replace(/\bicy white walls?\b/gi, "warm off-white basement walls")
      .replace(/\bicy walls?\b/gi, "warm off-white walls")
      .replace(/\bcold condensation\b/gi, "dry basement air")
      .replace(/\bfrost-like sheen\b/gi, "sterile tile sheen")
      .replace(/\bicy white\b/gi, "warm off-white")
      .replace(/\bcold fog\b/gi, "blue monitor glow")
      .replace(/\bfrost\b/gi, "sterile sheen")
      .replace(/\bice\b/gi, "glass")
      .replace(/\bfrozen surfaces?\b/gi, "dry metal surfaces");
  }
  return text.trim();
}

function clipIdsForEpisode(workflow: Record<string, unknown>, episodeId: string): Set<string> {
  const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
  const scenes = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : [];
  const targetSceneNames = new Set<string>();
  for (const target of sceneTargets) {
    if (target.episodeId === episodeId) target.sceneNames.forEach((name) => targetSceneNames.add(name.toLowerCase()));
    (target.extraEpisodeNames?.[episodeId] ?? []).forEach((name) => targetSceneNames.add(name.toLowerCase()));
  }
  const targetShotIds = new Set(
    scenes
      .filter((scene) => targetSceneNames.has(stringValue(scene.setting).toLowerCase()))
      .map((scene) => stringValue(scene.id))
      .filter(Boolean),
  );
  return new Set(clips.filter((clip) => (Array.isArray(clip.shotIds) ? clip.shotIds : []).some((id) => targetShotIds.has(String(id)))).map((clip) => stringValue(clip.id)));
}

function clipShots(clip: Record<string, unknown>, scenes: Record<string, unknown>[]) {
  const ids = new Set(Array.isArray(clip.shotIds) ? clip.shotIds.map((id) => String(id)) : []);
  if (!ids.size) return scenes.filter((scene) => stringValue(scene.clipId) === stringValue(clip.id));
  return scenes.filter((scene) => ids.has(stringValue(scene.id)));
}

function referenceNodesForGeneration(nodes: CanvasNode[], generationNode: CanvasNode): CanvasNode[] {
  return nodes.filter((node) => node.type === "imageInput" && node.parentId === generationNode.parentId && node.data?.positioningBoardFlow === true);
}

function referenceLabels(refs: CanvasNode[]): string[] {
  return refs.map((ref) => stringValue(ref.data?.assetName || ref.data?.label || ref.data?.name)).filter(Boolean);
}

function visibleCharacterNames(refs: CanvasNode[]): string[] {
  return refs
    .filter((ref) => stringValue(ref.data?.assetKind) === "characters")
    .map((ref) => stringValue(ref.data?.assetName || ref.data?.label || ref.data?.name))
    .filter(Boolean);
}

function sceneLockName(refs: CanvasNode[]): string {
  const sceneRef = refs.find((ref) => stringValue(ref.data?.assetKind) === "scenes");
  return stringValue(sceneRef?.data?.assetName || sceneRef?.data?.label || sceneRef?.data?.name);
}

function patchCanvasNodesForEpisode(
  nodes: CanvasNode[],
  workflow: Record<string, unknown>,
  episodeId: string,
  generatedByKey: Map<string, GeneratedScene>,
  resetClipIds: Set<string>,
) {
  const assets = isRecord(workflow.assets) ? workflow.assets : {};
  const scenes = Array.isArray(assets.scenes) ? assets.scenes.filter(isRecord) : [];
  const sceneByName = new Map(scenes.map((scene) => [stringValue(scene.name).toLowerCase(), scene]));
  const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
  const breakdownScenes = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : [];
  let changed = 0;
  let nextNodes = nodes.map((node) => {
    const data = isRecord(node.data) ? node.data : {};
    let nextData = { ...data };
    if (stringValue(nextData.assetKind) === "scenes") {
      const sceneName = stringValue(nextData.assetName);
      const patch = scenePatchFor(episodeId, sceneName, generatedByKey);
      const scene = sceneByName.get(sceneName.toLowerCase());
      if (patch?.generated && scene) {
        nextData = {
          ...nextData,
          assetId: stringValue(scene.referenceImageAssetId || scene.generatedImageAssetId),
          imageUrl: stringValue(scene.referenceImageUrl || scene.generatedImageUrl),
          url: stringValue(scene.referenceImageUrl || scene.generatedImageUrl),
          uploadStatus: "linked",
          imageLoadError: false,
          sourcePrompt: `场景参考: ${sceneName}，用于 ${stringValue(nextData.clipTitle || nextData.title || nextData.sourcePrompt)}；${stringValue(scene.sceneVisualLock)}`,
        };
      }
    }
    if (node.type === "generation" && nextData.positioningBoardFlow === true && resetClipIds.has(stringValue(nextData.clipId))) {
      nextData = {
        ...nextData,
        status: "waiting",
        error: "",
        outputImage: "",
        outputImageAssetId: "",
        outputImages: [],
        generationStartedAt: "",
        positioningBoardMode: "storyboard",
      };
    }
    if (JSON.stringify(nextData) !== JSON.stringify(data)) {
      changed += 1;
      return { ...node, data: nextData };
    }
    return node;
  });

  nextNodes = nextNodes.map((node) => {
    const data = isRecord(node.data) ? node.data : {};
    if (!(node.type === "generation" && data.positioningBoardFlow === true && resetClipIds.has(stringValue(data.clipId)))) return node;
    const clip = clips.find((item) => stringValue(item.id) === stringValue(data.clipId));
    if (!clip) return node;
    const refs = referenceNodesForGeneration(nextNodes, node);
    const shots = clipShots(clip, breakdownScenes);
    const sceneVisualLock = shots.map((shot) => stringValue(shot.sceneVisualLock)).find(Boolean) || "";
    const positioningPrompt = buildClipPositioningBoardPrompt({
      projectName: "美式漫剧",
      clip,
      shots,
      referenceLabels: referenceLabels(refs),
      visibleCharacterNames: visibleCharacterNames(refs),
      sceneLockName: sceneLockName(refs),
      sceneVisualLock,
      mode: "positioning",
    });
    const storyboardPrompt = buildClipPositioningBoardPrompt({
      projectName: "美式漫剧",
      clip,
      shots,
      referenceLabels: referenceLabels(refs),
      visibleCharacterNames: visibleCharacterNames(refs),
      sceneLockName: sceneLockName(refs),
      sceneVisualLock,
      mode: "storyboard",
    });
    changed += 1;
    return {
      ...node,
      data: {
        ...data,
        prompt: storyboardPrompt,
        finalPrompt: storyboardPrompt,
        storyboardPrompt,
        positioningPrompt,
        manualFinalPrompt: true,
      },
    };
  });
  return { nodes: nextNodes, changed };
}

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true, metadata: true } });
if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const generatedByKey = new Map<string, GeneratedScene>();
for (const target of sceneTargets) {
  console.log(JSON.stringify({ event: "generate-scene-start", key: target.key }));
  const generated = await generateScene(project, target.key, target.prompt);
  generatedByKey.set(target.key, generated);
  console.log(JSON.stringify({ event: "generate-scene-done", key: target.key, imageUrl: generated.imageUrl, assetId: generated.assetId }));
}

const freshProject = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
if (!freshProject || !isRecord(freshProject.metadata)) throw new Error(`Project not found after generation: ${projectId}`);
const metadata = freshProject.metadata as Record<string, unknown>;
const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const summary: unknown[] = [];

for (const episodeId of ["episode-017", "episode-022", "episode-023"]) {
  const workflow = workflowFor(metadata, episodeId);
  const assets = isRecord(workflow.assets) ? workflow.assets : {};
  const sceneAssets = Array.isArray(assets.scenes) ? assets.scenes.filter(isRecord) : [];
  let sceneAssetChanges = 0;
  const nextSceneAssets = sceneAssets.map((scene) => {
    const name = stringValue(scene.name);
    const patch = scenePatchFor(episodeId, name, generatedByKey);
    if (!patch?.generated) {
      if (episodeId === "episode-017") {
        const cleaned = { ...scene };
        for (const key of ["description", "colorPalette", "sceneVisualLock", "generatedImagePrompt", "generatedImageRevisedPrompt", "referencePolicy"]) {
          if (key in cleaned) cleaned[key] = sanitizeSceneText(cleaned[key], episodeId);
        }
        if (JSON.stringify(cleaned) !== JSON.stringify(scene)) sceneAssetChanges += 1;
        return cleaned;
      }
      return scene;
    }
    sceneAssetChanges += 1;
    return patchSceneAsset(scene, patch.generated, patch.patch);
  });

  const targetNames = new Set(
    sceneAssets
      .filter((scene) => scenePatchFor(episodeId, stringValue(scene.name), generatedByKey))
      .map((scene) => stringValue(scene.name).toLowerCase()),
  );
  const nextBreakdownScenes = (Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : []).map((scene) => {
    const setting = stringValue(scene.setting).toLowerCase();
    const matchingAsset = nextSceneAssets.find((asset) => stringValue(asset.name).toLowerCase() === setting);
    let next = { ...scene };
    if (matchingAsset && targetNames.has(setting)) {
      next = {
        ...next,
        canonicalSceneId: stringValue(matchingAsset.canonicalSceneId),
        canonicalSceneName: stringValue(matchingAsset.canonicalSceneName),
        sceneVisualLock: stringValue(matchingAsset.sceneVisualLock),
      };
    }
    if (episodeId === "episode-017") {
      for (const key of ["description", "action", "visualPrompt", "references", "sceneVisualLock"]) {
        if (key in next) next[key] = sanitizeSceneText(next[key], episodeId);
      }
    }
    return next;
  });
  const nextClips = (Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : []).map((clip) => {
    if (episodeId !== "episode-017") return clip;
    const next = { ...clip };
    for (const key of ["plotGoal", "startState", "endState", "layoutMemory", "seedancePrompt", "videoPrompt", "prompt"]) {
      if (key in next) next[key] = sanitizeSceneText(next[key], episodeId);
    }
    return next;
  });
  const nextWorkflow = {
    ...workflow,
    assets: { ...assets, scenes: nextSceneAssets },
    breakdownScenes: nextBreakdownScenes,
    clips: nextClips,
    updatedAt: new Date().toISOString(),
  };
  writeWorkflow(metadata, episodeId, nextWorkflow);

  const resetClipIds = clipIdsForEpisode(nextWorkflow, episodeId);
  const canvasScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : {};
  const nodes = Array.isArray(canvasScene.nodes) ? canvasScene.nodes.filter(isRecord) as CanvasNode[] : [];
  const patched = patchCanvasNodesForEpisode(nodes, nextWorkflow, episodeId, generatedByKey, resetClipIds);
  canvasScenes[episodeId] = { ...canvasScene, nodes: patched.nodes, updatedAt: new Date().toISOString() };
  summary.push({ episodeId, sceneAssetChanges, resetClipIds: [...resetClipIds], canvasNodeChanges: patched.changed });
}

metadata.canvasScenes = canvasScenes;
metadata.updatedAt = new Date().toISOString();
await prisma.project.update({ where: { id: projectId }, data: { metadata } });

console.log(JSON.stringify({ projectId, imageModelId, generated: [...generatedByKey.entries()], summary }, null, 2));
await prisma.$disconnect();
