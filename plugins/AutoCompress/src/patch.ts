import { findByProps } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";

import { compressUpload } from "./compress";
import { ensureSettings, maxBytes } from "./config";
import {
  formatBytes,
  getUploadSize,
  isImageUpload,
  isVideoUpload,
} from "./utils";

function toast(msg: string) {
  if (ensureSettings().showToasts) showToast(msg);
}

export function patchUploader(): () => void {
  const mod = findByProps("CloudUpload");
  const CloudUpload = mod?.CloudUpload;
  if (!CloudUpload?.prototype?.reactNativeCompressAndExtractData) {
    console.warn("[AutoCompress] CloudUpload.reactNativeCompressAndExtractData not found");
    toast("AutoCompress: upload hook missing (Discord update?)");
    return () => {};
  }

  const original = CloudUpload.prototype.reactNativeCompressAndExtractData;

  CloudUpload.prototype.reactNativeCompressAndExtractData = async function (
    ...args: any[]
  ) {
    const settings = ensureSettings();
    const limit = maxBytes();
    const size = getUploadSize(this);
    const video = isVideoUpload(this);
    const image = isImageUpload(this);

    const wantsVideo = settings.compressVideos && video;
    const wantsImage = settings.compressImages && image;
    const oversized = size > limit;

    // Under the limit, or not a type we care about → default Discord path.
    if (!oversized || (!wantsVideo && !wantsImage)) {
      return original.apply(this, args);
    }

    const kind = video ? "video" : "image";
    toast(`Compressing ${kind} (${formatBytes(size)} → ≤${settings.maxMB}MB)…`);

    try {
      const result = await compressUpload(this, original, args, limit);

      if (result.proceeded && result.finalSize <= limit) {
        toast(
          `Compressed to ${formatBytes(result.finalSize)} (${result.method})`
        );
        return result.prepResult;
      }

      // Still too large
      if (settings.blockOnFail) {
        toast(
          `Still ${formatBytes(result.finalSize)} — over ${settings.maxMB}MB. Send blocked.`
        );
        try {
          if (typeof this.setStatus === "function") this.setStatus("CANCELED");
          else if (typeof this.cancel === "function") this.cancel();
        } catch {}
        return null;
      }

      toast(
        `Still ${formatBytes(result.finalSize)} after compress — uploading anyway`
      );
      return result.prepResult;
    } catch (err) {
      console.error("[AutoCompress] compress failed:", err);
      if (settings.blockOnFail) {
        toast("Compression failed — send blocked");
        try {
          if (typeof this.setStatus === "function") this.setStatus("CANCELED");
          else if (typeof this.cancel === "function") this.cancel();
        } catch {}
        return null;
      }
      toast("Compression failed — using original file");
      return original.apply(this, args);
    }
  };

  return () => {
    CloudUpload.prototype.reactNativeCompressAndExtractData = original;
  };
}
