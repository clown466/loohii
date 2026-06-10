import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const LOCAL_UPLOAD_ROOT = process.env.LOCAL_UPLOAD_ROOT || "/var/lib/loohii/uploads";
const PUBLIC_UPLOAD_ORIGIN = (process.env.PUBLIC_UPLOAD_ORIGIN || "https://loohii.com").replace(/\/+$/, "");
const DOWNLOAD_TIMEOUT_MS = Number(process.env.IMAGE_LOCALIZE_TIMEOUT_MS || 20_000);
const MAX_IMAGE_BYTES = 60 * 1024 * 1024;

const args = process.argv.slice(2);
const fix = args.includes("--fix");
const allProjects = args.includes("--all");
const projectIds = args.filter((arg) => !arg.startsWith("--"));

if (!allProjects && projectIds.length === 0) {
  console.error("Usage: node scripts/localize-project-image-urls.mjs <projectId...> [--fix]");
  console.error("       node scripts/localize-project-image-urls.mjs --all [--fix]");
  process.exit(2);
}

const projects = allProjects
  ? await prisma.project.findMany({
      where: { deletedAt: null },
      select: { id: true, ownerId: true, name: true, metadata: true },
      orderBy: { updatedAt: "desc" },
    })
  : await prisma.project.findMany({
      where: { id: { in: projectIds }, deletedAt: null },
      select: { id: true, ownerId: true, name: true, metadata: true },
    });

let grandTotal = {
  assetsLocalized: 0,
  assetsFallback: 0,
  assetsUnresolved: 0,
  metadataReplacements: 0,
  jsonRowsUpdated: 0,
};

for (const project of projects) {
  const result = await localizeProject(project);
  grandTotal.assetsLocalized += result.assetsLocalized;
  grandTotal.assetsFallback += result.assetsFallback;
  grandTotal.assetsUnresolved += result.assetsUnresolved;
  grandTotal.metadataReplacements += result.metadataReplacements;
  grandTotal.jsonRowsUpdated += result.jsonRowsUpdated;
}

console.log("\nSummary");
console.table([grandTotal]);
await prisma.$disconnect();

