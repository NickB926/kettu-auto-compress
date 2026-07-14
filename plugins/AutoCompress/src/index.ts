import { logger } from "@vendetta";

import { ensureSettings } from "./config";
import { patchUploader } from "./patch";
import SettingsPanel from "./SettingsPanel";

const unpatches: Array<() => void> = [];

export default {
  onLoad: () => {
    ensureSettings();
    unpatches.push(patchUploader());
    logger.log("[AutoCompress] loaded (target", ensureSettings().maxMB, "MB)");
  },
  onUnload: () => {
    for (const u of unpatches.splice(0)) {
      try {
        u();
      } catch {}
    }
    logger.log("[AutoCompress] unloaded");
  },
  settings: SettingsPanel,
};
