export type SceneVisualIdentity = {
  timeOfDay: string;
  lighting: string;
  colorPalette: string;
  buildingType: string;
  materialLanguage: string;
  fixedLandmarks: string[];
  atmosphere: string;
};

export type SceneVisualBible = {
  canonicalSceneId: string;
  canonicalName: string;
  visualIdentity: SceneVisualIdentity;
  childZones: Array<{
    id: string;
    name: string;
    role: "zone" | "anchor" | "detail";
    visualLock: string;
  }>;
  aliases: string[];
  continuityLock: string;
};

export type SceneVisualLockResolution = {
  canonicalSceneId: string;
  canonicalName: string;
  sceneZone: string;
  sceneAnchors: string[];
  sceneVisualLock: string;
};

export type SceneVisualConflict = {
  pass: boolean;
  score: number;
  reasons: string[];
};

export type SceneLike = {
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  timeOfDay?: string;
};

type SceneGroupDraft = {
  key: string;
  canonicalName: string;
  visualIdentity: SceneVisualIdentity;
  childZones: SceneVisualBible["childZones"];
  aliases: string[];
};

type CanonicalSceneKind = "sanctuary-superstore" | "living-vine-hospital-bed" | "frozen-meat" | "underground-loading-dock" | "labor-purification";

const SANCTUARY_PATTERN = /\b(sanctuary|cult meditation|meditation circle|bulk toilet paper|toilet paper aisle|pallet altar|trial space|green (?:dyed )?fabric|green dyed strips|incense haze|shipping pallets)\b|圣所|冥想|纸巾|托盘|祭坛|审判/i;
const LIVING_VINE_BED_PATTERN = /\b(living vine hospital bed|vine hospital bed|living vine bed|vine bed|ritual bed|hospital bed|operation bed|operating bed|restraint bed|vine restraints?|tendril bed|root restraint|bone needle|clear plastic tubing)\b|藤蔓病床|活体藤蔓|藤蔓床|仪式病床|仪式床|手术床|束缚床|活藤|根须束缚/i;
const FROZEN_PATTERN = /\b(frozen meat|freezer(?: aisle| section| cases?)?|fungus|fungal|mycelium|fungus covered drywall|wall whisper|pulsing fungus)\b|冷冻|冷柜|菌丝|真菌/i;
const LOADING_DOCK_PATTERN = /(loading dock|blast door|roll-up door|roll up door|装卸|卸货|防爆门|卷帘门)/i;
const LABOR_PATTERN = /\b(?:labor\s+purification|labor\s+(?:zone|corridor|machinery|chamber|approach)|purification\s+(?:zone|corridor|machinery|chamber|approach)|(?:toward|towards|to|into|approach(?:ing)?|leading\s+to)\s+purification)\b|劳作\s*净化|(?:劳作|净化)\s*(?:区|区域|走廊|机械|机器|室|间|入口|通道)/i;

const CANONICAL_SCENE_METADATA: Record<CanonicalSceneKind, { canonicalName: string; canonicalSceneId: string }> = {
  "sanctuary-superstore": {
    canonicalName: "Sanctuary Superstore Center",
    canonicalSceneId: "scene-1-sanctuary-superstore-center",
  },
  "living-vine-hospital-bed": {
    canonicalName: "Living Vine Hospital Bed",
    canonicalSceneId: "scene-1-living-vine-hospital-bed",
  },
  "frozen-meat": {
    canonicalName: "Frozen Meat Section",
    canonicalSceneId: "scene-1-frozen-meat-section",
  },
  "underground-loading-dock": {
    canonicalName: "Underground Loading Dock",
    canonicalSceneId: "scene-1-underground-loading-dock",
  },
  "labor-purification": {
    canonicalName: "Labor Purification Zone Approach",
    canonicalSceneId: "scene-1-labor-purification-zone-approach",
  },
};

