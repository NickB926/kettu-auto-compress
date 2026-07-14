import { storage } from "@vendetta/plugin";

export const MB = 1024 * 1024;

export type PluginConfig = {
  maxMB: number;
  compressVideos: boolean;
  compressImages: boolean;
  blockOnFail: boolean;
  /** Oversized videos → ezgif compress, then Discord attach / link */
  fallbackExternal: boolean;
};

const defaults: PluginConfig = {
  maxMB: 20,
  compressVideos: true,
  compressImages: true,
  blockOnFail: true,
  fallbackExternal: true,
};

function coerceMaxMB(raw: unknown): number {
  if (typeof raw === "number" && raw > 0 && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n > 0) return n;
  }
  return defaults.maxMB;
}

export function ensureSettings(): PluginConfig {
  const coerced = coerceMaxMB(storage.maxMB);
  if (storage.maxMB !== coerced) storage.maxMB = coerced;

  if (typeof storage.compressVideos !== "boolean")
    storage.compressVideos = defaults.compressVideos;
  if (typeof storage.compressImages !== "boolean")
    storage.compressImages = defaults.compressImages;
  if (typeof storage.blockOnFail !== "boolean")
    storage.blockOnFail = defaults.blockOnFail;
  if (typeof storage.fallbackExternal !== "boolean")
    storage.fallbackExternal = defaults.fallbackExternal;

  // Drop legacy provider / debug fields from older installs.
  try {
    delete storage.debugToasts;
    delete storage.showToasts;
    delete storage.provider;
    delete storage.catboxUserhash;
    delete storage.freeConvertApiKey;
    delete storage.cloudinaryCloudName;
    delete storage.cloudinaryUploadPreset;
    delete storage.externalHost;
  } catch {}

  return storage as PluginConfig;
}

export function maxBytes(): number {
  return Math.max(1, coerceMaxMB(storage.maxMB ?? defaults.maxMB)) * MB;
}
