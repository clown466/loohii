import type { WorkflowAssetImageHistoryItem } from "@/lib/api/types";

export type WorkflowAssetKind = "characters" | "scenes" | "props";

export function assetHistoryImageIsWithProps(image: WorkflowAssetImageHistoryItem): boolean {
  if (image.variant === "with-props") return true;
  const text = [
    image.title,
    image.prompt,
    image.revisedPrompt,
  ].filter(Boolean).join("\n").toLowerCase();
  if (/character image variant:\s*with signature carried props|personal prop continuity|signature carried props|道具版|绑定道具|with-props/.test(text)) return true;
  return Boolean(image.prompt && image.referenceImageCount && image.referenceImageCount >= 2);
}

export function reusableAssetHistoryImages(
  kind: WorkflowAssetKind,
  images: WorkflowAssetImageHistoryItem[],
  normalizeReusableImageSource: (value: unknown) => string,
) {
  return images
    .filter((image) => image.id && normalizeReusableImageSource(image.url))
    .filter((image) => image.status ? !/failed|canceled/i.test(image.status) : true)
    .filter((image) => kind === "characters" ? !assetHistoryImageIsWithProps(image) : true);
}

export function orderedReusableAssetHistoryImages(
  kind: WorkflowAssetKind,
  images: WorkflowAssetImageHistoryItem[],
  normalizeReusableImageSource: (value: unknown) => string,
) {
  const reusable = reusableAssetHistoryImages(kind, images, normalizeReusableImageSource);
  return [
    ...reusable.filter((image) => !image.isCurrent),
    ...reusable.filter((image) => image.isCurrent),
  ];
}
