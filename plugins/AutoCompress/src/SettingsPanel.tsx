import { React, ReactNative } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

import { ensureSettings } from "./config";

const ScrollView =
  ReactNative?.ScrollView ?? findByProps("ScrollView")?.ScrollView ?? ReactNative.View;

const Table = findByProps("TableSwitchRow", "TableRowGroup", "TableRow");
const TextInputMod = findByProps("TextInput");
const { FormSection, FormInput, FormSwitch, FormRow, FormDivider } = Forms ?? {};

function parseMB(raw: string): number | null {
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  if (isNaN(n) || n <= 0) return null;
  return n;
}

export default function SettingsPanel() {
  React.useEffect(() => {
    ensureSettings();
  }, []);

  useProxy(storage);

  const [draft, setDraft] = React.useState(() =>
    String(storage.maxMB ?? 24)
  );
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (focused.current) return;
    setDraft(String(storage.maxMB ?? 24));
  }, [storage.maxMB]);

  const commitDraft = () => {
    const n = parseMB(draft);
    if (n == null) {
      setDraft(String(storage.maxMB ?? 24));
      return;
    }
    if (storage.maxMB !== n) storage.maxMB = n;
    setDraft(String(n));
  };

  if (Table?.TableRowGroup && TextInputMod?.TextInput) {
    const { TableRowGroup, TableSwitchRow, TableRow } = Table;
    const { TextInput } = TextInputMod;

    return (
      <ScrollView style={{ flex: 1 }}>
        <TableRowGroup title="Target size">
          <TableRow
            label="Max size (MB)"
            subLabel="Stay ≤24–25 for free Discord. Tap away to save."
          />
          <TextInput
            value={draft}
            placeholder="24"
            keyboardType="numeric"
            onChange={(v: string) => setDraft(String(v ?? ""))}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
              commitDraft();
            }}
            isClearable
          />
        </TableRowGroup>

        <TableRowGroup title="What to compress">
          <TableSwitchRow
            label="Videos"
            value={!!storage.compressVideos}
            onValueChange={(v: boolean) => {
              if (storage.compressVideos !== v) storage.compressVideos = v;
            }}
          />
          <TableSwitchRow
            label="Images"
            value={!!storage.compressImages}
            onValueChange={(v: boolean) => {
              if (storage.compressImages !== v) storage.compressImages = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="When Discord still rejects it">
          <TableSwitchRow
            label="External link fallback"
            subLabel="If it won't shrink under the limit, upload to Litterbox/Catbox and send the link (recommended)"
            value={!!storage.fallbackExternal}
            onValueChange={(v: boolean) => {
              if (storage.fallbackExternal !== v) storage.fallbackExternal = v;
            }}
          />
          <TableSwitchRow
            label="Use Catbox instead of Litterbox"
            subLabel="Catbox keeps files longer; Litterbox is temporary (12h)"
            value={storage.externalHost === "catbox"}
            onValueChange={(v: boolean) => {
              storage.externalHost = v ? "catbox" : "litterbox";
            }}
          />
          <TableSwitchRow
            label="Block send if still too large"
            subLabel="Only matters when external fallback is off"
            value={!!storage.blockOnFail}
            onValueChange={(v: boolean) => {
              if (storage.blockOnFail !== v) storage.blockOnFail = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Debug">
          <TableSwitchRow
            label="Show toasts"
            value={!!storage.showToasts}
            onValueChange={(v: boolean) => {
              if (storage.showToasts !== v) storage.showToasts = v;
            }}
          />
          <TableSwitchRow
            label="Debug toasts"
            value={!!storage.debugToasts}
            onValueChange={(v: boolean) => {
              if (storage.debugToasts !== v) storage.debugToasts = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Limits">
          <TableRow
            label="Kettu can't ship FFmpeg"
            subLabel="Discord's native shrink often isn't enough for long videos — external fallback is the reliable path."
          />
        </TableRowGroup>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      <FormSection title="Target size">
        <FormInput
          title="Max size (MB)"
          keyboardType="numeric"
          placeholder="24"
          value={draft}
          onChange={(v: string) => setDraft(String(v ?? ""))}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            commitDraft();
          }}
        />
      </FormSection>
      <FormDivider />
      <FormSection title="Fallback">
        <FormRow
          label="External link fallback"
          trailing={
            <FormSwitch
              value={!!storage.fallbackExternal}
              onValueChange={(v: boolean) => {
                if (storage.fallbackExternal !== v) storage.fallbackExternal = v;
              }}
            />
          }
        />
      </FormSection>
    </ScrollView>
  );
}
