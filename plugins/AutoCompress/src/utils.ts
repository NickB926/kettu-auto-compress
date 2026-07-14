export function formatBytes(bytes: number, decimals = 1): string {
  if (!+bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    sizes.length - 1,
    Math.floor(Math.log(bytes) / Math.log(k))
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function isVideoUpload(media: any): boolean {
  if (media?.isVideo === true) return true;
  const mime = String(
    media?.mimeType ?? media?.item?.mimeType ?? media?.contentType ?? ""
  ).toLowerCase();
  if (mime.startsWith("video/")) return true;
  const name = String(
    media?.filename ?? media?.item?.filename ?? media?.name ?? media?.item?.name ?? ""
  ).toLowerCase();
  return /\.(mp4|mov|mkv|webm|avi|m4v|3gp|mpeg|mpg)$/.test(name);
}

export function isImageUpload(media: any): boolean {
  if (media?.isImage === true) return true;
  const mime = String(
    media?.mimeType ?? media?.item?.mimeType ?? media?.contentType ?? ""
  ).toLowerCase();
  if (mime.startsWith("image/")) return true;
  const name = String(
    media?.filename ?? media?.item?.filename ?? media?.name ?? media?.item?.name ?? ""
  ).toLowerCase();
  return /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/.test(name);
}

export function getUploadUri(media: any): string | null {
  const candidates = [
    media?.item?.originalUri,
    media?.item?.uri,
    media?.uri,
    media?.fileUri,
    media?.path,
    media?.sourceURL,
    media?.item?.file?.uri,
    media?.file?.uri,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

export function getUploadSize(media: any): number {
  const candidates = [
    media?.preCompressionSize,
    media?.currentSize,
    media?.postCompressionSize,
    media?.size,
    media?.item?.size,
    media?.item?.file?.size,
    media?.file?.size,
  ];
  for (const n of candidates) {
    if (typeof n === "number" && n > 0) return n;
    if (typeof n === "string") {
      const parsed = parseInt(n, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
}

export function applyCompressedUri(
  media: any,
  uri: string,
  size?: number
): void {
  if (media.item && typeof media.item === "object") {
    if ("uri" in media.item) media.item.uri = uri;
    if ("originalUri" in media.item) media.item.originalUri = uri;
  }
  if ("uri" in media) media.uri = uri;
  if ("fileUri" in media) media.fileUri = uri;
  if ("path" in media) media.path = uri;
  if ("sourceURL" in media) media.sourceURL = uri;

  if (typeof size === "number" && size > 0) {
    media.preCompressionSize = size;
    media.postCompressionSize = size;
    media.currentSize = size;
    if (media.item && typeof media.item === "object") {
      media.item.size = size;
    }
  }

  if ("reactNativeFilePrepped" in media) media.reactNativeFilePrepped = false;
}