async function localizeProject(project) {
  const assets = await prisma.asset.findMany({
    where: { projectId: project.id, type: "IMAGE", deletedAt: null },
    select: {
      id: true,
      uploadedById: true,
      title: true,
      url: true,
      mimeType: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const localCandidatesByName = buildLocalCandidatesByName(assets);
  const urlMap = new Map();
  seedKnownLocalUrlMappings(assets, urlMap);
  const updates = [];
  const unresolved = [];
  let assetsLocalized = 0;
  let assetsFallback = 0;

  console.log(`\nProject ${project.id} ${project.name || ""}`);
  console.log(`Mode: ${fix ? "fix" : "dry-run"}`);

  for (const asset of assets) {
    if (!isImageSource(asset.url) || isLocalUploadUrl(asset.url)) continue;

    const assetName = assetNameFromAsset(asset);
    const userId = asset.uploadedById || project.ownerId;
    let nextUrl = "";
    let mode = "";
    let mimeType = asset.mimeType || "";
    let storageKey = "";
    let errorMessage = "";

    if (isDataImageUrl(asset.url)) {
      try {
        const parsed = parseDataImageUrl(asset.url);
        const stored = await persistBuffer({
          buffer: parsed.buffer,
          contentType: parsed.contentType,
          userId,
          projectId: project.id,
          prefix: "data-url",
          sourceId: asset.id,
        });
        nextUrl = stored.url;
        mimeType = stored.mimeType;
        storageKey = stored.key;
        mode = "data-url";
      } catch (error) {
        errorMessage = errorMessageFrom(error);
      }
    } else if (isExternalHttpUrl(asset.url)) {
      try {
        const downloaded = await downloadImage(asset.url);
        const stored = await persistBuffer({
          buffer: downloaded.buffer,
          contentType: downloaded.contentType,
          userId,
          projectId: project.id,
          prefix: "external",
          sourceId: asset.id,
        });
        nextUrl = stored.url;
        mimeType = stored.mimeType;
        storageKey = stored.key;
        mode = "download";
      } catch (error) {
        errorMessage = errorMessageFrom(error);
        const fallback = fallbackForAsset(asset, localCandidatesByName);
        if (fallback) {
          nextUrl = fallback.url;
          mimeType = fallback.mimeType || mimeType || "";
          mode = "fallback";
        }
      }
    }

    if (!nextUrl || nextUrl === asset.url) {
      unresolved.push({
        id: asset.id,
        title: asset.title,
        assetName,
        url: shortUrl(asset.url),
        error: errorMessage || "No local fallback found",
      });
      continue;
    }

    addUrlMapping(urlMap, asset.url, nextUrl);
    updates.push({
      asset,
      nextUrl,
      mode,
      mimeType,
      storageKey,
      errorMessage,
    });
    if (mode === "fallback") assetsFallback += 1;
    else assetsLocalized += 1;
  }

  for (const update of updates) {
    console.log(`${update.mode.toUpperCase()} ${update.asset.id} ${update.asset.title || ""}`);
    console.log(`  ${shortUrl(update.asset.url)}`);
    console.log(`  -> ${shortUrl(update.nextUrl)}`);
  }
  for (const item of unresolved) {
    console.log(`UNRESOLVED ${item.id} ${item.title || ""} ${item.assetName || ""}`);
    console.log(`  ${item.url}`);
    if (item.error) console.log(`  ${item.error}`);
  }

  let metadataReplacements = 0;
  let jsonRowsUpdated = 0;

  if (fix) {
    for (const update of updates) {
      const metadata = isRecord(update.asset.metadata) ? update.asset.metadata : {};
      const metadataReplacement = replaceExactUrls(metadata, urlMap);
      await prisma.asset.update({
        where: { id: update.asset.id },
        data: {
          url: update.nextUrl,
          mimeType: update.mimeType || update.asset.mimeType || undefined,
          ...(update.storageKey ? { storageKey: update.storageKey } : {}),
          metadata: {
            ...(isRecord(metadataReplacement.value) ? metadataReplacement.value : metadata),
            localizedImageUrlAt: new Date().toISOString(),
            localizedImageUrlMode: update.mode,
            originalImageUrl: stringFrom(metadata.originalImageUrl) || update.asset.url,
            ...(update.mode === "fallback" && update.errorMessage ? { originalImageUrlError: update.errorMessage } : {}),
          },
        },
      });
    }

    const projectReplacement = replaceExactUrls(project.metadata, urlMap);
    if (projectReplacement.changed) {
      await prisma.project.update({
        where: { id: project.id },
        data: { metadata: projectReplacement.value },
      });
      metadataReplacements += projectReplacement.count;
      jsonRowsUpdated += 1;
    }

    const assetMetadataRows = await prisma.asset.findMany({
      where: { projectId: project.id, type: "IMAGE", deletedAt: null },
      select: { id: true, metadata: true },
    });
    for (const asset of assetMetadataRows) {
      const replacement = replaceExactUrls(asset.metadata, urlMap);
      if (!replacement.changed) continue;
      await prisma.asset.update({
        where: { id: asset.id },
        data: { metadata: replacement.value },
      });
      metadataReplacements += replacement.count;
      jsonRowsUpdated += 1;
    }

    const characters = await prisma.character.findMany({
      where: { projectId: project.id, deletedAt: null },
      select: { id: true, traits: true },
    });
    for (const character of characters) {
      const replacement = replaceExactUrls(character.traits, urlMap);
      if (!replacement.changed) continue;
      await prisma.character.update({
        where: { id: character.id },
        data: { traits: replacement.value },
      });
      metadataReplacements += replacement.count;
      jsonRowsUpdated += 1;
    }

    const scenes = await prisma.scene.findMany({
      where: { projectId: project.id, deletedAt: null },
      select: { id: true, metadata: true },
    });
    for (const scene of scenes) {
      const replacement = replaceExactUrls(scene.metadata, urlMap);
      if (!replacement.changed) continue;
      await prisma.scene.update({
        where: { id: scene.id },
        data: { metadata: replacement.value },
      });
      metadataReplacements += replacement.count;
      jsonRowsUpdated += 1;
    }

    const generations = await prisma.generation.findMany({
      where: { projectId: project.id },
      select: { id: true, input: true, parameters: true },
    });
    for (const generation of generations) {
      const inputReplacement = replaceExactUrls(generation.input, urlMap);
      const parametersReplacement = replaceExactUrls(generation.parameters, urlMap);
      if (!inputReplacement.changed && !parametersReplacement.changed) continue;
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          ...(inputReplacement.changed ? { input: inputReplacement.value } : {}),
          ...(parametersReplacement.changed ? { parameters: parametersReplacement.value } : {}),
        },
      });
      metadataReplacements += inputReplacement.count + parametersReplacement.count;
      jsonRowsUpdated += 1;
    }
  } else {
    const projectReplacement = replaceExactUrls(project.metadata, urlMap);
    metadataReplacements += projectReplacement.count;
    const assetMetadataRows = await prisma.asset.findMany({
      where: { projectId: project.id, type: "IMAGE", deletedAt: null },
      select: { metadata: true },
    });
    for (const asset of assetMetadataRows) {
      metadataReplacements += replaceExactUrls(asset.metadata, urlMap).count;
    }
    const characters = await prisma.character.findMany({
      where: { projectId: project.id, deletedAt: null },
      select: { traits: true },
    });
    for (const character of characters) {
      metadataReplacements += replaceExactUrls(character.traits, urlMap).count;
    }
    const scenes = await prisma.scene.findMany({
      where: { projectId: project.id, deletedAt: null },
      select: { metadata: true },
    });
    for (const scene of scenes) {
      metadataReplacements += replaceExactUrls(scene.metadata, urlMap).count;
    }
    const generations = await prisma.generation.findMany({
      where: { projectId: project.id },
      select: { input: true, parameters: true },
    });
    for (const generation of generations) {
      metadataReplacements += replaceExactUrls(generation.input, urlMap).count;
      metadataReplacements += replaceExactUrls(generation.parameters, urlMap).count;
    }
  }

  const result = {
    assetsLocalized,
    assetsFallback,
    assetsUnresolved: unresolved.length,
    metadataReplacements,
    jsonRowsUpdated,
  };
  console.table([result]);
  return result;
}

