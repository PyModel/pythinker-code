import {
  SECONDARY_DERIVED_MODEL_ALIAS,
  effectiveModelAlias,
  type ExpertTalkStatusV1,
  type ModelAlias,
  type Session,
} from '@pymodel/pythinker-code-sdk';

import { ChoicePickerComponent, type ChoiceOption } from '../components/dialogs/choice-picker';
import { TabbedModelSelectorComponent } from '../components/dialogs/tabbed-model-selector';
import {
  ExpertTalkExchangeComponent,
  ExpertTalkPanelComponent,
  isExpertTalkRunTerminal,
  isExpertTalkRunWaiting,
} from '../components/messages/expert-talk-panel';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

const DISCLOSURE =
  '2–4 model stages, at most 56 provider attempts. Architect review and Fusion run only when selected. Only read-only tools are available.';

interface ExpertTalkWatcher {
  readonly runId: string;
  readonly panel: ExpertTalkPanelComponent;
  timer?: ReturnType<typeof setTimeout>;
}

const watchers = new WeakMap<SlashCommandHost, ExpertTalkWatcher>();

export async function handleExpertTalkCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (!host.engineV2) {
    host.showError('Discussion requires the v2 engine.');
    return;
  }
  const session = host.session ?? (await host.ensureSession());
  if (session === undefined) return;

  const action = args.trim().toLowerCase();
  const status = await session.getExpertTalkStatus();
  if (!status.enabled) {
    host.showNotice(
      'Discussion is disabled',
      'Set PYTHINKER_CODE_EXPERIMENTAL_EXPERT_TALK=1 and restart Pythinker Code.',
    );
    return;
  }

  if (action === '' || action === 'menu' || action === 'help') {
    showExpertTalkMenu(host, session, status);
    return;
  }
  if (action === 'status') {
    showExpertTalkStatus(host, status);
    return;
  }
  if (action === 'configure' || action === 'models') {
    showPairPicker(host, session, status);
    return;
  }
  if (action === 'arm') {
    await armExpertTalk(host, session, status);
    return;
  }
  if (action === 'disarm') {
    await disarmExpertTalk(host, session, status);
    return;
  }
  if (action === 'cancel' || action === 'stop') {
    await cancelExpertTalk(host, session, status);
    return;
  }
  if (action === 'retry') {
    await retryExpertTalk(host, session, status);
    return;
  }
  if (action === 'review') {
    await runExpertTalkStage(host, session, status, 'review');
    return;
  }
  if (action === 'finish') {
    await runExpertTalkStage(host, session, status, 'finish');
    return;
  }
  if (action === 'fuse' || action === 'fusion') {
    await runExpertTalkStage(host, session, status, 'fuse');
    return;
  }
  if (action === 'exchange') {
    showExpertTalkExchange(host, status);
    return;
  }
  if (action === 'clear' || action === 'reset') {
    await session.clearExpertTalk(status.config.resourceVersion);
    host.setAppState({ expertTalkArmId: undefined, expertTalkRunId: undefined });
    host.showStatus('Discussion model pair cleared.');
    return;
  }
  host.showError(
    'Usage: /discussion [help|status|configure|arm|disarm|review|finish|fuse|cancel|retry|exchange|reset]',
  );
}

export async function handleExpertTalkPromptAccepted(
  host: SlashCommandHost,
  session: Session,
  armId: string,
): Promise<void> {
  const status = await session.getExpertTalkStatus();
  if (host.state.appState.expertTalkArmId === armId) {
    host.setAppState({ expertTalkArmId: undefined });
  }
  const run = status.activeRun ?? status.latestRun;
  if (run === undefined) return;
  host.setAppState({ expertTalkRunId: run.runId });
  const panel = new ExpertTalkPanelComponent(status, host.state.appState.availableModels);
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
  startWatcher(host, session, run.runId, panel);
}

function showExpertTalkMenu(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
): void {
  const options: ChoiceOption[] = [];
  if (status.activeRun !== undefined) {
    options.push({ value: 'status', label: 'View progress' });
    if (status.activeRun.status === 'OPINIONS_READY') {
      options.push({ value: 'review', label: 'Architect review Builder' });
      options.push({ value: 'finish', label: 'Finish with Architect' });
      options.push({ value: 'fuse', label: 'Fuse now' });
    } else if (status.activeRun.status === 'REVIEW_READY') {
      options.push({ value: 'finish', label: 'Finish with Architect review' });
      options.push({ value: 'fuse', label: 'Fuse now' });
    }
    options.push({ value: 'cancel', label: 'Stop run', tone: 'danger' });
  } else if (status.arm !== undefined) {
    options.push({ value: 'status', label: 'View armed pair' });
    options.push({ value: 'disarm', label: 'Disarm next message' });
  } else {
    if (status.config.pair !== undefined) {
      options.push({ value: 'arm', label: 'Use for next message' });
    }
    options.push({
      value: 'configure',
      label: status.config.pair === undefined ? 'Select model pair' : 'Change model pair',
    });
    if (status.latestRun?.error?.retryable === true) {
      options.push({ value: 'retry', label: 'Retry last run' });
    }
  }
  if (status.latestRun !== undefined) {
    options.push({ value: 'exchange', label: 'View exchange' });
  }

  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Discussion',
      hint: '↑↓ navigate · Enter select · Esc cancel',
      notice: DISCLOSURE,
      noticeTone: 'warning',
      options,
      onSelect: (value) => {
        host.restoreEditor();
        void runMenuAction(host, session, status, value);
      },
      onCancel: () => host.restoreEditor(),
    }),
  );
}

