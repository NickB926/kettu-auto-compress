import { React, ReactNative } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

import { ensureSettings } from "./config";

const ScrollView =
  ReactNative?.ScrollView ??
  findByProps("ScrollView")?.ScrollView ??
  ReactNative.View;

const Table = findByProps("TableSwitchRow", "TableRowGroup", "TableRow");
const TextInputMod = findByProps("TextInput");
const { FormSection, FormInput, FormSwitch, FormRow, FormDivider } =
  Forms ?? {};

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

  const [draft, setDraft] = React.useState(() => String(storage.maxMB ?? 20));
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (focused.current) return;
    setDraft(String(storage.maxMB ?? 20));
  }, [storage.maxMB]);

  const commitDraft = () => {
    const n = parseMB(draft);
    if (n == null) {
      setDraft(String(storage.maxMB ?? 20));
      return;
    }
    if (storage.maxMB !== n) storage.maxMB = n;
    setDraft(String(n));
  };

  if (Table?.TableRowGroup && TextInputMod?.TextInput) {
    const { TableRowGroup, TableSwitchRow } = Table;
    const { TextInput } = TextInputMod;

    return (
      <ScrollView style={{ flex: 1 }}>
        <TableRowGroup title="Target size (MB)">
          <TextInput
            value={draft}
            placeholder="20"
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

        <TableRowGroup title="Oversized videos">
          <TableSwitchRow
            label="ezgif compress"
            subLabel="Compress via ezgif.com then send to Discord (no account)"
            value={storage.fallbackExternal !== false}
            onValueChange={(v: boolean) => {
              if (storage.fallbackExternal !== v) storage.fallbackExternal = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Also compress">
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
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      <FormSection title="AutoCompress">
        <FormInput
          title="Max MB"
          value={String(storage.maxMB ?? 20)}
          onChange={(v: string) => {
            const n = parseMB(String(v ?? ""));
            if (n != null) storage.maxMB = n;
          }}
        />
        <FormRow
          label="ezgif compress"
          trailing={
            <FormSwitch
              value={storage.fallbackExternal !== false}
              onValueChange={(v: boolean) => {
                storage.fallbackExternal = v;
              }}
            />
          }
        />
      </FormSection>
      <FormDivider />
    </ScrollView>
  );
}
