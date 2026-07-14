import { storage } from "@vendetta/plugin";

export const MB = 1024 * 1024;

export type PluginConfig = {
  maxMB: number;
  compressVideos: boolean;
  compressImages: boolean;
  blockOnFail: boolean;
  showToasts: boolean;
  debugToasts: boolean;
  /** Upload oversized media to Catbox and send the link. */
  fallbackExternal: boolean;
  /** Catbox account userhash — required (anonymous API is blocked). */
  catboxUserhash: string;
};

const defaults: PluginConfig = {
  maxMB: 24,
  compressVideos: true,
  compressImages: true,
  blockOnFail: true,
  showToasts: true,
  debugToasts: false,
  fallbackExternal: true,
  catboxUserhash: "",
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
  if (typeof storage.fallbackExternal !== "boolean")
    storage.fallbackExternal = defaults.fallbackExternal;
  if (typeof storage.catboxUserhash !== "string")
    storage.catboxUserhash = defaults.catboxUserhash;

  // Drop legacy litterbox preference if still stored.
  if (storage.externalHost != null) {
    try {
      delete storage.externalHost;
    } catch {
      storage.externalHost = undefined;
    }
  }

  return storage as PluginConfig;
}

export function maxBytes(): number {
  return Math.max(1, coerceMaxMB(storage.maxMB ?? defaults.maxMB)) * MB;
}

export function getCatboxUserhash(): string {
  return String(storage.catboxUserhash ?? "").trim();
}
