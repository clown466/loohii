const LOCAL_UPLOAD_IMAGE_RE = /\/api\/uploads\/public\/.+\.(png|jpe?g|webp|gif)$/i;

export function thumbUrl(url: string | null | undefined, width: 300 | 1024): string {
  if (!url) return "";
  if (/\.thumb(300|1024)\.webp$/i.test(url)) return url;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (!LOCAL_UPLOAD_IMAGE_RE.test(url)) return url;
  return `${url}.thumb${width}.webp`;
}
