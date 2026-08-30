import type {
  ExpertTalkRunV1,
  ExpertTalkStageArtifactV1,
  ExpertTalkStageProgressV1,
  ExpertTalkStatusV1,
  ModelAlias,
} from '@pymodel/pythinker-code-sdk';
import { Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@pymodel/pi-tui';

import { currentTheme } from '#/tui/theme';
import { createMarkdownTheme } from '#/tui/theme/pi-tui-theme';
import { createMarkdownOptions } from '#/tui/utils/markdown-options';
import { formatTokenCount } from '#/utils/usage/usage-format';

import { modelDisplayName } from '../dialogs/model-selector';
import { UsagePanelComponent } from './usage-panel';

type PhaseState = 'pending' | 'running' | 'completed' | 'failed' | 'unavailable';
type ArtifactState = PhaseState;

const GRID_GUTTER_WIDTH = 3;
const MIN_AGENT_COLUMN_WIDTH = 34;

const TERMINAL_RUN_STATUSES = new Set([
  'COMPLETED',
  'CANCELLED',
  'FAILED_OPENING',
  'FAILED_REVIEW',
  'FAILED_FUSION',
  'INTERRUPTED',
]);

export function isExpertTalkRunTerminal(run: ExpertTalkRunV1): boolean {
  return TERMINAL_RUN_STATUSES.has(run.status);
}

export function isExpertTalkRunWaiting(run: ExpertTalkRunV1): boolean {
  return run.status === 'OPINIONS_READY' || run.status === 'REVIEW_READY';
}

function displayModel(id: string, models: Record<string, ModelAlias>): string {
  return modelDisplayName(id, models[id]);
}

function phaseState(
  states: readonly ArtifactState[],
  running: boolean,
): PhaseState {
  if (running) return 'running';
  if (states.some((state) => state === 'failed')) return 'failed';
  if (states.length > 0 && states.every((state) => state === 'unavailable')) {
    return 'unavailable';
  }
  if (
    states.length > 0 &&
    states.every((state) => state === 'completed' || state === 'unavailable')
  ) {
    return 'completed';
  }
  return 'pending';
}

function phaseLine(label: string, state: PhaseState): string {
  if (state === 'completed') return currentTheme.fg('success', `✓ ${label}`);
  if (state === 'failed') return currentTheme.fg('error', `✗ ${label}`);
  if (state === 'running') return currentTheme.fg('primary', `◐ ${label}`);
  if (state === 'unavailable') return currentTheme.fg('textMuted', `– ${label}`);
  return currentTheme.fg('textMuted', `○ ${label}`);
}

export function buildExpertTalkStatusLines(
  status: ExpertTalkStatusV1,
  models: Record<string, ModelAlias>,
): readonly string[] {
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textMuted', text);
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const run = status.activeRun ?? status.latestRun;
  const configured = status.config.pair;
  const leadId = run?.bindings[0].effectiveModelId ?? configured?.fusionLeadModelId;
  const peerId = run?.bindings[1].effectiveModelId ?? configured?.peerModelId;
  const lines: string[] = [];

  if (leadId !== undefined && peerId !== undefined) {
    lines.push(
      `${muted('Architect')} ${value(displayModel(leadId, models))} ${accent('↔')} ${muted('Builder')} ${value(displayModel(peerId, models))}`,
    );
  } else {
    lines.push(muted('No model pair configured.'));
  }

  if (status.arm !== undefined) lines.push(currentTheme.fg('primary', 'Armed for the next message'));
  if (status.pairValidation.state !== 'valid' && status.pairValidation.reason !== undefined) {
    lines.push(currentTheme.fg('error', status.pairValidation.reason));
  }

  if (run !== undefined) {
    lines.push(
      '',
      phaseLine(
        'Independent opinions',
        phaseState(
          [
            artifactState(run, 'opening', run.artifacts.leadOpening),
            artifactState(run, 'opening', run.artifacts.peerOpening),
          ],
          run.status === 'OPENING',
        ),
      ),
      phaseLine(
        'Architect reviews Builder',
        phaseState(
          [artifactState(run, 'review', run.artifacts.leadReview)],
          run.status === 'REVIEWING',
        ),
      ),
      phaseLine(
        'Fusion',
        phaseState(
          [artifactState(run, 'fusion', run.artifacts.fusion)],
          run.status === 'FUSING',
        ),
      ),
    );
    if (run.error !== undefined) {
      lines.push('', currentTheme.fg('error', run.error.message), muted(run.error.action));
    }
  }

  lines.push(
    '',
    muted('2–4 model stages · at most 56 provider attempts'),
    muted('Architect review and Fusion are optional · read-only tools'),
  );
  return lines;
}

function artifactState(
  run: ExpertTalkRunV1,
  stage: 'opening' | 'review' | 'fusion',
  artifact: ExpertTalkStageArtifactV1 | undefined,
): ArtifactState {
  if (artifact !== undefined) return artifact.status;
  const current = run.status === 'PREPARING'
    ? 0
    : run.status === 'OPENING'
      ? 1
      : run.status === 'OPINIONS_READY'
        ? 1
      : run.status === 'REVIEWING'
        ? 2
        : run.status === 'REVIEW_READY'
          ? 2
        : run.status === 'FUSING'
          ? 3
          : 4;
  const target = stage === 'opening' ? 1 : stage === 'review' ? 2 : 3;
  if (current < target) return 'pending';
  if (current === target) return 'running';
  return 'unavailable';
}

function stateLabel(label: string, state: ArtifactState): string {
  if (state === 'completed') return currentTheme.fg('success', `✓ ${label}`);
  if (state === 'failed') return currentTheme.fg('error', `✗ ${label}`);
  if (state === 'running') return currentTheme.fg('primary', `◐ ${label}`);
  if (state === 'unavailable') return currentTheme.fg('warning', `⊘ ${label}`);
  return currentTheme.fg('textMuted', `○ ${label}`);
}

function usageInput(artifact: ExpertTalkStageArtifactV1): number {
  const usage = artifact.usage;
  if (usage === undefined) return 0;
  return usage.inputOther + usage.inputCacheRead + usage.inputCacheCreation;
}

function elapsedSeconds(artifact: ExpertTalkStageArtifactV1): number | undefined {
  if (artifact.startedAt === undefined || artifact.endedAt === undefined) return undefined;
  const startedAt = Date.parse(artifact.startedAt);
  const endedAt = Date.parse(artifact.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return undefined;
  }
  return (endedAt - startedAt) / 1000;
}

function artifactMetrics(artifact: ExpertTalkStageArtifactV1 | undefined): string | undefined {
  if (artifact === undefined) return undefined;
  const metrics: string[] = [];
  const seconds = elapsedSeconds(artifact);
  if (seconds !== undefined) {
    metrics.push(`TIME ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`);
  }
  if (artifact.usage !== undefined) {
    metrics.push(
      `TOKENS IN ${formatTokenCount(usageInput(artifact))}`,
      `OUT ${formatTokenCount(artifact.usage.output)}`,
    );
    if (seconds !== undefined && seconds > 0 && artifact.usage.output > 0) {
      metrics.push(`TPS ${Math.round(artifact.usage.output / seconds)}`);
    }
  }
  if (artifact.toolCallCount !== undefined) metrics.push(`TOOLS ${artifact.toolCallCount}`);
  return metrics.length === 0 ? undefined : metrics.join('  ');
}

function renderArtifact(
  run: ExpertTalkRunV1,
  stage: 'opening' | 'review' | 'fusion',
  label: string,
  artifact: ExpertTalkStageArtifactV1 | undefined,
  progress: ExpertTalkStageProgressV1 | undefined,
  width: number,
): string[] {
  const state = artifactState(run, stage, artifact);
  const lines = [stateLabel(label, state)];
  const metrics = artifactMetrics(artifact);
  if (metrics !== undefined) {
    lines.push(...wrapTextWithAnsi(currentTheme.fg('textDim', metrics), Math.max(1, width)));
  }
  if (progress?.thinking !== undefined && progress.thinking.length > 0) {
    lines.push(
      ...wrapTextWithAnsi(
        currentTheme.italicFg('textDim', `▹ ${progress.thinking}`),
        Math.max(1, width - 2),
      ).map((line) => `  ${line}`),
    );
  }
  for (const tool of progress?.tools ?? []) {
    lines.push(currentTheme.fg('warning', `  ▸ ${tool.name ?? 'Tool'}`));
  }
  const text = artifact?.text ?? progress?.text;
  if (text !== undefined && text.trim().length > 0) {
    lines.push(
      ...new Markdown(
        text.trim(),
        0,
        0,
        createMarkdownTheme({ transient: state === 'running' }),
        undefined,
        createMarkdownOptions(),
      ).render(Math.max(1, width - 2)).map((line) => `  ${line}`),
    );
  }
  if (artifact?.error !== undefined) {
    lines.push(
      ...wrapTextWithAnsi(
        currentTheme.fg('error', artifact.error),
        Math.max(1, width - 2),
      ).map((line) => `  ${line}`),
    );
  } else if (text === undefined || text.trim().length === 0) {
    lines.push(`  ${currentTheme.fg('textDim', state)}`);
  }
  return lines;
}

function renderModelColumn(
  run: ExpertTalkRunV1,
  role: 'Architect' | 'Builder',
  model: string,
  width: number,
): string[] {
  const model1 = role === 'Architect';
  const symbol = currentTheme.fg(model1 ? 'primary' : 'warning', model1 ? '◆' : '▲');
  const opening = model1 ? run.artifacts.leadOpening : run.artifacts.peerOpening;
  const progress = model1 ? run.progress?.leadOpening : run.progress?.peerOpening;
  return [
    `${symbol} ${currentTheme.boldFg('text', role)} ${currentTheme.fg('textDim', `| ${model}`)}`,
    ...renderArtifact(run, 'opening', 'Independent analysis', opening, progress, width),
  ];
}

function fitColumnLine(line: string, width: number): string {
  const clipped = truncateToWidth(line, width, '…');
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
}

function renderAgentGrid(left: string[], right: string[], width: number): string[] {
  const columnWidth = Math.floor((width - GRID_GUTTER_WIDTH) / 2);
  if (columnWidth < MIN_AGENT_COLUMN_WIDTH) return [...left, '', ...right];
  const gutter = currentTheme.fg('textMuted', ' │ ');
  const height = Math.max(left.length, right.length);
  return Array.from({ length: height }, (_, index) =>
    `${fitColumnLine(left[index] ?? '', columnWidth)}${gutter}${fitColumnLine(right[index] ?? '', columnWidth)}`,
  );
}

export function buildExpertTalkExchangeLines(
  run: ExpertTalkRunV1,
  models: Record<string, ModelAlias>,
  width = 120,
): readonly string[] {
  const safeWidth = Math.max(1, width);
  const lead = displayModel(run.bindings[0].effectiveModelId, models);
  const peer = displayModel(run.bindings[1].effectiveModelId, models);
  const columnWidth = Math.floor((safeWidth - GRID_GUTTER_WIDTH) / 2);
  const grid = columnWidth < MIN_AGENT_COLUMN_WIDTH
    ? renderAgentGrid(
        renderModelColumn(run, 'Architect', lead, safeWidth),
        renderModelColumn(run, 'Builder', peer, safeWidth),
        safeWidth,
      )
    : renderAgentGrid(
        renderModelColumn(run, 'Architect', lead, columnWidth),
        renderModelColumn(run, 'Builder', peer, columnWidth),
        safeWidth,
      );
  const review = run.artifacts.leadReview;
  const showReview = review !== undefined || [
    'REVIEWING',
    'REVIEW_READY',
    'FAILED_REVIEW',
  ].includes(run.status);
  const fusion = run.artifacts.fusion;
  const showFusion = fusion !== undefined || run.status === 'FUSING' || isExpertTalkRunTerminal(run);
  const lines = [
    currentTheme.boldFg('primary', '◆ OPINIONS — SELECTED MODELS'),
    ...grid,
  ];
  if (run.status === 'OPINIONS_READY') {
    lines.push(
      '',
      currentTheme.fg('primary', 'NEXT  /discussion finish  ·  /discussion review  ·  /discussion fuse'),
    );
  }
  if (showReview) {
    lines.push(
      '',
      `${currentTheme.fg('primary', '◆')} ${currentTheme.boldFg('text', 'ARCHITECT REVIEW OF BUILDER')} ${currentTheme.fg('textDim', `| ${lead}`)}`,
      ...renderArtifact(
        run,
        'review',
        'Architect reviews Builder',
        review,
        run.progress?.leadReview,
        safeWidth,
      ),
    );
  }
  if (run.status === 'REVIEW_READY') {
    lines.push('', currentTheme.fg('primary', 'NEXT  /discussion finish  ·  /discussion fuse'));
  }
  if (showFusion) {
    lines.push(
      '',
      `${currentTheme.fg('success', '⧉')} ${currentTheme.boldFg('text', 'FUSION')} ${currentTheme.fg('textDim', `| ${lead} · fresh Architect inference`)}`,
      ...renderArtifact(run, 'fusion', 'Critical fusion', fusion, run.progress?.fusion, safeWidth),
    );
  }
  return lines.map((line) => truncateToWidth(line, safeWidth, '…'));
}

export class ExpertTalkExchangeComponent implements Component {
  constructor(
    private readonly run: ExpertTalkRunV1,
    private readonly models: Record<string, ModelAlias>,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    return [...buildExpertTalkExchangeLines(this.run, this.models, width)];
  }
}

export class ExpertTalkPanelComponent extends UsagePanelComponent {
  private readonly holder: { status: ExpertTalkStatusV1 };

  constructor(
    status: ExpertTalkStatusV1,
    private readonly models: Record<string, ModelAlias>,
  ) {
    const holder = { status };
    super(() => buildExpertTalkStatusLines(holder.status, models), 'primary', ' Discussion ');
    this.holder = holder;
  }

  override render(width: number): string[] {
    const statusLines = super.render(width);
    const run = this.holder.status.activeRun ?? this.holder.status.latestRun;
    if (run === undefined) return statusLines;
    return [...statusLines, '', ...buildExpertTalkExchangeLines(run, this.models, width)];
  }

  update(status: ExpertTalkStatusV1): void {
    this.holder.status = status;
    this.invalidate();
  }
}