async function runMenuAction(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
  action: string,
): Promise<void> {
  try {
    if (action === 'status') showExpertTalkStatus(host, status);
    else if (action === 'configure') showPairPicker(host, session, status);
    else if (action === 'arm') await armExpertTalk(host, session, status);
    else if (action === 'disarm') await disarmExpertTalk(host, session, status);
    else if (action === 'cancel') await cancelExpertTalk(host, session, status);
    else if (action === 'retry') await retryExpertTalk(host, session, status);
    else if (action === 'review') await runExpertTalkStage(host, session, status, 'review');
    else if (action === 'finish') await runExpertTalkStage(host, session, status, 'finish');
    else if (action === 'fuse') await runExpertTalkStage(host, session, status, 'fuse');
    else if (action === 'exchange') showExpertTalkExchange(host, status);
  } catch (error) {
    host.showError(`Discussion: ${formatErrorMessage(error)}`);
  }
}

function eligibleModels(host: SlashCommandHost): Record<string, ModelAlias> {
  return Object.fromEntries(
    Object.entries(host.state.appState.availableModels)
      .filter(([alias]) => alias !== SECONDARY_DERIVED_MODEL_ALIAS)
      .map(([alias, model]) => [alias, effectiveModelAlias(model)] as const)
      .filter(([, model]) =>
        model.maxContextSize > 0 &&
        (model.capabilities ?? []).some(
          (capability) => capability.trim().toLowerCase().replaceAll('-', '_') === 'tool_use',
        ),
      ),
  );
}

function showPairPicker(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
): void {
  const models = eligibleModels(host);
  const aliases = Object.keys(models);
  if (aliases.length < 2) {
    host.showNotice(
      'Two eligible models required',
      'Configure two distinct text models with tool_use and a positive context limit.',
    );
    return;
  }
  const currentLead = status.config.pair?.fusionLeadModelId;
  const selectedLead = currentLead !== undefined && models[currentLead] !== undefined
    ? currentLead
    : aliases[0]!;
  host.mountEditorReplacement(
    new TabbedModelSelectorComponent({
      models,
      currentValue: selectedLead,
      selectedValue: selectedLead,
      currentThinkingEffort: 'off',
      title: ' Select Architect',
      warning: DISCLOSURE,
      thinkingControl: false,
      onSelect: ({ alias }) => {
        host.restoreEditor();
        showPeerPicker(host, session, status, models, alias);
      },
      onCancel: () => host.restoreEditor(),
    }),
  );
}

function showPeerPicker(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
  models: Record<string, ModelAlias>,
  lead: string,
): void {
  const peers = Object.fromEntries(Object.entries(models).filter(([alias]) => alias !== lead));
  const aliases = Object.keys(peers);
  const configured = status.config.pair?.peerModelId;
  const selected = configured !== undefined && peers[configured] !== undefined
    ? configured
    : aliases[0]!;
  host.mountEditorReplacement(
    new TabbedModelSelectorComponent({
      models: peers,
      currentValue: selected,
      selectedValue: selected,
      currentThinkingEffort: 'off',
      title: ' Select Builder',
      warning: `Architect: ${lead}`,
      thinkingControl: false,
      onSelect: ({ alias }) => {
        host.restoreEditor();
        void configureAndArm(host, session, status, lead, alias);
      },
      onCancel: () => host.restoreEditor(),
    }),
  );
}

async function configureAndArm(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
  lead: string,
  peer: string,
): Promise<void> {
  try {
    const config = await session.configureExpertTalk(
      { fusionLeadModelId: lead, peerModelId: peer },
      status.config.resourceVersion,
    );
    const arm = await session.armExpertTalk(config.resourceVersion);
    host.setAppState({ expertTalkArmId: arm.armId, expertTalkRunId: undefined });
    host.showNotice('Discussion armed', `${lead} ↔ ${peer} · send the next message`);
  } catch (error) {
    host.showError(`Discussion: ${formatErrorMessage(error)}`);
  }
}

async function armExpertTalk(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
): Promise<void> {
  if (status.config.pair === undefined) {
    showPairPicker(host, session, status);
    return;
  }
  const arm = await session.armExpertTalk(status.config.resourceVersion);
  host.setAppState({ expertTalkArmId: arm.armId, expertTalkRunId: undefined });
  host.showNotice('Discussion armed', 'Send the next message to start the exchange.');
}

