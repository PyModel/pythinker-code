import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { toast } from "@/components/ui/sonner";
import type { ExtensionConfig } from "shared/types";

interface SettingRow {
  key: keyof Omit<ExtensionConfig, "version">;
  label: string;
  description: string;
  disabled?: (config: ExtensionConfig) => boolean;
}

const SETTING_ROWS: SettingRow[] = [
  {
    key: "yoloMode",
    label: "YOLO mode",
    description: "Auto-approve regular tool calls; the agent may still ask questions. Also starts new sessions in this mode.",
  },
  {
    key: "autosave",
    label: "Autosave",
    description: "Automatically save files before Pythinker reads or writes them.",
  },
  {
    key: "useCtrlEnterToSend",
    label: "Ctrl/Cmd+Enter to send",
    description: "Use Ctrl/Cmd+Enter to send prompts instead of Enter.",
  },
  {
    key: "enableNewConversationShortcut",
    label: "New conversation shortcut",
    description: "Use Cmd/Ctrl+N to start a new conversation when Pythinker is focused.",
  },
  {
    key: "showThinkingContent",
    label: "Show thinking content",
    description: "Show thinking/reasoning content in the chat UI.",
  },
  {
    key: "showThinkingExpanded",
    label: "Expand thinking by default",
    description: "Auto-expand thinking/reasoning sections when shown.",
    disabled: (config) => !config.showThinkingContent,
  },
];

export function SettingsSection() {
  const { extensionConfig, setExtensionConfig } = useSettingsStore();

  const handleToggle = (key: SettingRow["key"], value: boolean) => {
    const previous = extensionConfig;
    setExtensionConfig({ ...extensionConfig, [key]: value });
    void bridge.saveExtensionConfig({ [key]: value }).catch((error: unknown) => {
      setExtensionConfig(previous);
      toast.error(`Failed to save setting: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  return (
    <div className="space-y-4 max-w-md">
      <h2 className="text-xs font-medium">Settings</h2>
      {SETTING_ROWS.map((row) => {
        const isDisabled = row.disabled?.(extensionConfig) ?? false;
        return (
          <div key={row.key} className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor={`setting-${row.key}`} className="text-xs font-medium">
                {row.label}
              </Label>
              <p className="text-[11px] text-muted-foreground leading-4">{row.description}</p>
            </div>
            <Switch
              id={`setting-${row.key}`}
              checked={extensionConfig[row.key]}
              disabled={isDisabled}
              onCheckedChange={(checked) => handleToggle(row.key, checked)}
              className="mt-0.5 shrink-0"
            />
          </div>
        );
      })}
    </div>
  );
}
