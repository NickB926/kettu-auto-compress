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

function Field({
  TextInput,
  label,
  value,
  onCommit,
  placeholder,
}: {
  TextInput: any;
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState(value);
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <>
      <TextInput
        value={draft}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        onChange={(v: string) => setDraft(String(v ?? ""))}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          onCommit(String(draft ?? "").trim());
        }}
        isClearable
      />
    </>
  );
}

export default function SettingsPanel() {
  React.useEffect(() => {
    ensureSettings();
  }, []);

  useProxy(storage);

  const [draft, setDraft] = React.useState(() => String(storage.maxMB ?? 24));
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

  const useCloudinary = storage.provider === "cloudinary";

  if (Table?.TableRowGroup && TextInputMod?.TextInput) {
    const { TableRowGroup, TableSwitchRow, TableRow } = Table;
    const { TextInput } = TextInputMod;

    return (
      <ScrollView style={{ flex: 1 }}>
        <TableRowGroup title="Target size">
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

        <TableRowGroup title="Provider (for oversized videos)">
          <TableSwitchRow
            label="Use Cloudinary (recommended)"
            subLabel="Compresses remotely, then tries Discord's native video player"
            value={useCloudinary}
            onValueChange={(v: boolean) => {
              storage.provider = v ? "cloudinary" : "catbox";
            }}
          />
          <TableSwitchRow
            label="External fallback enabled"
            value={!!storage.fallbackExternal}
            onValueChange={(v: boolean) => {
              if (storage.fallbackExternal !== v) storage.fallbackExternal = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Cloudinary setup (free)">
          <TableRow
            label="1) cloudinary.com → free account"
            subLabel="2) Settings → Upload → Add upload preset → Signing mode: Unsigned"
          />
          <TableRow
            label="3) In that preset, add Incoming transformation"
            subLabel="e.g. w_720,q_auto:low,f_mp4  (keeps videos under Discord's limit)"
          />
          <TableRow label="Cloud name" />
          <Field
            TextInput={TextInput}
            label="cloud"
            value={String(storage.cloudinaryCloudName ?? "")}
            placeholder="your cloud name"
            onCommit={(v) => {
              storage.cloudinaryCloudName = v;
            }}
          />
          <TableRow label="Unsigned upload preset name" />
          <Field
            TextInput={TextInput}
            label="preset"
            value={String(storage.cloudinaryUploadPreset ?? "")}
            placeholder="discord_compress"
            onCommit={(v) => {
              storage.cloudinaryUploadPreset = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Catbox fallback (link only)">
          <TableRow
            label="Userhash"
            subLabel="Used if Cloudinary fails, or if provider = Catbox"
          />
          <Field
            TextInput={TextInput}
            label="hash"
            value={String(storage.catboxUserhash ?? "")}
            placeholder="catbox userhash"
            onCommit={(v) => {
              storage.catboxUserhash = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Other">
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
          <TableSwitchRow
            label="Debug toasts"
            value={!!storage.debugToasts}
            onValueChange={(v: boolean) => {
              if (storage.debugToasts !== v) storage.debugToasts = v;
            }}
          />
        </TableRowGroup>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      <FormSection title="Cloudinary">
        <FormInput
          title="Cloud name"
          value={String(storage.cloudinaryCloudName ?? "")}
          onChange={(v: string) => {
            storage.cloudinaryCloudName = String(v ?? "");
          }}
        />
        <FormInput
          title="Upload preset"
          value={String(storage.cloudinaryUploadPreset ?? "")}
          onChange={(v: string) => {
            storage.cloudinaryUploadPreset = String(v ?? "");
          }}
        />
        <FormRow
          label="Use Cloudinary"
          trailing={
            <FormSwitch
              value={storage.provider === "cloudinary"}
              onValueChange={(v: boolean) => {
                storage.provider = v ? "cloudinary" : "catbox";
              }}
            />
          }
        />
      </FormSection>
      <FormDivider />
    </ScrollView>
  );
}