function buildLocalCandidatesByName(assets) {
  const map = new Map();
  for (const asset of assets) {
    if (!isLocalUploadUrl(asset.url)) continue;
    for (const key of assetFallbackKeys(asset)) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(asset);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  }
  return map;
}

function fallbackForAsset(asset, localCandidatesByName) {
  for (const key of assetFallbackKeys(asset)) {
    const candidates = localCandidatesByName.get(key) || [];
    const candidate = candidates.find((item) => item.id !== asset.id);
    if (candidate) return candidate;
  }
  return fuzzyFallbackForAsset(asset, localCandidatesByName);
}

function fuzzyFallbackForAsset(asset, localCandidatesByName) {
  const requestedName = normalizeName(assetNameFromAsset(asset));
  if (!requestedName || isGenericAssetName(requestedName) || requestedName.length < 6) return null;
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  const requestedKind = stringFrom(metadata.workflowAssetKind);

  for (const [key, candidates] of localCandidatesByName.entries()) {
    const parsed = parseAssetNameKey(key);
    if (!parsed?.name) continue;
    if (requestedKind && parsed.kind && requestedKind !== parsed.kind) continue;
    if (!areCompatibleAssetNames(requestedName, parsed.name)) continue;
    const candidate = candidates.find((item) => item.id !== asset.id);
    if (candidate) return candidate;
  }
  return null;
}