async function disarmExpertTalk(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
): Promise<void> {
  const armId = status.arm?.armId ?? host.state.appState.expertTalkArmId;
  if (armId === undefined) {
    host.showStatus('Discussion is not armed.');
    return;
  }
  await session.disarmExpertTalk(armId);
  host.setAppState({ expertTalkArmId: undefined });
  host.showStatus('Discussion disarmed.');
}

async function cancelExpertTalk(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
): Promise<void> {
  const run = status.activeRun;
  if (run === undefined) {
    host.showStatus('No Discussion run is active.');
    return;
  }
  const cancelled = await session.cancelExpertTalkRun(run.runId);
  host.setAppState({ expertTalkRunId: undefined });
  updateWatcher(host, { ...status, activeRun: undefined, latestRun: cancelled });
}

async function retryExpertTalk(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
): Promise<void> {
  const run = status.latestRun;
  if (run === undefined || run.error?.retryable !== true) {
    host.showStatus('No retryable Discussion run is available.');
    return;
  }
  const started = await session.retryExpertTalkRun(run.runId);
  const next = await session.getExpertTalkStatus();
  const active = next.activeRun;
  if (active === undefined || active.runId !== started.runId) return;
  host.setAppState({ expertTalkRunId: active.runId });
  const panel = new ExpertTalkPanelComponent(next, host.state.appState.availableModels);
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
  startWatcher(host, session, active.runId, panel);
}

async function runExpertTalkStage(
  host: SlashCommandHost,
  session: Session,
  status: ExpertTalkStatusV1,
  stage: 'review' | 'finish' | 'fuse',
): Promise<void> {
  const run = status.activeRun;
  if (run === undefined) {
    host.showStatus('No Discussion run is waiting.');
    return;
  }
  if (stage === 'review') await session.reviewExpertTalkRun(run.runId);
  else if (stage === 'finish') await session.finishExpertTalkRun(run.runId);
  else await session.fuseExpertTalkRun(run.runId);
  const next = await session.getExpertTalkStatus();
  const panel = watchers.get(host)?.panel
    ?? new ExpertTalkPanelComponent(next, host.state.appState.availableModels);
  if (watchers.get(host) === undefined) {
    host.state.transcriptContainer.addChild(panel);
  }
  host.setAppState({ expertTalkRunId: run.runId });
  panel.update(next);
  host.state.ui.requestRender();
  startWatcher(host, session, run.runId, panel);
}

function showExpertTalkStatus(host: SlashCommandHost, status: ExpertTalkStatusV1): void {
  host.state.transcriptContainer.addChild(
    new ExpertTalkPanelComponent(status, host.state.appState.availableModels),
  );
  host.state.ui.requestRender();
}

function showExpertTalkExchange(host: SlashCommandHost, status: ExpertTalkStatusV1): void {
  const run = status.activeRun ?? status.latestRun;
  if (run === undefined) {
    host.showStatus('No Discussion exchange is available.');
    return;
  }
  host.state.transcriptContainer.addChild(
    new ExpertTalkExchangeComponent(run, host.state.appState.availableModels),
  );
  host.state.ui.requestRender();
}

function startWatcher(
  host: SlashCommandHost,
  session: Session,
  runId: string,
  panel: ExpertTalkPanelComponent,
): void {
  const prior = watchers.get(host);
  if (prior?.timer !== undefined) clearTimeout(prior.timer);
  const watcher: ExpertTalkWatcher = { runId, panel };
  watchers.set(host, watcher);
  schedulePoll(host, session, watcher);
}

function schedulePoll(
  host: SlashCommandHost,
  session: Session,
  watcher: ExpertTalkWatcher,
): void {
  watcher.timer = setTimeout(() => {
    void session
      .getExpertTalkStatus()
      .then((status) => {
        if (watchers.get(host) !== watcher) return;
        updateWatcher(host, status);
        const run = status.activeRun ?? status.latestRun;
        if (run?.runId === watcher.runId && isExpertTalkRunWaiting(run)) {
          watcher.timer = undefined;
          return;
        }
        if (run?.runId === watcher.runId && !isExpertTalkRunTerminal(run)) {
          schedulePoll(host, session, watcher);
          return;
        }
        watchers.delete(host);
        host.setAppState({ expertTalkRunId: undefined });
      })
      .catch((error: unknown) => {
        if (watchers.get(host) !== watcher) return;
        watchers.delete(host);
        host.setAppState({ expertTalkRunId: undefined });
        host.showError(`Discussion status: ${formatErrorMessage(error)}`);
      });
  }, 500);
  watcher.timer.unref?.();
}

function updateWatcher(host: SlashCommandHost, status: ExpertTalkStatusV1): void {
  const watcher = watchers.get(host);
  watcher?.panel.update(status);
  host.state.ui.requestRender();
}
