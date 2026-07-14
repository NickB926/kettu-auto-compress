import { storage } from "@vendetta/plugin";

export const MB = 1024 * 1024;

export type Provider =
  | "ezgif"
  | "freeconvert"
  | "cloudinary"
  | "catbox";

export type PluginConfig = {
  maxMB: number;
  compressVideos: boolean;
  compressImages: boolean;
  blockOnFail: boolean;
  showToasts: boolean;
  debugToasts: boolean;
  fallbackExternal: boolean;
  /**
   * ezgif / freeconvert / cloudinary: remote compress → prefer Discord attachment
   * catbox: link only
   */
  provider: Provider;
  catboxUserhash: string;
  freeConvertApiKey: string;
  cloudinaryCloudName: string;
  cloudinaryUploadPreset: string;
};

const PROVIDERS: Provider[] = [
  "ezgif",
  "freeconvert",
  "cloudinary",
  "catbox",
];

const defaults: PluginConfig = {
  maxMB: 24,
  compressVideos: true,
  compressImages: true,
  blockOnFail: true,
  showToasts: true,
  debugToasts: false,
  fallbackExternal: true,
  provider: "ezgif",
  catboxUserhash: "",
  freeConvertApiKey: "",
  cloudinaryCloudName: "",
  cloudinaryUploadPreset: "",
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
  if (typeof storage.showToasts !== "boolean")
    storage.showToasts = defaults.showToasts;
  if (typeof storage.debugToasts !== "boolean")
    storage.debugToasts = defaults.debugToasts;
  if (typeof storage.fallbackExternal !== "boolean")
    storage.fallbackExternal = defaults.fallbackExternal;

  if (!PROVIDERS.includes(storage.provider as Provider)) {
    const hasCl =
      String(storage.cloudinaryCloudName ?? "").trim() &&
      String(storage.cloudinaryUploadPreset ?? "").trim();
    storage.provider = hasCl ? "cloudinary" : defaults.provider;
  }

  if (typeof storage.catboxUserhash !== "string")
    storage.catboxUserhash = defaults.catboxUserhash;
  if (typeof storage.freeConvertApiKey !== "string")
    storage.freeConvertApiKey = defaults.freeConvertApiKey;
  if (typeof storage.cloudinaryCloudName !== "string")
    storage.cloudinaryCloudName = defaults.cloudinaryCloudName;
  if (typeof storage.cloudinaryUploadPreset !== "string")
    storage.cloudinaryUploadPreset = defaults.cloudinaryUploadPreset;

  try {
    delete storage.externalHost;
  } catch {
    storage.externalHost = undefined;
  }

  return storage as PluginConfig;
}

export function maxBytes(): number {
  return Math.max(1, coerceMaxMB(storage.maxMB ?? defaults.maxMB)) * MB;
}

export function getCatboxUserhash(): string {
  return String(storage.catboxUserhash ?? "").trim();
}

export function getCloudinaryConfig(): {
  cloudName: string;
  uploadPreset: string;
} | null {
  const cloudName = String(storage.cloudinaryCloudName ?? "").trim();
  const uploadPreset = String(storage.cloudinaryUploadPreset ?? "").trim();
  if (!cloudName || !uploadPreset) return null;
  return { cloudName, uploadPreset };
}

export function getFreeConvertApiKey(): string {
  return String(storage.freeConvertApiKey ?? "").trim();
}