function assetFallbackKeys(asset) {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  const keys = new Set();
  const workflowKind = stringFrom(metadata.workflowAssetKind);
  const assetName = assetNameFromAsset(asset);
  for (const name of assetNameAliases(assetName)) {
    keys.add(assetNameKey("", name));
    if (workflowKind) keys.add(assetNameKey(workflowKind, name));
  }

  const clipId = stringFrom(metadata.clipId);
  if (clipId && assetLooksLikeStoryboard(asset)) keys.add(`storyboard:clip:${normalizeName(clipId)}`);

  const nodeId = stringFrom(metadata.nodeId);
  if (nodeId && assetLooksLikeStoryboard(asset)) keys.add(`storyboard:node:${normalizeName(nodeId)}`);

  const title = normalizeStoryboardTitle(stringFrom(metadata.title) || stringFrom(metadata.clipTitle));
  if (title && assetLooksLikeStoryboard(asset)) keys.add(`storyboard:title:${title}`);

  return Array.from(keys).filter(Boolean);
}

function assetNameFromAsset(asset) {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  const name = stringFrom(metadata.assetName)
    || stringFrom(metadata.characterName)
    || stripGeneratedTitle(asset.title || "");
  return isGenericAssetName(name) ? "" : name;
}

function assetLooksLikeStoryboard(asset) {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  return Boolean(
    metadata.storyboardForClip === true
      || stringFrom(metadata.clipNodeKind) === "storyboard"
      || stringFrom(metadata.title).includes("故事板")
      || /storyboard/i.test(stringFrom(metadata.title))
      || /storyboard/i.test(stringFrom(metadata.prompt))
  );
}

function stripGeneratedTitle(value) {
  return String(value || "")
    .replace(/\s+generated asset image$/i, "")
    .replace(/\s+selected canvas image$/i, "")
    .replace(/\s+reference image$/i, "")
    .replace(/^角色参考[-_\s]*/i, "")
    .trim();
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ");
}

function normalizeStoryboardTitle(value) {
  return normalizeName(value)
    .replace(/\s+故事板$/i, "")
    .replace(/\s+storyboard$/i, "")
    .trim();
}

function isGenericAssetName(value) {
  const normalized = normalizeName(value);
  return !normalized || [
    "canvas generated image",
    "generated image",
    "image",
    "asset image",
    "reference image",
  ].includes(normalized);
}

