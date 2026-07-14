import { ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

import { ensureSettings } from "./config";

const { FormSection, FormInput, FormSwitch, FormRow, FormDivider } = Forms;
const { ScrollView } = ReactNative;

export default function SettingsPanel() {
  ensureSettings();
  useProxy(storage);

  return (
    <ScrollView style={{ flex: 1 }}>
      <FormSection title="Target size">
        <FormInput
          title="Max size (MB)"
          keyboardType="numeric"
          placeholder="20"
          value={String(storage.maxMB ?? 20)}
          onChange={(v: string) => {
            const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
            storage.maxMB = !isNaN(n) && n > 0 ? n : 20;
          }}
        />
        <FormRow label="Default is 20MB. Free Discord is often 25MB — raise it if needed." />
      </FormSection>

      <FormDivider />

      <FormSection title="What to compress">
        <FormRow
          label="Videos"
          subLabel="Compress oversized videos before upload"
          trailing={
            <FormSwitch
              value={!!storage.compressVideos}
              onValueChange={(v: boolean) => {
                storage.compressVideos = v;
              }}
            />
          }
        />
        <FormRow
          label="Images"
          subLabel="Compress oversized images; block if still too big"
          trailing={
            <FormSwitch
              value={!!storage.compressImages}
              onValueChange={(v: boolean) => {
                storage.compressImages = v;
              }}
            />
          }
        />
      </FormSection>

      <FormDivider />

      <FormSection title="Failure behavior">
        <FormRow
          label="Block send if still too large"
          subLabel="Recommended — avoids a doomed Discord upload"
          trailing={
            <FormSwitch
              value={!!storage.blockOnFail}
              onValueChange={(v: boolean) => {
                storage.blockOnFail = v;
              }}
            />
          }
        />
        <FormRow
          label="Show toasts"
          trailing={
            <FormSwitch
              value={!!storage.showToasts}
              onValueChange={(v: boolean) => {
                storage.showToasts = v;
              }}
            />
          }
        />
      </FormSection>

      <FormSection title="Limits">
        <FormRow
          label="No FFmpeg in pure Kettu plugins"
          subLabel="Uses Discord’s native compress first. Long/high-bitrate clips may still fail."
        />
      </FormSection>
    </ScrollView>
  );
}
