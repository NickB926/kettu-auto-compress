import { storage } from "@vendetta/plugin";

export const MB = 1024 * 1024;

export type PluginConfig = {
  maxMB: number;
  compressVideos: boolean;
  compressImages: boolean;
  blockOnFail: boolean;
  showToasts: boolean;
  /** Toast every upload the hook sees (helps debug "not working") */
  debugToasts: boolean;
};

const defaults: PluginConfig = {
  maxMB: 20,
  compressVideos: true,
  compressImages: true,
  blockOnFail: true,
  showToasts: true,
  debugToasts: true,
};

function coerceMaxMB(raw: unknown): number {
  if (typeof raw === "number" && raw > 0 && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n > 0) return n;
  }
  return defaults.maxMB;
}

/** Only writes storage when a value is actually missing/wrong — safe under useProxy. */
export function ensureSettings(): PluginConfig {
  const coerced = coerceMaxMB(storage.maxMB);
  if (storage.maxMB !== coerced) storage.maxMB = coerced;

  if (typeof storage.compressVideos !== "boolean")
    storage.compressVideos = defaults.compressVideos;
  if (typeof storage.compressImages !== "boolean")
    storage.compressImages = defaults.compressImages;
  if (typeof storage.blockOnFail !== "boolean")
    storage.blockOnFail = defaults.blockOnFail;
  if (typeof storage.showToasts !== "boolean")
    storage.showToasts = defaults.showToasts;
  if (typeof storage.debugToasts !== "boolean")
    storage.debugToasts = defaults.debugToasts;

  return storage as PluginConfig;
}

export function maxBytes(): number {
  return Math.max(1, coerceMaxMB(storage.maxMB ?? defaults.maxMB)) * MB;
}
