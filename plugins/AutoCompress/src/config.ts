import { storage } from "@vendetta/plugin";

export const MB = 1024 * 1024;

export type PluginConfig = {
  /** Target max upload size in megabytes */
  maxMB: number;
  /** Compress videos over the limit */
  compressVideos: boolean;
  /** Also re-run Discord compress for large images */
  compressImages: boolean;
  /** Cancel the send if still over the limit after compress */
  blockOnFail: boolean;
  /** Show toasts for progress / results */
  showToasts: boolean;
};

const defaults: PluginConfig = {
  maxMB: 20,
  compressVideos: true,
  compressImages: true,
  blockOnFail: true,
  showToasts: true,
};

export function ensureSettings(): PluginConfig {
  if (typeof storage.maxMB !== "number" || !(storage.maxMB > 0))
    storage.maxMB = defaults.maxMB;
  if (typeof storage.compressVideos !== "boolean")
    storage.compressVideos = defaults.compressVideos;
  if (typeof storage.compressImages !== "boolean")
    storage.compressImages = defaults.compressImages;
  if (typeof storage.blockOnFail !== "boolean")
    storage.blockOnFail = defaults.blockOnFail;
  if (typeof storage.showToasts !== "boolean")
    storage.showToasts = defaults.showToasts;

  return storage as PluginConfig;
}

export function maxBytes(): number {
  const mb = ensureSettings().maxMB;
  return Math.max(1, mb) * MB;
}