export function buildSceneVisualBible(scenes: SceneLike[]): SceneVisualBible[] {
  const groups: SceneGroupDraft[] = [];

  for (const scene of scenes) {
    const name = cleanName(scene.name || scene.title || "Scene");
    const description = text(scene.description);
    const timeOfDay = text(scene.timeOfDay);
    const key = canonicalSceneKeyForScene(scene, name, description);
    let group = groups.find((item) => item.key === key);

    if (!group) {
      const canonicalName = preferredCanonicalName(key) ?? name;
      group = {
        key,
        canonicalName,
        visualIdentity: inferVisualIdentity(name, description, timeOfDay),
        childZones: [],
        aliases: [name],
      };
      if (!sameName(name, canonicalName)) {
        const role = zoneRole(name, description);
        group.childZones.push({
          id: slugId(role, name, group.childZones.length + 1),
          name,
          role,
          visualLock: childZoneLock(name, canonicalName),
        });
      }
      groups.push(group);
      continue;
    }

    if (!sameName(name, group.canonicalName)) {
      const role = zoneRole(name, description);
      group.childZones.push({
        id: slugId(role, name, group.childZones.length + 1),
        name,
        role,
        visualLock: childZoneLock(name, group.canonicalName),
      });
      group.aliases.push(name);
    }
  }

  return groups.map((group) => {
    const bible: SceneVisualBible = {
      canonicalSceneId: canonicalSceneId(group),
      canonicalName: group.canonicalName,
      visualIdentity: group.visualIdentity,
      childZones: group.childZones,
      aliases: uniqueStrings([
        group.canonicalName,
        ...group.aliases,
        ...group.childZones.map((zone) => zone.name),
      ]),
      continuityLock: "",
    };
    bible.continuityLock = buildContinuityLock(bible);
    return bible;
  });
}

export function resolveSceneVisualLockForSetting(
  setting: string,
  bibles: SceneVisualBible[],
): SceneVisualLockResolution | null {
  const settingText = normalize(setting);
  if (!settingText) return null;

  const matched = bibles.find((bible) => bibleNameMatchesSetting(bible, settingText))
    ?? bibles.find((bible) => canonicalSceneKey(settingText) === canonicalSceneKey(`${bible.canonicalName} ${bible.aliases.join(" ")}`));
  if (!matched) return null;

  const zone = matched.childZones.find((item) => looseNameMatch(settingText, item.name));
  const currentZone = zone?.name || matched.canonicalName;

  return {
    canonicalSceneId: matched.canonicalSceneId,
    canonicalName: matched.canonicalName,
    sceneZone: currentZone,
    sceneAnchors: matched.childZones.filter((item) => item.role !== "zone").map((item) => item.name),
    sceneVisualLock: formatSceneVisualLock(matched, currentZone),
  };
}