function assetNameAliases(value) {
  const normalized = normalizeName(value);
  if (isGenericAssetName(normalized)) return [];
  const aliases = new Set([normalized]);
  const withoutPossessiveOwner = normalized.replace(/^[a-z0-9_-]+'s\s+/, "").trim();
  if (withoutPossessiveOwner && withoutPossessiveOwner !== normalized && !isGenericAssetName(withoutPossessiveOwner)) {
    aliases.add(withoutPossessiveOwner);
  }
  return Array.from(aliases);
}

function assetNameKey(kind, name) {
  return `asset:${kind || "*"}:${normalizeName(name)}`;
}

function parseAssetNameKey(key) {
  const match = String(key).match(/^asset:([^:]*):(.*)$/);
  if (!match) return null;
  return {
    kind: match[1] === "*" ? "" : match[1],
    name: match[2],
  };
}

function areCompatibleAssetNames(requestedName, candidateName) {
  const requested = normalizeName(requestedName);
  const candidate = normalizeName(candidateName);
  if (!requested || !candidate) return false;
  if (requested === candidate) return true;
  if (candidate.endsWith(` ${requested}`) && candidate.includes("'s ")) return true;
  if (requested.endsWith(` ${candidate}`) && requested.includes("'s ")) return true;
  return false;
}

function seedKnownLocalUrlMappings(assets, urlMap) {
  for (const asset of assets) {
    if (!isLocalUploadUrl(asset.url)) continue;
    const metadata = isRecord(asset.metadata) ? asset.metadata : {};
    for (const value of [metadata.originalProviderImageUrl, metadata.originalImageUrl]) {
      const originalUrl = stringFrom(value);
      if (isExternalHttpUrl(originalUrl)) addUrlMapping(urlMap, originalUrl, asset.url);
    }
  }
}

function addUrlMapping(urlMap, from, to) {
  if (!from || !to || from === to) return;
  urlMap.set(from, to);
  const canonical = canonicalUrlWithoutSearch(from);
  if (canonical && canonical !== from) urlMap.set(canonical, to);
}

function canonicalUrlWithoutSearch(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function replaceExactUrls(value, urlMap) {
  let count = 0;
  const replace = (input) => {
    if (typeof input === "string") {
      const next = urlMap.get(input);
      if (next) {
        count += 1;
        return next;
      }
      return input;
    }
    if (Array.isArray(input)) {
      let changed = false;
      const next = input.map((item) => {
        const replaced = replace(item);
        if (replaced !== item) changed = true;
        return replaced;
      });
      return changed ? next : input;
    }
    if (isRecord(input)) {
      let changed = false;
      const next = {};
      for (const [key, item] of Object.entries(input)) {
        const replaced = replace(item);
        if (replaced !== item) changed = true;
        next[key] = replaced;
      }
      return changed ? next : input;
    }
    return input;
  };
  const nextValue = replace(value);
  return { value: nextValue, changed: nextValue !== value, count };
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: imageDownloadHeaders(),
    });
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => undefined);
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = normalizeContentType(response.headers.get("content-type") || "", url);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error("image larger than 60MB");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error("empty image body");
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error("image larger than 60MB");
    return { buffer, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

async function persistBuffer({ buffer, contentType, userId, projectId, prefix, sourceId }) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const extension = extensionForContentType(contentType);
  const key = safeUploadKey([
    userId,
    "generated-migrated",
    projectId,
    `${prefix}-${sourceId}-${hash}.${extension}`,
  ].join("/"));
  const filePath = path.join(LOCAL_UPLOAD_ROOT, key);
  const rootPath = path.resolve(LOCAL_UPLOAD_ROOT);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) throw new Error("invalid upload path");
  if (fix) {
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, buffer);
  }
  return {
    key,
    url: publicUploadUrl(key),
    mimeType: contentType,
  };
}

function parseDataImageUrl(value) {
  const match = String(value).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("invalid data image url");
  const contentType = normalizeContentType(match[1], "");
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (buffer.length === 0) throw new Error("empty data image");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("image larger than 60MB");
  return { contentType, buffer };
}

function imageDownloadHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36 Loohii/1.0",
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: "https://loohii.com/",
  };
}

function normalizeContentType(value, sourceUrl) {
  const raw = String(value || "").split(";")[0].trim().toLowerCase();
  if (raw.startsWith("image/")) return raw === "image/jpg" ? "image/jpeg" : raw;
  if (raw === "application/octet-stream" || !raw) return contentTypeFromPath(sourceUrl);
  throw new Error(`not an image content-type: ${raw}`);
}

function contentTypeFromPath(sourceUrl) {
  const pathname = (() => {
    try {
      return new URL(sourceUrl).pathname;
    } catch {
      return String(sourceUrl || "");
    }
  })();
  const extension = path.extname(pathname).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

function extensionForContentType(contentType) {
  if (contentType === "image/jpeg" || contentType === "image/jpg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "png";
}

function safeUploadKey(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/")
    .slice(0, 700);
}

function publicUploadUrl(key) {
  return `${PUBLIC_UPLOAD_ORIGIN}/api/uploads/public/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function isImageSource(value) {
  return typeof value === "string" && (/^https?:\/\//i.test(value) || /^data:image\//i.test(value));
}

function isLocalUploadUrl(value) {
  return typeof value === "string" && value.includes("/api/uploads/public/");
}

function isDataImageUrl(value) {
  return typeof value === "string" && /^data:image\//i.test(value);
}

function isExternalHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value) && !isLocalUploadUrl(value);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringFrom(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function shortUrl(value) {
  const text = String(value || "");
  return text.length > 170 ? `${text.slice(0, 170)}...` : text;
}

function errorMessageFrom(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}
