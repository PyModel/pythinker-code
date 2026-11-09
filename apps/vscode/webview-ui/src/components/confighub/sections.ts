import {
  IconAdjustmentsHorizontal,
  IconCpu,
  IconFileCode,
  IconLayoutGrid,
  IconPlug,
  IconServer,
} from "@tabler/icons-react";
import type { ConfigHubSection } from "@/stores/settings.store";

export interface SectionDef {
  id: ConfigHubSection;
  label: string;
  icon: typeof IconLayoutGrid;
}

export const SECTIONS: SectionDef[] = [
  { id: "overview", label: "Overview", icon: IconLayoutGrid },
  { id: "models", label: "Models", icon: IconCpu },
  { id: "providers", label: "Providers", icon: IconPlug },
  { id: "mcp", label: "MCP Servers", icon: IconServer },
  { id: "config", label: "Config File", icon: IconFileCode },
  { id: "settings", label: "Settings", icon: IconAdjustmentsHorizontal },
];