export function formatSceneVisualLock(bible: SceneVisualBible, currentZone = ""): string {
  const identity = bible.visualIdentity;
  const zoneText = currentZone && currentZone !== bible.canonicalName
    ? ` Current zone: ${currentZone}, inside the same canonical scene.`
    : "";
  const landmarks = identity.fixedLandmarks.length
    ? ` Fixed landmarks: ${identity.fixedLandmarks.slice(0, 6).join(", ")}.`
    : "";

  return [
    `Scene visual authority: ${bible.canonicalName}.`,
    zoneText,
    `Maintain: ${compactList([
      identity.timeOfDay,
      identity.lighting,
      identity.colorPalette,
      identity.buildingType,
      identity.materialLanguage,
    ], 5)}.`,
    landmarks,
    "Do not change the time of day, palette, building type, materials, or fixed landmarks unless the source explicitly moves to a different canonical scene.",
    `Continuity lock: ${bible.continuityLock}`,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function detectSceneVisualConflict(bible: SceneVisualBible, candidatePrompt: string): SceneVisualConflict {
  const candidate = normalize(candidatePrompt);
  const reasons: string[] = [];
  const identity = bible.visualIdentity;
  const identityTime = normalize(identity.timeOfDay);
  const identityPalette = normalize(identity.colorPalette);
  const identityBuilding = normalize(identity.buildingType);
  const identityLighting = normalize(identity.lighting);
  const identityMaterial = normalize(identity.materialLanguage);

  if (timeOfDayDrifts(candidate, identityTime)) {
    reasons.push("time of day drift");
  }

  if (paletteDrifts(candidate, identityPalette)) {
    reasons.push("color palette drift");
  }

  const hasBuildingDrift = buildingTypeDrifts(candidate, identityBuilding);
  const hasMaterialDrift = materialLanguageDrifts(candidate, identityMaterial);

  if (hasBuildingDrift) {
    reasons.push("building type drift");
  }

  if (lightingDrifts(candidate, identityLighting)) {
    reasons.push("lighting family drift");
  }

  if (hasMaterialDrift) {
    reasons.push("material language drift");
  }

  const explicitLandmarkNegations = identity.fixedLandmarks.filter((landmark) => hasNegatedLandmark(candidate, landmark));
  if (
    identity.fixedLandmarks.length > 0
    && (explicitLandmarkNegations.length > 0 || hasBuildingDrift || hasMaterialDrift)
  ) {
    reasons.push("fixed landmark drift");
  }

  const score = Math.max(0, 100 - reasons.length * 30);
  return { pass: reasons.length === 0, score, reasons };
}

function inferVisualIdentity(name: string, description: string, timeOfDay: string): SceneVisualIdentity {
  const source = `${name} ${description}`;
  const sceneKind = classifyCanonicalScene(source);

  if (sceneKind === "sanctuary-superstore") {
    return {
      timeOfDay: timeOfDay || "Interior dim",
      lighting: "dim superstore lighting with green fabric filtered light and small warm practical points",
      colorPalette: "muted green, gray concrete, dull metal, warm candle accents",
      buildingType: "abandoned big-box superstore sanctuary",
      materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips, pallets",
      fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle", "pallet altar"],
      atmosphere: "eerie absurd cult sanctuary inside a mundane superstore",
    };
  }

  if (sceneKind === "living-vine-hospital-bed") {
    return {
      timeOfDay: timeOfDay || "Interior ritual chamber",
      lighting: "sickly green ritual light with dim clinical highlights",
      colorPalette: "green vine glow, bone white, damp dark plant fibers, translucent tubing",
      buildingType: "botanical ritual treatment chamber",
      materialLanguage: "living vines, root restraints, tendrils, bone needle, clear plastic tubing, damp organic bed frame",
      fixedLandmarks: ["living vine hospital bed", "root restraints", "bone needle", "clear plastic tubing", "tendril canopy"],
      atmosphere: "grotesque non-gory botanical hospital ritual space",
    };
  }

  if (sceneKind === "frozen-meat") {
    return {
      timeOfDay: timeOfDay || "Interior dark",
      lighting: "cold dark freezer aisle lighting with blue-gray spill",
      colorPalette: "cold blue-gray, white fungus, dark freezer metal",
      buildingType: "superstore frozen meat freezer section",
      materialLanguage: "freezer cases, cold tile, metal doors, white lace-like fungus",
      fixedLandmarks: ["freezer cases", "white fungus", "cold tile floor", "dark freezer wall"],
      atmosphere: "cold powerless freezer aisle with unsettling fungal growth",
    };
  }

  if (sceneKind === "underground-loading-dock") {
    return {
      timeOfDay: timeOfDay || "Interior dim",
      lighting: "dim industrial loading dock lighting",
      colorPalette: "dark concrete, gray metal, yellow hazard marks",
      buildingType: "underground loading dock",
      materialLanguage: "concrete walls, stainless blast door, roll-up door, pipes, pallets",
      fixedLandmarks: ["stainless blast door", "roll-up door", "concrete dock floor", "pallet stacks"],
      atmosphere: "tense underground loading bay",
    };
  }

  if (sceneKind === "labor-purification") {
    return {
      timeOfDay: timeOfDay || "Interior dark",
      lighting: "cold corridor light with warm machinery glow ahead",
      colorPalette: "green-gray corridor shadows, orange industrial glow",
      buildingType: "superstore back corridor leading to machinery zone",
      materialLanguage: "pipes, conveyor belts, metal gates, cracked concrete, retail backroom walls",
      fixedLandmarks: ["pipes", "conveyor belts", "industrial doorway", "machinery glow"],
      atmosphere: "ominous backroom approach to purification machinery",
    };
  }

  return {
    timeOfDay: timeOfDay || "Interior",
    lighting: "consistent lighting from the canonical scene reference",
    colorPalette: "consistent palette from the canonical scene reference",
    buildingType: "canonical scene architecture",
    materialLanguage: "fixed materials from the canonical scene reference",
    fixedLandmarks: [],
    atmosphere: description || "consistent scene atmosphere",
  };
}

function canonicalSceneKey(value: string): string {
  const normalized = normalize(value);
  const sceneKind = classifyCanonicalScene(normalized);
  if (sceneKind) return sceneKind;
  return slugBase(normalized);
}

function canonicalSceneKeyForScene(scene: SceneLike, name: string, description: string): string {
  const sceneKind = classifyCanonicalScene(`${name} ${description}`);
  if (sceneKind) return sceneKind;

  const id = text(scene.id);
  if (id) return `id-${slugBase(id)}`;

  return `name-${slugBase(name)}`;
}

function preferredCanonicalName(key: string): string | null {
  return isCanonicalSceneKind(key) ? CANONICAL_SCENE_METADATA[key].canonicalName : null;
}

function isCanonicalSceneKind(value: string): value is CanonicalSceneKind {
  return Object.prototype.hasOwnProperty.call(CANONICAL_SCENE_METADATA, value);
}

function classifyCanonicalScene(value: string): CanonicalSceneKind | null {
  const normalized = normalize(value);
  if (LOADING_DOCK_PATTERN.test(normalized)) return "underground-loading-dock";
  if (LIVING_VINE_BED_PATTERN.test(normalized)) return "living-vine-hospital-bed";
  if (FROZEN_PATTERN.test(normalized)) return "frozen-meat";
  if (LABOR_PATTERN.test(normalized)) return "labor-purification";
  if (SANCTUARY_PATTERN.test(normalized)) return "sanctuary-superstore";
  return null;
}

function canonicalSceneId(group: SceneGroupDraft): string {
  if (isCanonicalSceneKind(group.key)) return CANONICAL_SCENE_METADATA[group.key].canonicalSceneId;
  if (group.key.startsWith("id-")) return `scene-${stableSceneNumber(group.key)}-${group.key.slice(3) || "scene"}`;
  return `scene-${stableSceneNumber(group.key)}-${slugBase(group.canonicalName)}`;
}

function stableSceneNumber(key: string): number {
  const classifiedKind = classifyCanonicalScene(key);
  if (classifiedKind) return 1;
  return 100 + (stableHash(key) % 900);
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildContinuityLock(bible: SceneVisualBible): string {
  const zones = bible.childZones.map((zone) => zone.name).join(", ");
  const zoneText = zones ? ` Zones/anchors (${zones}) remain inside the same canonical scene.` : "";
  const genericDriftWarning = bible.canonicalName === "Living Vine Hospital Bed"
    ? "It must not become a different room, palette, material system, or unrelated building."
    : "It must not become a different warehouse, night setting, palette, or unrelated building.";
  return `Keep the same canonical scene identity for ${bible.canonicalName}: ${bible.visualIdentity.timeOfDay}, ${bible.visualIdentity.colorPalette}, ${bible.visualIdentity.buildingType}, ${bible.visualIdentity.materialLanguage}.${zoneText} ${genericDriftWarning}`;
}

function childZoneLock(name: string, canonicalName: string): string {
  return `${name} is a local zone or anchor inside ${canonicalName}; inherit the canonical time, palette, architecture, materials, and landmarks.`;
}

function bibleNameMatchesSetting(bible: SceneVisualBible, settingText: string): boolean {
  const names = [
    bible.canonicalName,
    ...bible.aliases,
    ...bible.childZones.map((zone) => zone.name),
  ];
  return names.some((name) => looseNameMatch(settingText, name));
}

function looseNameMatch(settingText: string, name: string): boolean {
  const normalizedName = normalize(name);
  if (!normalizedName) return false;
  if (settingText.includes(normalizedName) || normalizedName.includes(settingText)) return true;
  const words = normalizedName.split(" ").filter((word) => word.length > 2);
  if (words.length === 0) return false;
  const matchedWords = words.filter((word) => settingText.includes(word)).length;
  return matchedWords >= Math.min(2, words.length);
}

function zoneRole(name: string, description: string): "zone" | "anchor" | "detail" {
  const source = normalize(`${name} ${description}`);
  if (/altar|祭坛/.test(source)) return "anchor";
  if (/wall|drywall|fungus|墙|菌/.test(source)) return "detail";
  return "zone";
}

function candidateMentionsIdentityTime(candidate: string, identityTime: string): boolean {
  if (identityTime.includes("night")) return mentions(candidate, ["night", "midnight"]);
  if (/interior|dim|dark/.test(identityTime) && !mentions(candidate, ["day", "daylight", "sunny", "morning", "afternoon", "night", "midnight"])) {
    return true;
  }
  return false;
}

function timeOfDayDrifts(candidate: string, identityTime: string): boolean {
  const explicitTime = mentions(candidate, ["day", "daylight", "sunny", "morning", "afternoon", "night", "midnight"]);
  const explicitOutdoorNight = mentions(candidate, ["outdoor night", "exterior night", "night warehouse", "night setting"]);
  if (!explicitTime && !explicitOutdoorNight) return false;
  return !candidateMentionsIdentityTime(candidate, identityTime);
}

function paletteDrifts(candidate: string, identityPalette: string): boolean {
  const paletteContrasts = [
    { canonical: "green", conflicts: ["red", "crimson", "black"] },
    { canonical: "blue", conflicts: ["red", "orange", "warm gold"] },
    { canonical: "gray", conflicts: ["neon", "rainbow", "saturated"] },
  ];
  return paletteContrasts.some(({ canonical, conflicts }) => (
    identityPalette.includes(canonical)
    && conflicts.some((conflict) => candidate.includes(conflict))
    && (!candidate.includes(canonical) || hasNegatedWord(candidate, canonical))
  ));
}

function buildingTypeDrifts(candidate: string, identityBuilding: string): boolean {
  let drifts = false;

  if (/superstore|supermarket|big box|big-box/.test(identityBuilding)) {
    drifts = drifts || mentions(candidate, ["warehouse", "factory", "industrial bricks", "brick warehouse"])
      || hasNegatedWord(candidate, "supermarket")
      || hasNegatedWord(candidate, "superstore");
  }

  if (identityBuilding.includes("freezer")) {
    drifts = drifts || mentions(candidate, ["warehouse", "office", "bedroom", "sunlit street"])
      || hasNegatedWord(candidate, "freezer")
      || hasNegatedWord(candidate, "frozen");
  }

  if (/loading dock|dock|loading bay/.test(identityBuilding)) {
    drifts = drifts || mentions(candidate, ["office suite", "office", "cubicles", "glass atrium", "glass lobby", "bedroom", "conference room"])
      || hasNegatedWord(candidate, "dock")
      || hasNegatedWord(candidate, "blast door")
      || hasNegatedWord(candidate, "roll up door");
  }

  if (/labor|purification|machinery zone|back corridor/.test(identityBuilding)) {
    drifts = drifts || mentions(candidate, ["office suite", "office cubicles", "cubicles", "carpeted hallway", "glass atrium", "corporate office"])
      || hasNegatedWord(candidate, "machinery")
      || hasNegatedWord(candidate, "corridor")
      || hasNegatedWord(candidate, "purification");
  }

  return drifts;
}

function lightingDrifts(candidate: string, identityLighting: string): boolean {
  let drifts = false;

  if (/cold|blue gray|blue-gray|freezer/.test(identityLighting)) {
    drifts = drifts || mentions(candidate, ["warm sunlight", "golden sunlight", "candlelit", "neon nightclub"]);
  }

  if (/dim|dark|candle|practical|filtered/.test(identityLighting)) {
    drifts = drifts || mentions(candidate, [
      "bright hospital white",
      "hospital white",
      "clinical white",
      "sterile white",
      "fluorescent lighting",
      "bright fluorescent",
      "sunlit",
    ]);
  }

  return drifts;
}

function materialLanguageDrifts(candidate: string, identityMaterial: string): boolean {
  let drifts = false;

  if (/supermarket|shelves|shopping carts|concrete floor|green fabric|pallets/.test(identityMaterial)) {
    drifts = drifts || mentions(candidate, [
      "glossy marble",
      "marble floors",
      "glass walls",
      "polished marble",
      "sterile hospital tile",
      "chrome lobby",
    ]);
  }

  if (/freezer|cold tile|metal doors|fungus/.test(identityMaterial)) {
    drifts = drifts || mentions(candidate, ["wood paneling", "carpeted office", "sunlit hardwood", "glass lobby"]);
  }

  if (/concrete walls|blast door|roll up door|roll-up door|pipes|pallets/.test(identityMaterial)) {
    drifts = drifts || mentions(candidate, ["marble lobby", "glass atrium", "glass lobby", "carpeted office", "office cubicles"]);
  }

  if (/pipes|conveyor belts|metal gates|cracked concrete|backroom walls/.test(identityMaterial)) {
    drifts = drifts || mentions(candidate, ["office cubicles", "cubicles", "carpeted hallway", "marble corridor", "glass atrium"]);
  }

  return drifts;
}

function hasPositiveLandmark(candidate: string, landmark: string): boolean {
  if (hasNegatedLandmark(candidate, landmark)) return false;
  const words = landmarkWords(landmark);
  return words.some((word) => candidate.includes(word));
}

function hasNegatedLandmark(candidate: string, landmark: string): boolean {
  const normalizedLandmark = normalize(landmark);
  if (normalizedLandmark && hasNegatedPhrase(candidate, normalizedLandmark)) return true;
  return landmarkWords(landmark).some((word) => hasNegatedWord(candidate, word));
}

function hasNegatedPhrase(candidate: string, phrase: string): boolean {
  const escaped = escapeRegExp(phrase);
  return new RegExp(`\\b(?:no|without|lacking|absent|free\\s+of|stripped\\s+of)\\s+${escaped}\\b`).test(candidate)
    || new RegExp(`\\b${escaped}\\s+(?:removed|gone|absent|missing|stripped\\s+away)\\b`).test(candidate);
}

function hasNegatedWord(candidate: string, word: string): boolean {
  const escaped = escapeRegExp(word);
  return new RegExp(`\\b(?:no|without|lacking|absent|free\\s+of|stripped\\s+of)\\s+(?:\\w+\\s+){0,3}${escaped}\\b`).test(candidate)
    || new RegExp(`\\b${escaped}\\s+(?:\\w+\\s+){0,3}(?:removed|gone|absent|missing|stripped\\s+away)\\b`).test(candidate);
}

function landmarkWords(landmark: string): string[] {
  return normalize(landmark).split(" ").filter((word) => word.length > 2);
}

function mentions(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function sameName(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function slugBase(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "scene";
}

function slugId(prefix: string, value: string, index: number): string {
  return `${prefix}-${index}-${slugBase(value)}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const item = cleanName(value);
    const key = normalize(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function compactList(values: string[], limit: number): string {
  return values.map((value) => value.trim()).filter(Boolean).slice(0, limit).join("; ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
