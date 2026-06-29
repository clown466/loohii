import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";

type JsonRecord = Record<string, unknown>;

const sceneFixes: Record<string, Record<string, { canonicalSceneId: string; sceneVisualLock: string }>> = {
  "episode-018": {
    "wasteland highway": {
      canonicalSceneId: "scene-214-loc-1-wasteland-highway",
      sceneVisualLock: "Scene visual authority: Wasteland Highway. Maintain cold night/pre-dawn wasteland palette, cracked dark asphalt, dead roadside gravel, distant Black Spire/red signal continuity, no warm sunset or orange dusk.",
    },
    "ruined overpass": {
      canonicalSceneId: "scene-697-loc-2-ruined-overpass",
      sceneVisualLock: "Scene visual authority: Ruined Overpass. Maintain cold night broken concrete overpass, cracked elevated roadway, exposed rebar, shadowed underpass depth, rubble, harsh headlight spill, no open sunset highway.",
    },
  },
  "episode-025": {
    "wasteland highway": {
      canonicalSceneId: "scene-901-loc-4-wasteland-highway",
      sceneVisualLock: "Scene visual authority: Wasteland Highway. Maintain cold night wasteland highway after Black Spire events, cracked road, black-blue horizon, distant tower aftermath palette, no warm sunset or orange dusk.",
    },
  },
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function episodeNumber(episodeId: string): number {
  return Number(episodeId.match(/(\d+)/)?.[1] || 0);
}

function hasOutput(data: JsonRecord): boolean {
  if (stringValue(data.outputImage)) return true;
  return Array.isArray(data.outputImages) && data.outputImages.some((item) => isRecord(item) && stringValue(item.url));
}

function boardNeedsReset(node: JsonRecord): boolean {
  if (node.type !== "generation" || !isRecord(node.data)) return false;
  const data = node.data;
  return data.positioningBoardFlow === true && stringValue(data.positioningBoardMode || "storyboard") === "storyboard";
}

function clearBoardOutput(node: JsonRecord): JsonRecord {
  const data = isRecord(node.data) ? node.data : {};
  return {
    ...node,
    data: {
      ...data,
      status: hasOutput(data) ? "idle" : stringValue(data.status || "idle"),
      error: "",
      outputImage: "",
      outputImageAssetId: "",
      outputImages: [],
      revisedPrompt: "",
      generationStartedAt: "",
    },
  };
}

function markWornOrFixtureProp(prop: JsonRecord): JsonRecord {
  const name = stringValue(prop.name || prop.title);
  const key = normalize(name);
  if (/gas mask|face covering|helmet|tactical vest|wristband|badge|lanyard|monocle/i.test(name)) {
    const owner = /gas mask|face covering|tactical vest/i.test(name) ? "Bob" : stringValue(prop.ownerCharacterName);
    return {
      ...prop,
      propScope: "character_worn",
      ownerCharacterName: owner,
      standaloneReferenceAllowed: false,
      referencePolicy: "Do not connect as a standalone prop when the owning character reference image already shows this worn item. Use the matching character form image instead.",
    };
  }
  if (/door|blast doors|server racks|console|wall|stage|billboard|counter|shelf|elevator|vents|ceiling|pipes/i.test(name) && !/mobile|encrypted/i.test(name)) {
    return {
      ...prop,
      propScope: "scene_fixture",
      standaloneReferenceAllowed: false,
      referencePolicy: "Treat as part of the scene plate unless the story explicitly requires a removable handheld object.",
    };
  }
  if (key) {
    return {
      ...prop,
      propScope: stringValue(prop.propScope) || "standalone",
      standaloneReferenceAllowed: prop.standaloneReferenceAllowed !== false,
    };
  }
  return prop;
}

function patchSceneAssets(workflow: JsonRecord, episodeId: string): { workflow: JsonRecord; changed: boolean } {
  const assets = isRecord(workflow.assets) ? workflow.assets : {};
  const scenes = Array.isArray(assets.scenes) ? assets.scenes as JsonRecord[] : [];
  const fixes = sceneFixes[episodeId] || {};
  let changed = false;
  const nextScenes = scenes.map((scene) => {
    const fix = fixes[normalize(scene.name || scene.title)];
    if (!fix) return scene;
    const patch = {
      canonicalSceneId: fix.canonicalSceneId,
      sceneVisualLock: fix.sceneVisualLock,
      sceneZone: stringValue(scene.sceneZone),
      sceneAnchors: Array.isArray(scene.sceneAnchors) && scene.sceneAnchors.length ? scene.sceneAnchors : [],
    };
    if (scene.canonicalSceneId === patch.canonicalSceneId && scene.sceneVisualLock === patch.sceneVisualLock) return scene;
    changed = true;
    return { ...scene, ...patch };
  });
  return changed ? { workflow: { ...workflow, assets: { ...assets, scenes: nextScenes } }, changed } : { workflow, changed };
}

function patchProps(workflow: JsonRecord): { workflow: JsonRecord; changed: boolean } {
  const assets = isRecord(workflow.assets) ? workflow.assets : {};
  const props = Array.isArray(assets.props) ? assets.props as JsonRecord[] : [];
  let changed = false;
  const nextProps = props.map((prop) => {
    const next = markWornOrFixtureProp(prop);
    if (JSON.stringify(next) !== JSON.stringify(prop)) changed = true;
    return next;
  });
  return changed ? { workflow: { ...workflow, assets: { ...assets, props: nextProps } }, changed } : { workflow, changed };
}

function removeDisallowedPropReferenceNodes(scene: JsonRecord): { scene: JsonRecord; removed: number } {
  const nodes = Array.isArray(scene.nodes) ? scene.nodes as JsonRecord[] : [];
  const edges = Array.isArray(scene.edges) ? scene.edges as JsonRecord[] : [];
  const removeIds = new Set<string>();
  for (const node of nodes) {
    if (node.type !== "imageInput" || !isRecord(node.data)) continue;
    const data = node.data;
    if (stringValue(data.assetKind) !== "props") continue;
    const name = stringValue(data.assetName || data.label || data.fileName);
    if (
      /gas mask|face covering|helmet|tactical vest|wristband|badge|lanyard|monocle/i.test(name) ||
      (/door|blast doors|server racks|console|wall|stage|billboard|counter|shelf|elevator|vents|ceiling|pipes/i.test(name) && !/mobile|encrypted/i.test(name))
    ) {
      removeIds.add(stringValue(node.id));
    }
  }
  if (removeIds.size === 0) return { scene, removed: 0 };
  return {
    scene: {
      ...scene,
      nodes: nodes.filter((node) => !removeIds.has(stringValue(node.id))),
      edges: edges.filter((edge) => !removeIds.has(stringValue(edge.source)) && !removeIds.has(stringValue(edge.target))),
      updatedAt: new Date().toISOString(),
    },
    removed: removeIds.size,
  };
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as JsonRecord;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const nextEpisodes: JsonRecord = { ...episodes };
  const nextCanvasScenes: JsonRecord = { ...canvasScenes };
  const report: JsonRecord[] = [];
  let changed = false;

  for (const episodeId of Object.keys(episodes).filter((id) => episodeNumber(id) >= 18).sort()) {
    const episode = episodes[episodeId];
    if (!isRecord(episode)) continue;
    let workflow = isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
    const scenePatch = patchSceneAssets(workflow, episodeId);
    workflow = scenePatch.workflow;
    const propPatch = patchProps(workflow);
    workflow = propPatch.workflow;
    if (scenePatch.changed || propPatch.changed) {
      nextEpisodes[episodeId] = { ...episode, workflowCenter: { ...workflow, updatedAt: new Date().toISOString() } };
      changed = true;
    }

    const canvas = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] as JsonRecord : null;
    let resetBoards = 0;
    let removedPropRefs = 0;
    if (canvas) {
      const propClean = removeDisallowedPropReferenceNodes(canvas);
      let nextScene = propClean.scene;
      removedPropRefs = propClean.removed;
      const nodes = Array.isArray(nextScene.nodes) ? nextScene.nodes as JsonRecord[] : [];
      const nextNodes = nodes.map((node) => {
        if (!boardNeedsReset(node)) return node;
        resetBoards += 1;
        return clearBoardOutput(node);
      });
      if (removedPropRefs > 0 || resetBoards > 0) {
        nextCanvasScenes[episodeId] = { ...nextScene, nodes: nextNodes, updatedAt: new Date().toISOString() };
        changed = true;
      }
    }
    report.push({ episodeId, sceneAssetsPatched: scenePatch.changed, propsPatched: propPatch.changed, removedPropRefs, resetBoards });
  }

  if (changed) {
    await prisma.project.update({
      where: { id: projectId },
      data: { metadata: { ...metadata, episodes: nextEpisodes, canvasScenes: nextCanvasScenes, updatedAt: new Date().toISOString() } },
    });
  }
  console.log(JSON.stringify({ projectId, changed, report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
