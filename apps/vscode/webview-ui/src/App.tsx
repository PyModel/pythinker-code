// node/vscode_extension/webview-ui/src/App.tsx
import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { ChatArea } from "./components/ChatArea";
import { InputArea } from "./components/inputarea/InputArea";
import { WorkDirModal } from "./components/WorkDirModal";
import { ConfigHub } from "./components/confighub/ConfigHub";
import { MCP_SERVERS_KEY } from "./components/confighub/MCPServersSection";
import { ConfigErrorScreen } from "./components/ConfigErrorScreen";
import { LoginScreen } from "./components/LoginScreen";
import { Toaster, toast } from "./components/ui/sonner";
import { useChatStore, useSettingsStore } from "./stores";
import { bridge, Events } from "./services";
import { useAppInit, resolveAppView } from "./hooks/useAppInit";
import { isPreflightError } from "shared/errors";
import type { UIStreamEvent, StreamError, ExtensionConfig } from "shared/types";
import "./styles/index.css";

function MainContent({ onAuthAction }: { onAuthAction: () => void }) {
  const { processEvent, startNewConversation, sessionId } = useChatStore();
  const { setExtensionConfig, extensionConfig, setWireSlashCommands, setModels, configHub } = useSettingsStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    return bridge.on(Events.StreamEvent, (event: UIStreamEvent) => {
      // Filter only when a session already exists to ensure session_start is handled properly
      if (sessionId && "_sessionId" in event && event._sessionId && event._sessionId !== sessionId) {
        return;
      }
      processEvent(event);
      if (event.type === "error") {
        const streamError = event as StreamError;
        if (isPreflightError(streamError.code || "UNKNOWN")) {
          toast.error(streamError.message);
        }
      }
    });
  }, [processEvent, sessionId]);

  useEffect(() => {
    // Two provider edits in quick succession race: whichever getModels() call
    // resolves last wins, which is not necessarily the newest. Only the latest
    // request is allowed to publish.
    let providersRevision = 0;
    const unsubs = [
      bridge.on(Events.MCPServersChanged, () => void queryClient.invalidateQueries({ queryKey: MCP_SERVERS_KEY })),
      // Provider add/remove only updates the Providers tab's local view; the
      // model list everywhere else comes from the store, so refetch it.
      bridge.on(Events.ProvidersChanged, () => {
        const revision = ++providersRevision;
        void bridge
          .getModels()
          .then((models) => {
            if (revision === providersRevision) setModels(models);
          })
          .catch(() => undefined);
      }),
      bridge.on(Events.SlashCommandsChanged, setWireSlashCommands),
      bridge.on(Events.ExtensionConfigChanged, ({ config }: { config: ExtensionConfig }) => setExtensionConfig(config)),
      bridge.on(Events.FocusInput, () => document.querySelector<HTMLTextAreaElement>("textarea")?.focus()),
      bridge.on(Events.NewConversation, () => {
        void startNewConversation().catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [queryClient, setExtensionConfig, setWireSlashCommands, startNewConversation, setModels]);

  useEffect(() => {
    if (!extensionConfig.enableNewConversationShortcut) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        void startNewConversation().catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [extensionConfig.enableNewConversationShortcut, startNewConversation]);

  return (
    <>
      {configHub.open ? (
        <ConfigHub />
      ) : (
        <>
          <div className="flex-1 min-h-0 relative group/chat">
            <ChatArea />
          </div>
          <div className="shrink-0 max-h-[80vh] flex flex-col min-h-0">
            <InputArea onAuthAction={onAuthAction} />
          </div>
        </>
      )}
      <WorkDirModal />
    </>
  );
}

export default function App() {
  const { status, errorMessage, modelsCount, refresh } = useAppInit();
  const [skippedLogin, setSkippedLogin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const handleLoginSuccess = useCallback(() => {
    setShowLogin(false);
    setSkippedLogin(false);
    refresh();
  }, [refresh]);

  const handleSkip = useCallback(() => {
    setShowLogin(false);
    setSkippedLogin(true);
  }, []);

  const handleShowLogin = useCallback(() => {
    setSkippedLogin(false);
    setShowLogin(true);
  }, []);

  const handleAuthAction = useCallback(() => {
    setSkippedLogin(false);
    setShowLogin(false);
    refresh();
  }, [refresh]);

  const resolution = resolveAppView({ status, modelsCount, skippedLogin, showLogin });

  // Login view: not logged in and not skipped, or user explicitly initiates login
  if (resolution.view === "login") {
    return (
      <div className="flex flex-col h-screen text-foreground overflow-hidden">
        <Header />
        <LoginScreen onLoginSuccess={handleLoginSuccess} onSkip={handleSkip} />
        <Toaster position="top-center" />
      </div>
    );
  }

  // Error and configuration view; no-models must retain an entry point to return to login
  if (resolution.view === "status") {
    return (
      <div className="flex flex-col h-screen text-foreground overflow-hidden">
        <Header />
        <ConfigErrorScreen
          type={resolution.status}
          errorMessage={errorMessage}
          onRefresh={refresh}
          onBackToLogin={resolution.canGoToLogin ? handleShowLogin : undefined}
        />
        <Toaster position="top-center" />
      </div>
    );
  }

  // Normal state
  return (
    <div className="flex flex-col h-screen text-foreground overflow-hidden">
      <Header />
      <MainContent onAuthAction={handleAuthAction} />
      <Toaster position="top-center" />
    </div>
  );
}
