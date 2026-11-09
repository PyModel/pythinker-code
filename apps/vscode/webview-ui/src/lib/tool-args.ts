import type { UIToolCall } from "@/stores/chat.store";

export function parseArgs(args: string | null): Record<string, unknown> {
  if (!args) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { raw: args };
    }
    return parsed as Record<string, unknown>;
  } catch {
    return { raw: args };
  }
}

export function getToolLabel(call: UIToolCall): string {
  const args = parseArgs(call.arguments);
  switch (call.name) {
    case "Shell":
      return (args.command as string) || "command";
    case "ReadFile":
    case "WriteFile":
    case "StrReplaceFile":
      return (args.path as string)?.split("/").pop() || "file";
    case "Glob":
      return (args.pattern as string) || "pattern";
    case "Task":
      return (args.description as string) || "subagent task";
    case "SetTodoList":
      return "Update Todos";
    default:
      return "";
  }
}
