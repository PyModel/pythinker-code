<!-- apps/pythinker-web/src/components/chat/Composer.vue -->
<script setup lang="ts">
import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import SlashMenu from './SlashMenu.vue';
import MentionMenu from './MentionMenu.vue';
import { buildSlashItems, parseSlash, SKILL_COMMAND_PREFIX } from '../../lib/slashCommands';
import { formatTokens } from '../../lib/formatTokens';
import type { FileItem } from './MentionMenu.vue';
import type { ActivationBadges, ConversationStatus, PermissionMode, QueuedPromptView } from '../../types';
import type { AppGoal, AppModel, AppSkill, ThinkingLevel } from '../../api/types';
import {
  commitLevel,
  effectiveThinkingLevel,
  effortLabel,
  modelThinkingAvailability,
  segmentsFor,
} from '../../lib/modelThinking';
import { useInputHistory } from '../../composables/useInputHistory';
import { useSlashMenu } from '../../composables/useSlashMenu';
import { useMentionMenu } from '../../composables/useMentionMenu';
import { useComposerDraft } from '../../composables/useComposerDraft';
import { useAttachmentUpload, type Attachment } from '../../composables/useAttachmentUpload';
import { useIsMobile } from '../../composables/useIsMobile';
import { openFileAttachment } from '../../lib/openFileAttachment';
import type { IconName } from '../../lib/icons';
import type { PromptAttachment } from '../../composables/usePythinkerWebClient';
import Spinner from '../ui/Spinner.vue';
import IconButton from '../ui/IconButton.vue';
import Icon from '../ui/Icon.vue';
import ContextRing from '../ui/ContextRing.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import Tooltip from '../ui/Tooltip.vue';
import Input from '../ui/Input.vue';
import AttachmentChip from './AttachmentChip.vue';
import CapabilityMenu from '../CapabilityMenu.vue';
import BottomSheet from '../dialogs/BottomSheet.vue';
import { useOpenMenu } from '../ui/openMenus';

// ---------------------------------------------------------------------------
// Props & emits
// ---------------------------------------------------------------------------

const props = withDefaults(defineProps<{
  running?: boolean;
  /** True while the empty-composer first prompt is being created + submitted.
   *  Disables the textarea and swaps the send button for a spinner. */
  starting?: boolean;
  /** Active session id — scopes the persisted unsent draft (per session). */
  sessionId?: string;
  queued?: QueuedPromptView[];
  searchFiles?: (q: string) => Promise<FileItem[]>;
  /** If undefined, attach button is hidden and paste/drag are no-ops. */
  uploadImage?: (file: Blob, name?: string) => Promise<{ fileId: string; name: string; mediaType: string } | null>;
  /** Status data (model, context, permission) — drives the bottom toolbar. */
  status?: ConversationStatus;
  thinking?: ThinkingLevel;
  planMode?: boolean;
  planArmed?: boolean;
  working?: boolean;
  goalMode?: boolean;
  workflowActive?: boolean;
  goal?: AppGoal | null;
  activationBadges?: ActivationBadges;
  /** Available models for the quick-switch dropdown. */
  models?: AppModel[];
  /** Starred model ids shown at the top of the quick-switch dropdown. */
  starredIds?: string[];
  /** Session skills shown in the `/` menu (after the built-in commands). */
  skills?: AppSkill[];
  /** Hide the context-usage indicator (used on the empty-session landing page). */
  hideContext?: boolean;
}>(), {
  running: false,
  working: false,
  starting: false,
  queued: () => [],
  searchFiles: undefined,
  uploadImage: undefined,
  models: () => [],
  starredIds: () => [],
  skills: () => [],
  hideContext: false,
});

const placeholder = computed(() =>
  props.starting
    ? t('composer.starting')
    : props.running
      ? t('composer.placeholderRunning')
      : props.goalMode
        ? t('status.goalPlaceholder')
        : props.planArmed || props.planMode
          ? t('status.planPlaceholder')
          : t('composer.placeholder')
);

const emit = defineEmits<{
  submit: [payload: { text: string; attachments: PromptAttachment[] }];
  /** Steer the composer text (+ any queued prompts, merged by the parent)
      into the RUNNING turn — TUI ctrl+s. */
  steer: [payload: { text: string; attachments: PromptAttachment[] }];
  command: [cmd: string];
  interrupt: [];
  setPermission: [mode: PermissionMode];
  setThinking: [level: ThinkingLevel];
  togglePlan: [];
  toggleWorkflow: [];
  toggleGoal: [];
  openBtw: [];
  createGoal: [objective: string];
  controlGoal: [action: 'pause' | 'resume' | 'cancel'];
  focusGoal: [];
  compact: [];
  pickModel: [];
  selectModel: [modelId: string];
}>();

const { t, locale } = useI18n();
const isMobile = useIsMobile();

// ---------------------------------------------------------------------------
// Textarea + per-session draft persistence — see useComposerDraft.
// ---------------------------------------------------------------------------
const { text, textareaRef, autosize, loadForEdit, clearDraft } = useComposerDraft({
  sessionId: () => props.sessionId,
});

function togglePlanMode(): void {
  if (props.planArmed || props.planMode) return;
  if (props.goalMode) emit('toggleGoal');
  emit('togglePlan');
}

function toggleGoalMode(): void {
  if (goalActive.value) {
    emit('focusGoal');
    return;
  }
  if (props.goalMode) return;
  if (props.planArmed || props.planMode) emit('togglePlan');
  emit('toggleGoal');
}

// ---------------------------------------------------------------------------
// Expanded editor — a taller, multi-line composing mode. While expanded, Enter
// inserts a newline instead of sending (send via the button or Cmd/Ctrl+Enter);
// it auto-collapses after a successful send. See handleKeydown / handleSubmit.
// ---------------------------------------------------------------------------
const expanded = ref(false);
function toggleExpand(): void {
  expanded.value = !expanded.value;
  // Re-fit the textarea after the min/max-height swap between modes, then
  // recompute growth against the *post-toggle* resting height. Without this,
  // collapsing would keep the isGrown measured against the expanded 70vh
  // min-height, hiding the toggle even though the collapsed draft is still
  // multi-line. (This does not affect the expanded state itself — once
  // expanded, it stays at 70vh until toggled back or sent.)
  void nextTick(() => {
    autosize();
    recomputeGrown();
    // Return focus to the textarea so the user can keep typing right away;
    // otherwise focus stays on the toggle button and the next Enter would
    // activate it again instead of inserting a newline.
    textareaRef.value?.focus();
  });
}

// Collapse the expanded editor after a successful send/steer and re-fit the
// textarea once the 70vh min-height is gone. On image-only sends the text is
// already empty, so the draft watcher never re-runs autosize — without this,
// the textarea keeps the inline height measured at 70vh and the collapsed cap
// (1/4 viewport) leaves an oversized empty box until the next keystroke.
function collapseAndRefit(): void {
  if (!expanded.value) return;
  expanded.value = false;
  void nextTick(autosize);
}

// The expand toggle is hidden at the resting height and only appears once the
// box has grown past it (multi-line content) — keeps the empty composer
// uncluttered. While expanded it always shows so the user can collapse back.
//
// The resting height equals the textarea's computed `min-height` (set in
// style.css). We read it from the element instead of hard-coding.
const RESTING_HEIGHT_FALLBACK_PX = 36;
function restingHeightPx(el: HTMLTextAreaElement): number {
  if (typeof getComputedStyle === 'undefined') return RESTING_HEIGHT_FALLBACK_PX;
  const min = Number.parseFloat(getComputedStyle(el).minHeight);
  return Number.isFinite(min) && min > 0 ? min : RESTING_HEIGHT_FALLBACK_PX;
}
const isGrown = ref(false);
function recomputeGrown(): void {
  const el = textareaRef.value;
  isGrown.value = !!el && el.scrollHeight > restingHeightPx(el);
}
watch(text, () => {
  // Registered after useComposerDraft's autosize watcher, so the inline height
  // already reflects the latest content when this reads scrollHeight.
  void nextTick(recomputeGrown);
});

// The component instance is reused across session switches (it is not keyed by
// session), so reset the per-session expanded preference when the active
// session changes. Without this, expanding in one chat would leave the next
// session's draft stuck in the tall editor with Enter inserting newlines.
watch(() => props.sessionId, () => {
  expanded.value = false;
  slashOpen.value = false;
  mentionOpen.value = false;
});

// ---------------------------------------------------------------------------
// Sent-message history recall (shell-style ↑/↓). See useInputHistory for the
// implementation; the composer keeps the keydown orchestration (which also
// juggles the slash and mention menus).
// ---------------------------------------------------------------------------
const history = useInputHistory({ text, textareaRef, autosize, sessionId: () => props.sessionId });

// ---------------------------------------------------------------------------
// Slash-command menu — see useSlashMenu for the implementation. The composer
// keeps the keydown orchestration (arrow keys / Enter / Escape) because it also
// juggles the mention menu and history recall.
// ---------------------------------------------------------------------------
const {
  open: slashOpen,
  items: slashItems,
  active: slashActive,
  update: updateSlashMenu,
  select: selectSlashCommand,
} = useSlashMenu({
  text,
  textareaRef,
  autosize,
  skills: () => props.skills,
  emitCommand: (cmd) => {
    if (cmd === '/plan') {
      togglePlanMode();
      return;
    }
    if (cmd === '/goal') {
      toggleGoalMode();
      return;
    }
    emit('command', cmd);
  },
  historyPush: (entry) => history.push(entry),
  clearDraft,
});

// ---------------------------------------------------------------------------
// @-mention menu — see useMentionMenu for the implementation. The composer
// keeps the keydown orchestration because it also juggles the slash menu and
// history recall.
// ---------------------------------------------------------------------------
const {
  open: mentionOpen,
  items: mentionItems,
  active: mentionActive,
  loading: mentionLoading,
  stale: mentionStale,
  update: updateMentionMenu,
  select: selectMentionItem,
  close: closeMentionMenu,
  getMentionToken,
} = useMentionMenu({
  text,
  textareaRef,
  autosize,
  searchFiles: () => props.searchFiles,
});

const slashSheetSearchRef = ref<InstanceType<typeof Input> | null>(null);
const mentionSheetSearchRef = ref<InstanceType<typeof Input> | null>(null);
const mentionSheetToken = ref<{ start: number; end: number } | null>(null);

function placeComposerCaret(position: number): void {
  textareaRef.value?.setSelectionRange(position, position);
}

const slashSheetQuery = computed<string>({
  get: () => text.value.startsWith('/') ? text.value.slice(1) : text.value,
  set: (query) => {
    text.value = `/${query}`;
    void nextTick(() => {
      placeComposerCaret(text.value.length);
      updateSlashMenu();
    });
  },
});

const mentionSheetQuery = computed<string>({
  get: () => {
    const token = mentionSheetToken.value;
    return token ? text.value.slice(token.start + 1, token.end) : '';
  },
  set: (query) => {
    const token = mentionSheetToken.value;
    if (!token) return;
    text.value = `${text.value.slice(0, token.start)}@${query}${text.value.slice(token.end)}`;
    const end = token.start + query.length + 1;
    mentionSheetToken.value = { start: token.start, end };
    void nextTick(() => {
      placeComposerCaret(end);
      updateMentionMenu();
    });
  },
});

watch([slashOpen, isMobile], async ([open, mobile]) => {
  if (!open || !mobile) return;
  await nextTick();
  slashSheetSearchRef.value?.focus();
});

watch([mentionOpen, isMobile], async ([open, mobile]) => {
  if (!open || !mobile) return;
  mentionSheetToken.value = getMentionToken();
  await nextTick();
  mentionSheetSearchRef.value?.focus();
});

function closeSlashSheet(): void {
  slashOpen.value = false;
  textareaRef.value?.focus();
}

function updateSlashSheet(open: boolean): void {
  if (!open) closeSlashSheet();
}

function closeMentionSheet(): void {
  closeMentionMenu();
  mentionSheetToken.value = null;
  textareaRef.value?.focus();
}

function updateMentionSheet(open: boolean): void {
  if (!open) closeMentionSheet();
}

// ---------------------------------------------------------------------------
// Input event handler — updates both menus
// ---------------------------------------------------------------------------

function handleInput(): void {
  // Manual typing leaves history-browsing mode — the text is now a fresh draft.
  history.resetBrowsing();
  updateSlashMenu();
  updateMentionMenu();
}

// ---------------------------------------------------------------------------
// Attachments — see useAttachmentUpload. The composer keeps handleSubmit /
// handleSteer (which read the attachments to build the payload) and the
// `hasUpload` toolbar flag.
// ---------------------------------------------------------------------------
const {
  attachments,
  previewAttachment,
  fileInputRef,
  isDragOver,
  removeAttachment,
  openAttachmentPreview,
  closeAttachmentPreview,
  openFilePicker,
  handleFileInputChange,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  clearAfterSubmit,
  loadAttachments,
} = useAttachmentUpload({ uploadImage: () => props.uploadImage, sessionId: () => props.sessionId });

// Silence noUnusedLocals: fileInputRef is used as a template ref (ref="fileInputRef").
void fileInputRef;

function clearAttachments(): void {
  const ids = attachments.value.map((attachment) => attachment.localId);
  for (const id of ids) removeAttachment(id);
}

const mediaAttachments = computed(() => attachments.value.filter((attachment) => attachment.kind !== 'file'));
const fileAttachments = computed(() => attachments.value.filter((attachment) => attachment.kind === 'file'));
const attachmentScrollRef = ref<HTMLElement | null>(null);
const attachmentMediaRowRef = ref<HTMLElement | null>(null);
const attachmentsOverflow = ref(false);
let attachmentResizeObserver: ResizeObserver | null = null;

function measureAttachmentOverflow(): void {
  const scroll = attachmentScrollRef.value;
  attachmentsOverflow.value = scroll !== null && scroll.scrollHeight > scroll.clientHeight + 1;
}

watch(attachmentScrollRef, (scroll) => {
  attachmentResizeObserver?.disconnect();
  attachmentResizeObserver = null;
  if (scroll && typeof ResizeObserver === 'function') {
    attachmentResizeObserver = new ResizeObserver(measureAttachmentOverflow);
    attachmentResizeObserver.observe(scroll);
  }
  measureAttachmentOverflow();
}, { immediate: true });

watch(attachments, () => void nextTick(measureAttachmentOverflow), { deep: true });

watch(
  () => [mediaAttachments.value.length, fileAttachments.value.length] as const,
  ([mediaCount, fileCount], [previousMediaCount, previousFileCount]) => {
    if (mediaCount <= previousMediaCount && fileCount <= previousFileCount) return;
    void nextTick(() => {
      const scroll = attachmentScrollRef.value;
      if (!scroll) return;
      scroll.scrollTop = mediaCount > previousMediaCount && attachmentMediaRowRef.value
        ? attachmentMediaRowRef.value.offsetHeight - scroll.clientHeight
        : scroll.scrollHeight;
    });
  },
);

onMounted(() => {
  // Fit the box to a restored draft on first render, and reflect its grown
  // state so the expand toggle shows for an already-long draft.
  if (text.value) {
    void nextTick(() => {
      autosize();
      recomputeGrown();
    });
  }
});

onUnmounted(() => {
  document.removeEventListener('click', onPopupDocClick, true);
  attachmentResizeObserver?.disconnect();
  addMenuResizeObserver?.disconnect();
  workModeResizeObserver?.disconnect();
  clearCompositionEndTimer();
});

// ---------------------------------------------------------------------------
// Submit / keydown
// ---------------------------------------------------------------------------

// loadForEdit comes from useComposerDraft (it lives next to the text state).
function focus(): void {
  // preventScroll keeps the pane from jumping if the composer is already in view
  // or if focus is triggered during an animation/transition.
  textareaRef.value?.focus({ preventScroll: true });
}
function loadAttachmentsForEdit(atts: { fileId?: string; kind: 'image' | 'video' | 'file'; url: string; name?: string }[]): void {
  loadAttachments(atts);
}
const anyPopupOpen = computed(() =>
  slashOpen.value
  || mentionOpen.value
  || dropdownOpen.value
  || thinkingDropdownOpen.value
  || permDropdownOpen.value
  || modesOpen.value,
);
const isEmpty = computed(() => text.value.trim().length === 0 && attachments.value.length === 0);
defineExpose({ loadForEdit, loadAttachmentsForEdit, focus, anyPopupOpen, isEmpty });

// Build the wire-bound attachment payload: images/videos only need the fileId,
// while file parts also carry name/mediaType/size for the daemon's file shape.
function toPromptAttachment(a: Attachment): PromptAttachment {
  return { fileId: a.fileId!, kind: a.kind, name: a.name, mediaType: a.mediaType, size: a.size };
}

// Chip primary action: media opens the lightbox preview; a generic file opens
// in a new tab (browser-renderable types) or downloads, once its upload has
// completed and produced a daemon file id.
function onAttachmentActivate(att: Attachment): void {
  if (att.kind === 'file') {
    if (att.fileId !== undefined) void openFileAttachment(att.fileId, att.name, att.mediaType);
    return;
  }
  openAttachmentPreview(att);
}

function handleSubmit(): void {
  const trimmed = text.value.trim();

  // An upload is still in flight — submitting now would silently send the
  // message WITHOUT the image. Keep the text + chips (the chip shows its
  // uploading spinner); the user submits again in a moment.
  if (attachments.value.some((a) => a.uploading)) return;

  // Allow submission with images even when text is empty
  const readyAttachments = attachments.value.filter((a) => !a.uploading && !a.error && a.fileId);

  if (!trimmed && readyAttachments.length === 0) return;

  // Record for ↑/↓ recall before the slash branch so commands (with or without
  // args) are recallable too, not just plain messages. `push` ignores empty /
  // whitespace, so an image-only send adds nothing.
  history.push(trimmed);

  if (trimmed === '/plan') {
    text.value = '';
    clearDraft();
    slashOpen.value = false;
    collapseAndRefit();
    togglePlanMode();
    return;
  }
  if (trimmed === '/goal') {
    text.value = '';
    clearDraft();
    slashOpen.value = false;
    collapseAndRefit();
    toggleGoalMode();
    return;
  }
  // If it's a known slash command, keep the optional tail as command input
  // instead of submitting it as normal chat text. This covers `/goal <task>`,
  // `/dynamic_workflow <task>`, `/btw <question>`, slash skills with args, and bare
  // commands such as `/model`. A hand-typed bare skill name (`/deploy`) also
  // resolves to its prefixed menu entry (`/skill:deploy`), mirroring the TUI.
  if (trimmed) {
    const parsed = parseSlash(trimmed);
    const known = parsed
      ? buildSlashItems(props.skills).some(
          (item) => item.name === parsed.cmd || item.name === `/${SKILL_COMMAND_PREFIX}${parsed.cmd.slice(1)}`,
        )
      : false;
    if (parsed && known) {
      text.value = '';
      clearDraft();
      slashOpen.value = false;
      collapseAndRefit();
      emit('command', parsed.arg ? `${parsed.cmd} ${parsed.arg}` : parsed.cmd);
      return;
    }
  }

  const payload = {
    text: trimmed,
    attachments: readyAttachments.map((a) => toPromptAttachment(a)),
  };

  // Revoke object URLs and drop the submitted attachments.
  previewAttachment.value = null;
  clearAfterSubmit();

  text.value = '';
  clearDraft();
  slashOpen.value = false;
  mentionOpen.value = false;
  collapseAndRefit();
  emit('submit', payload);
}

/**
 * Steer (TUI ctrl+s): push the current text — and the parent merges any queued
 * prompts — straight into the running turn. With an empty composer it still
 * fires when something is queued, so "queue a few thoughts, then ctrl+s" works.
 */
function handleSteer(): void {
  if (!props.running) return;
  if (attachments.value.some((a) => a.uploading)) return;

  const trimmed = text.value.trim();
  const readyAttachments = attachments.value.filter((a) => !a.uploading && !a.error && a.fileId);
  if (!trimmed && readyAttachments.length === 0 && props.queued.length === 0) return;

  const payload = {
    text: trimmed,
    attachments: readyAttachments.map((a) => toPromptAttachment(a)),
  };
  clearAfterSubmit();
  history.push(trimmed);
  text.value = '';
  clearDraft();
  slashOpen.value = false;
  mentionOpen.value = false;
  collapseAndRefit();
  emit('steer', payload);
}

let isComposingText = false;
let compositionEndTimer: ReturnType<typeof setTimeout> | null = null;

function clearCompositionEndTimer(): void {
  if (compositionEndTimer !== null) {
    clearTimeout(compositionEndTimer);
    compositionEndTimer = null;
  }
}

function handleCompositionStart(): void {
  clearCompositionEndTimer();
  isComposingText = true;
}

function handleCompositionEnd(): void {
  clearCompositionEndTimer();
  compositionEndTimer = setTimeout(() => {
    compositionEndTimer = null;
    isComposingText = false;
  }, 0);
}

function isComposingKeyEvent(e: KeyboardEvent): boolean {
  return isComposingText || e.isComposing || e.keyCode === 229;
}

function handleKeydown(e: KeyboardEvent): void {
  if (isComposingKeyEvent(e)) return;

  if (
    workMode.value
    && e.key === 'Backspace'
    && !e.shiftKey
    && !e.altKey
    && !e.metaKey
    && !e.ctrlKey
  ) {
    const textarea = textareaRef.value;
    if (textarea && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
      e.preventDefault();
      dismissWorkMode();
      return;
    }
  }

  // Close dropdowns on Escape
  if (e.key === 'Escape') {
    if (modesOpen.value) {
      e.preventDefault();
      closeModes();
      return;
    }
    if (dropdownOpen.value) {
      e.preventDefault();
      closeDropdown();
      return;
    }
    if (thinkingDropdownOpen.value) {
      e.preventDefault();
      closeThinkingDropdown();
      return;
    }
    if (permDropdownOpen.value) {
      e.preventDefault();
      closePermDropdown();
      return;
    }
  }

  // Slash menu navigation
  if (slashOpen.value) {
    if (e.key === 'Escape') {
      e.preventDefault();
      slashOpen.value = false;
      return;
    }
    if (e.key === 'Tab' && slashItems.value.length === 0) {
      slashOpen.value = false;
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashActive.value = (slashActive.value + 1) % slashItems.value.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashActive.value = (slashActive.value - 1 + slashItems.value.length) % slashItems.value.length;
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const item = slashItems.value[slashActive.value];
      if (item) selectSlashCommand(item);
      return;
    }
  }

  // Mention menu navigation
  if (mentionOpen.value && !mentionLoading.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionActive.value = (mentionActive.value + 1) % Math.max(1, mentionItems.value.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionActive.value = (mentionActive.value - 1 + Math.max(1, mentionItems.value.length)) % Math.max(1, mentionItems.value.length);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const item = mentionItems.value[mentionActive.value];
      if (item) selectMentionItem(item);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      mentionOpen.value = false;
      return;
    }
  }

  // Ctrl+S / Cmd+S — steer into the running turn (TUI parity)
  if (e.key === 's' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    if (props.running) {
      e.preventDefault();
      handleSteer();
    }
    return;
  }

  // History recall (shell-style ↑/↓) — see useInputHistory for the machinery.
  //
  // Disabled entirely in the expanded editor: that mode is for composing long
  // multi-line text, so the arrows always move the caret within the draft and
  // never jump to a previous message.
  //
  // ENTERING history: a plain ArrowUp only recalls when the caret is at the
  // very start of the text, so editing a multi-line draft with the arrows
  // still works — ArrowUp moves the caret within the draft until it reaches
  // the top, instead of jumping to a previous message mid-navigation.
  // ONCE BROWSING, the arrows walk history directly, regardless of where the
  // caret landed — a recalled multi-line entry leaves the caret at its end, and
  // the old "must be at the start" gate then trapped it there, so further
  // ArrowUp did nothing ("only one step back"). Walking freely while browsing
  // fixes that; typing exits history (handleInput resets browsing), after which
  // the arrows move the caret normally again.
  if (!expanded.value && !slashOpen.value && !mentionOpen.value && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
    const browsing = history.isBrowsing();
    if (e.key === 'ArrowUp' && history.hasHistory() && (browsing || history.caretAtTextStart())) {
      e.preventDefault();
      history.recallOlder();
      slashOpen.value = false;
      return;
    }
    if (e.key === 'ArrowDown' && browsing) {
      e.preventDefault();
      history.recallNewer();
      slashOpen.value = false;
      return;
    }
  }

  // Normal Enter / Shift+Enter
  if (e.key === 'Enter' && !e.shiftKey) {
    // Expanded editor: Enter inserts a newline; Cmd/Ctrl+Enter sends.
    // (Clicking the send button always sends.) Shift+Enter already falls
    // through to the default newline above, so behavior matches either way.
    if (expanded.value && !(e.metaKey || e.ctrlKey)) {
      return;
    }
    e.preventDefault();
    handleSubmit();
  }
}

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

// Send is always "send" — while running it enqueues (handled upstream by
// sendPrompt). Interrupt lives on a separate Stop button so the two can never
// be confused.
const sendLabel = computed(() => t('composer.send'));
const hasUpload = computed(() => !!props.uploadImage);
const canSend = computed(
  () => !attachments.value.some((attachment) => attachment.uploading)
    && (text.value.trim() !== '' || attachments.value.some((attachment) => !attachment.error && attachment.fileId)),
);
const popupControls = computed(() => {
  if (slashOpen.value) return 'composer-slash-menu';
  if (mentionOpen.value) return 'composer-mention-menu';
  return undefined;
});
const activePopupOption = computed(() => {
  if (slashOpen.value && slashItems.value.length > 0) return `composer-slash-option-${slashActive.value}`;
  if (mentionOpen.value && mentionItems.value.length > 0) return `composer-mention-option-${mentionActive.value}`;
  return undefined;
});

// ---------------------------------------------------------------------------
// Bottom toolbar — split into individual controls
// ---------------------------------------------------------------------------

const dropdownOpen = ref(false);
const thinkingDropdownOpen = ref(false);
const permDropdownOpen = ref(false);
const toolbarRef = ref<HTMLElement | null>(null);
const permissionPillRef = ref<HTMLElement | null>(null);
const modelPillRef = ref<HTMLButtonElement | null>(null);
const thinkingPillRef = ref<HTMLButtonElement | null>(null);
const modelNameRef = ref<HTMLElement | null>(null);
const modelDropdownRef = ref<HTMLElement | null>(null);
const thinkingDropdownRef = ref<HTMLElement | null>(null);
const permDropdownRef = ref<HTMLElement | null>(null);
useOpenMenu(modelDropdownRef);
useOpenMenu(thinkingDropdownRef);
useOpenMenu(permDropdownRef);
const permissionLeft = ref('');
const modelRight = ref('');
const thinkingRight = ref('');
const modelMenuMaxHeight = ref('');
const modelMenuFlipDown = ref(false);

function toggleDropdown(): void {
  dropdownOpen.value = !dropdownOpen.value;
  if (dropdownOpen.value) {
    measureModelAnchor();
    thinkingDropdownOpen.value = false;
    permDropdownOpen.value = false;
    closeModes();
    slashOpen.value = false;
    mentionOpen.value = false;
    document.addEventListener('click', onPopupDocClick, true);
  }
}

function toggleThinkingDropdown(): void {
  if (thinkingReadonly.value) return;
  thinkingDropdownOpen.value = !thinkingDropdownOpen.value;
  if (thinkingDropdownOpen.value) {
    measureThinkingAnchor();
    dropdownOpen.value = false;
    permDropdownOpen.value = false;
    closeModes();
    slashOpen.value = false;
    mentionOpen.value = false;
    document.addEventListener('click', onPopupDocClick, true);
  }
}

function closeThinkingDropdown(): void {
  thinkingDropdownOpen.value = false;
  removePopupListenerIfIdle();
}

function closeDropdown(): void {
  dropdownOpen.value = false;
  removePopupListenerIfIdle();
}

function togglePermDropdown(): void {
  permDropdownOpen.value = !permDropdownOpen.value;
  if (permDropdownOpen.value) {
    measurePermissionAnchor();
    dropdownOpen.value = false;
    thinkingDropdownOpen.value = false;
    closeModes();
    slashOpen.value = false;
    mentionOpen.value = false;
    document.addEventListener('click', onPopupDocClick, true);
  }
}

function closePermDropdown(): void {
  permDropdownOpen.value = false;
  removePopupListenerIfIdle();
}

function removePopupListenerIfIdle(): void {
  if (!dropdownOpen.value && !thinkingDropdownOpen.value && !permDropdownOpen.value && !modesOpen.value) {
    document.removeEventListener('click', onPopupDocClick, true);
  }
}

function onPopupDocClick(event: MouseEvent): void {
  const target = event.target as Node;
  if (
    toolbarRef.value?.contains(target)
    || modesMenuRef.value?.contains(target)
    || mobileModesMenuRef.value?.contains(target)
  ) return;
  closeDropdown();
  closeThinkingDropdown();
  closePermDropdown();
  closeModes();
}

function measurePermissionAnchor(): void {
  const pill = permissionPillRef.value;
  const toolbar = toolbarRef.value;
  permissionLeft.value = pill && toolbar
    ? `${Math.round(pill.getBoundingClientRect().left - toolbar.getBoundingClientRect().left)}px`
    : '';
}

function measureModelAnchor(): void {
  const pill = modelPillRef.value;
  const toolbar = toolbarRef.value;
  modelRight.value = pill && toolbar
    ? `${Math.round(toolbar.getBoundingClientRect().right - pill.getBoundingClientRect().right)}px`
    : '';
}

function measureThinkingAnchor(): void {
  const pill = thinkingPillRef.value;
  const toolbar = toolbarRef.value;
  thinkingRight.value = pill && toolbar
    ? `${Math.round(toolbar.getBoundingClientRect().right - pill.getBoundingClientRect().right)}px`
    : '';
}

// Clamped to 0–100: ctxUsed can momentarily exceed ctxMax (estimates), and
// ctxMax can be 0 before the first status fetch — both broke the ring. ceil
// (not round) so a session under 0.5% usage still shows a sliver of arc —
// Math.round floored it to an empty, "no data"-looking ring.
const pct = computed(() => {
  const max = props.status?.ctxMax ?? 0;
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, Math.ceil(((props.status?.ctxUsed ?? 0) / max) * 100)));
});

const ctxTooltip = computed(() => {
  const used = formatTokens(props.status?.ctxUsed ?? 0);
  const max = formatTokens(props.status?.ctxMax ?? 0);
  return t('status.ctxTooltip', { used, max, pct: pct.value });
});

const showCompact = computed(() => pct.value >= 80);

// Thinking toggle
// Identity is the model id — display/model names can collide across providers.
const currentModel = computed(() =>
  props.models?.find((m) => m.id === props.status?.modelId),
);
const thinkingAvailability = computed(() => modelThinkingAvailability(currentModel.value));
const thinkingSegments = computed(() => segmentsFor(currentModel.value));
// The client resolves the level per model (the model's stored pick when still
// declared, else the catalog default), so what arrives here is valid for the
// active model and highlights its segment. An undeclared level can only appear
// transiently, before the catalog loads, and simply highlights no segment.
const thinkingLevel = computed(() => effectiveThinkingLevel(currentModel.value, props.thinking));
const activeThinkingSegment = computed(() => {
  const segs = thinkingSegments.value;
  return segs.includes(thinkingLevel.value) ? thinkingLevel.value : '';
});
// Single-segment (always-on boolean) or unsupported models can't be changed.
const thinkingReadonly = computed(
  () => thinkingAvailability.value === 'unsupported' || thinkingSegments.value.length <= 1,
);
const thinkingPillLabel = computed(() => {
  const hasEfforts = (currentModel.value?.supportEfforts?.length ?? 0) > 0;
  const level = thinkingLevel.value;
  if (hasEfforts && level !== 'on' && level !== 'off') return effortLabel(level);
  return thinkingSegmentLabel(level);
});
const thinkingAriaLabel = computed(() =>
  t('composer.thinkingControl', { level: thinkingPillLabel.value }),
);
function setThinkingSegment(draft: string): void {
  if (thinkingReadonly.value) return;
  emit('setThinking', commitLevel(currentModel.value, draft));
  closeThinkingDropdown();
}
function thinkingSegmentLabel(segment: string): string {
  if (segment === 'on') return t('status.thinkingOn');
  if (segment === 'off') return t('status.thinkingOff');
  return effortLabel(segment);
}

const thinkingOptions = computed(() => thinkingSegments.value.map((segment) => ({
  value: segment,
  label: thinkingSegmentLabel(segment),
})));

// Work modes
const planOn = computed(() => props.planArmed === true || props.planMode === true);
const workflowOn = computed(() => props.workflowActive === true);
const goalStatus = computed(() => props.goal?.status ?? props.activationBadges?.goal?.status ?? null);
const goalActive = computed(() => goalStatus.value !== null && goalStatus.value !== 'complete');
const workMode = computed<'goal' | 'plan' | null>(() => {
  if (props.goalMode) return 'goal';
  if (props.planArmed) return 'plan';
  return null;
});
const workModePillRef = ref<HTMLElement | null>(null);
const workModeIndent = ref('');
const textareaStyle = computed(() => workModeIndent.value ? { textIndent: workModeIndent.value } : undefined);
let workModeResizeObserver: ResizeObserver | null = null;

function dismissWorkMode(): void {
  if (workMode.value === 'goal') emit('toggleGoal');
  else if (workMode.value === 'plan') emit('togglePlan');
}

function measureWorkModePill(): void {
  const pill = workModePillRef.value;
  workModeIndent.value = pill
    ? `calc(${pill.offsetWidth}px + var(--space-1-5) - var(--space-05))`
    : '';
}

watch(workMode, async (mode) => {
  workModeResizeObserver?.disconnect();
  workModeResizeObserver = null;
  if (!mode) {
    workModeIndent.value = '';
    return;
  }
  await nextTick();
  measureWorkModePill();
  if (typeof ResizeObserver === 'function' && workModePillRef.value) {
    workModeResizeObserver = new ResizeObserver(measureWorkModePill);
    workModeResizeObserver.observe(workModePillRef.value);
  }
}, { immediate: true });

// The "+" add menu (Files / Connectors / Goal / Plan).
const capMenuRef = ref<InstanceType<typeof CapabilityMenu> | null>(null);
const modesOpen = ref(false);
const modesMenuRef = ref<HTMLElement | null>(null);
const mobileModesMenuRef = ref<HTMLElement | null>(null);
useOpenMenu(modesMenuRef);
useOpenMenu(mobileModesMenuRef);
const addMenuScrollRef = ref<HTMLElement | null>(null);
const addMenuThumb = ref<{ top: number; height: number } | null>(null);
let addMenuResizeObserver: ResizeObserver | null = null;

interface AddMenuRow {
  id: string;
  icon: IconName;
  nameKey: string;
  descKey?: string;
  action: () => void;
}

const addMenuRows = computed<AddMenuRow[]>(() => {
  const rows: AddMenuRow[] = [];
  if (hasUpload.value) {
    rows.push({ id: 'files', icon: 'attachment', nameKey: 'composer.addFiles', action: openFiles });
  }
  if (isMobile.value) {
    rows.push(
      { id: 'slash', icon: 'terminal', nameKey: 'composer.addSlash', descKey: 'composer.addSlashDesc', action: openSlashSheet },
      { id: 'mention', icon: 'link', nameKey: 'composer.addMention', descKey: 'composer.addMentionDesc', action: openMentionSheet },
    );
  }
  rows.push(
    { id: 'capabilities', icon: 'sliders', nameKey: 'capabilityMenu.trigger', action: openCapabilities },
    { id: 'goal', icon: 'target', nameKey: 'status.goalLabel', descKey: 'composer.addGoalDesc', action: openGoalMode },
    { id: 'plan', icon: 'file-edit', nameKey: 'status.planLabel', descKey: 'composer.addPlanDesc', action: openPlanMode },
    { id: 'workflow', icon: 'sparkles', nameKey: 'status.dynamicWorkflowLabel', descKey: 'composer.addWorkflowDesc', action: openWorkflowMode },
  );
  return rows;
});

function measureAddMenuThumb(): void {
  const scroll = addMenuScrollRef.value;
  if (!scroll || scroll.scrollHeight <= scroll.clientHeight + 1) {
    addMenuThumb.value = null;
    return;
  }
  const style = getComputedStyle(scroll);
  const inset = Number.parseFloat(style.getPropertyValue('--menu-scrollbar-track-inset')) || 0;
  const minimum = Number.parseFloat(style.getPropertyValue('--menu-scrollbar-thumb-min')) || 24;
  const track = scroll.clientHeight - inset * 2;
  const height = Math.max(minimum, (scroll.clientHeight / scroll.scrollHeight) * track);
  const range = scroll.scrollHeight - scroll.clientHeight;
  addMenuThumb.value = {
    top: scroll.offsetTop + inset + (scroll.scrollTop / range) * (track - height),
    height,
  };
}

watch(modesOpen, async (open) => {
  addMenuResizeObserver?.disconnect();
  addMenuResizeObserver = null;
  addMenuThumb.value = null;
  if (!open) return;
  await nextTick();
  measureAddMenuThumb();
  if (typeof ResizeObserver === 'function' && addMenuScrollRef.value) {
    addMenuResizeObserver = new ResizeObserver(measureAddMenuThumb);
    addMenuResizeObserver.observe(addMenuScrollRef.value);
  }
});

function closeModes(): void {
  modesOpen.value = false;
  removePopupListenerIfIdle();
}

function updateModesSheet(open: boolean): void {
  if (!open) closeModes();
}
function toggleModes(): void {
  if (modesOpen.value) {
    closeModes();
    return;
  }
  // Keep the toolbar menus mutually exclusive so they never overlap.
  closeDropdown();
  closeThinkingDropdown();
  closePermDropdown();
  slashOpen.value = false;
  mentionOpen.value = false;
  modesOpen.value = true;
  document.addEventListener('click', onPopupDocClick, true);
  void nextTick(() => {
    const menu = isMobile.value ? mobileModesMenuRef.value : modesMenuRef.value;
    menu?.querySelector<HTMLButtonElement>('.am-row')?.focus();
  });
}

function activateAddMenuRow(row: AddMenuRow): void {
  row.action();
  if (!(isMobile.value && row.id === 'files')) textareaRef.value?.focus();
}

function handleAddMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModes();
    textareaRef.value?.focus();
    return;
  }
  if (event.key === 'Tab') {
    closeModes();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const menu = isMobile.value ? mobileModesMenuRef.value : modesMenuRef.value;
  const rows = Array.from(menu?.querySelectorAll<HTMLButtonElement>('.am-row') ?? []);
  if (rows.length === 0) return;
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown'
    ? (current + 1) % rows.length
    : (current - 1 + rows.length) % rows.length;
  rows[next]?.focus();
}

function openFiles(): void {
  closeModes();
  openFilePicker();
}

function openSlashSheet(): void {
  closeModes();
  text.value = '/';
  void nextTick(() => {
    placeComposerCaret(1);
    updateSlashMenu();
  });
}

function openMentionSheet(): void {
  closeModes();
  text.value = '@';
  void nextTick(() => {
    placeComposerCaret(1);
    updateMentionMenu();
  });
}

function openCapabilities(): void {
  closeModes();
  capMenuRef.value?.toggleOpen();
}

function openGoalMode(): void {
  closeModes();
  if (!props.goalMode) toggleGoalMode();
}

function openPlanMode(): void {
  closeModes();
  if (!planOn.value) togglePlanMode();
}

function openWorkflowMode(): void {
  closeModes();
  if (!workflowOn.value) emit('toggleWorkflow');
}

// Permission modes
const PERM_MODES: { mode: PermissionMode; icon: 'fingerprint' | 'shield-question' | 'full-access'; color: string; labelKey: string; descKey: string }[] = [
  { mode: 'manual', icon: 'fingerprint', color: 'var(--color-text)', labelKey: 'status.permissionManual', descKey: 'status.permissionManualDesc' },
  { mode: 'yolo', icon: 'shield-question', color: 'var(--color-warning)', labelKey: 'status.permissionYolo', descKey: 'status.permissionYoloDesc' },
  { mode: 'auto', icon: 'full-access', color: 'var(--color-danger)', labelKey: 'status.permissionAuto', descKey: 'status.permissionAutoDesc' },
];

const menuMeasureRef = ref<HTMLElement | null>(null);
const permissionDescriptionWidth = ref('');
function menuDescStyle(width: string): Record<string, string> {
  const style: Record<string, string> = {};
  if (width) style['--composer-menu-desc-width'] = width;
  return style;
}
const permissionMenuStyle = computed<Record<string, string>>(() => {
  const style = menuDescStyle(permissionDescriptionWidth.value);
  if (permissionLeft.value) style.left = permissionLeft.value;
  return style;
});
const modelMenuStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {};
  if (modelRight.value) style.right = modelRight.value;
  if (modelMenuMaxHeight.value) style.maxHeight = modelMenuMaxHeight.value;
  return style;
});
const thinkingMenuStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {};
  if (thinkingRight.value) style.right = thinkingRight.value;
  return style;
});
let menuMeasureFrame: number | null = null;

function cssPx(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function canvasFont(style: CSSStyleDeclaration): string {
  return `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize} ${style.fontFamily}`;
}

function letterSpacingPx(style: CSSStyleDeclaration): number {
  return style.letterSpacing === 'normal' ? 0 : cssPx(style.letterSpacing);
}

function measureTextWidth(text: string, style: CSSStyleDeclaration): number {
  if (!text) return 0;
  const prepared = prepareWithSegments(text, canvasFont(style), {
    letterSpacing: letterSpacingPx(style),
  });
  return measureNaturalWidth(prepared);
}

function measureMenuDescriptions(): void {
  const probe = menuMeasureRef.value?.querySelector<HTMLElement>('.pd-desc');
  if (!probe) return;
  const style = getComputedStyle(probe);
  const permissionWidth = Math.max(
    0,
    ...PERM_MODES.map((opt) => measureTextWidth(t(opt.descKey), style)),
  );
  permissionDescriptionWidth.value = permissionWidth > 0 ? `${Math.ceil(permissionWidth)}px` : '';
}

function scheduleMenuDescriptionMeasure(): void {
  if (typeof window === 'undefined') return;
  if (menuMeasureFrame !== null) {
    window.cancelAnimationFrame(menuMeasureFrame);
  }
  void nextTick(() => {
    menuMeasureFrame = window.requestAnimationFrame(() => {
      menuMeasureFrame = null;
      measureMenuDescriptions();
    });
  });
}

watch(locale, scheduleMenuDescriptionMeasure, { immediate: true });

onMounted(() => {
  scheduleMenuDescriptionMeasure();
  void document.fonts?.ready.then(scheduleMenuDescriptionMeasure);
});

onUnmounted(() => {
  if (menuMeasureFrame !== null) {
    window.cancelAnimationFrame(menuMeasureFrame);
    menuMeasureFrame = null;
  }
});

function choosePermission(mode: PermissionMode): void {
  emit('setPermission', mode);
  closePermDropdown();
}

const permInfo = computed(() => PERM_MODES.find((p) => p.mode === props.status?.permission));
const permLabel = computed(() => (permInfo.value ? t(permInfo.value.labelKey) : ''));
const permIcon = computed(() => permInfo.value?.icon ?? 'fingerprint');
const labelsCollapsed = ref(false);
const modelIconOnly = ref(false);
let labelsCollapsedAt = 0;
let modelIconOnlyAt = 0;
let toolbarResizeObserver: ResizeObserver | null = null;

function toolbarMetric(style: CSSStyleDeclaration, property: string, fallback: number): number {
  const raw = style.getPropertyValue(property).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith('em') ? value * Number.parseFloat(style.fontSize) : value;
}

function modelNameOverflows(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth + 1
    || (element.clientWidth === 0 && (element.textContent?.length ?? 0) > 0);
}

function measureToolbarOverflow(): void {
  const toolbar = toolbarRef.value;
  if (!toolbar) return;
  const style = getComputedStyle(toolbar);
  const floor = toolbarMetric(style, '--composer-valve-floor', 56);
  const margin = toolbarMetric(style, '--composer-valve-expand-margin', 48);
  const width = toolbar.getBoundingClientRect().width;
  if (modelIconOnly.value) {
    if (width > modelIconOnlyAt + margin) {
      modelIconOnly.value = false;
      void nextTick(measureToolbarOverflow);
    }
    return;
  }
  if (labelsCollapsed.value && width > labelsCollapsedAt + margin) {
    labelsCollapsed.value = false;
    void nextTick(measureToolbarOverflow);
    return;
  }
  const name = modelNameRef.value;
  if (!name || !modelNameOverflows(name) || name.getBoundingClientRect().width >= floor) return;
  if (labelsCollapsed.value) {
    modelIconOnlyAt = width;
    modelIconOnly.value = true;
  } else {
    labelsCollapsedAt = width;
    labelsCollapsed.value = true;
  }
  void nextTick(measureToolbarOverflow);
}

onMounted(() => {
  if (typeof ResizeObserver === 'function' && toolbarRef.value) {
    toolbarResizeObserver = new ResizeObserver(measureToolbarOverflow);
    toolbarResizeObserver.observe(toolbarRef.value);
  }
  void document.fonts?.ready.then(measureToolbarOverflow);
});

watch(
  [
    permLabel,
    workflowOn,
    showCompact,
    thinkingPillLabel,
    () => props.status?.model,
    () => props.working,
    locale,
  ],
  () => {
    labelsCollapsed.value = false;
    modelIconOnly.value = false;
    void nextTick(measureToolbarOverflow);
  },
);

onUnmounted(() => {
  toolbarResizeObserver?.disconnect();
  toolbarResizeObserver = null;
});

// ---------------------------------------------------------------------------
// Model dropdown — current provider models + more
// ---------------------------------------------------------------------------

const currentProvider = computed(() => {
  return currentModel.value?.provider ?? '';
});

const providerModels = computed(() => {
  if (!currentProvider.value || !props.models?.length) return [];
  return props.models.filter((m) => m.provider === currentProvider.value);
});

const starredSet = computed(() => new Set(props.starredIds ?? []));
function isStarred(modelId: string): boolean {
  return starredSet.value.has(modelId);
}
const starredOtherModels = computed(() => {
  if (!props.models?.length) return [];
  return props.models.filter(
    (m) => isStarred(m.id) && m.provider !== currentProvider.value,
  );
});

function fitModelMenuToViewport(): void {
  const menu = modelDropdownRef.value;
  const toolbar = toolbarRef.value;
  if (!menu || !toolbar) return;
  const style = getComputedStyle(menu);
  const gap = cssPx(style.getPropertyValue('--space-1')) || 4;
  const margin = cssPx(style.getPropertyValue('--space-2')) || 8;
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const bottom = top + (viewport?.height ?? window.innerHeight);
  const anchor = toolbar.getBoundingClientRect();
  const above = anchor.top - top - gap - margin;
  const below = bottom - anchor.bottom - gap - margin;
  if (menu.offsetHeight > above && below > above) {
    modelMenuFlipDown.value = true;
    modelMenuMaxHeight.value = `${Math.max(Math.floor(below), 0)}px`;
  } else {
    modelMenuFlipDown.value = false;
    modelMenuMaxHeight.value = `${Math.max(Math.floor(above), 0)}px`;
  }
}

function closeModelMenuForViewportChange(): void {
  closeDropdown();
}

function addModelMenuViewportListeners(): void {
  window.addEventListener('resize', closeModelMenuForViewportChange);
  window.visualViewport?.addEventListener('resize', closeModelMenuForViewportChange);
  window.visualViewport?.addEventListener('scroll', closeModelMenuForViewportChange);
}

function removeModelMenuViewportListeners(): void {
  window.removeEventListener('resize', closeModelMenuForViewportChange);
  window.visualViewport?.removeEventListener('resize', closeModelMenuForViewportChange);
  window.visualViewport?.removeEventListener('scroll', closeModelMenuForViewportChange);
}

watch(dropdownOpen, async (open) => {
  if (!open) {
    removeModelMenuViewportListeners();
    return;
  }
  addModelMenuViewportListeners();
  modelMenuFlipDown.value = false;
  modelMenuMaxHeight.value = '';
  await nextTick();
  fitModelMenuToViewport();
  const current = modelDropdownRef.value?.querySelector<HTMLButtonElement>('.md-row.is-current');
  (current ?? modelDropdownRef.value?.querySelector<HTMLButtonElement>('.md-row'))?.focus();
});

onUnmounted(removeModelMenuViewportListeners);

function handleModelDropdownKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const rows = Array.from(modelDropdownRef.value?.querySelectorAll<HTMLButtonElement>('.md-row:not(:disabled)') ?? []);
  if (rows.length === 0) return;
  event.preventDefault();
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown'
    ? (current + 1) % rows.length
    : (current - 1 + rows.length) % rows.length;
  rows[next]?.focus();
}

function selectModel(modelId: string): void {
  emit('selectModel', modelId);
  closeDropdown();
}
</script>

<template>
  <div
    class="composer"
    :class="{ 'drag-over': isDragOver, expanded }"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div v-if="previewAttachment" class="att-lightbox" @click.self="closeAttachmentPreview">
      <div class="att-lightbox-card">
        <Tooltip :text="t('model.close')">
          <button type="button" class="att-lightbox-close" @click="closeAttachmentPreview">✕</button>
        </Tooltip>
        <video
          v-if="previewAttachment.kind === 'video'"
          class="att-lightbox-media"
          :src="previewAttachment.previewUrl"
          controls
          playsinline
        />
        <img v-else class="att-lightbox-media" :src="previewAttachment.previewUrl" :alt="previewAttachment.name" />
        <div class="att-lightbox-name">{{ previewAttachment.name }}</div>
      </div>
    </div>

    <div class="composer-card" :class="{ 'labels-collapsed': labelsCollapsed }">
      <div v-if="attachments.length > 0" class="att-strip">
        <div
          ref="attachmentScrollRef"
          class="att-scroll"
          :class="{ 'is-overflowing': attachmentsOverflow }"
        >
          <div class="att-scroll-content">
            <div
              v-if="mediaAttachments.length > 0"
              ref="attachmentMediaRowRef"
              class="att-row att-row-media"
            >
              <AttachmentChip
                v-for="att in mediaAttachments"
                :key="att.localId"
                :kind="att.kind"
                :name="att.name"
                :url="att.previewUrl"
                :file-id="att.fileId"
                :media-type="att.mediaType"
                :size="att.size"
                :uploading="att.uploading"
                :error="att.error"
                removable
                :remove-label="t('composer.removeNamed', { name: att.name })"
                @activate="onAttachmentActivate(att)"
                @remove="removeAttachment(att.localId)"
              />
            </div>
            <div v-if="fileAttachments.length > 0" class="att-row">
              <AttachmentChip
                v-for="att in fileAttachments"
                :key="att.localId"
                kind="file"
                :name="att.name"
                :media-type="att.mediaType"
                :size="att.size"
                :uploading="att.uploading"
                :error="att.error"
                removable
                :remove-label="t('composer.removeNamed', { name: att.name })"
                @activate="onAttachmentActivate(att)"
                @remove="removeAttachment(att.localId)"
              />
            </div>
          </div>
        </div>
        <span v-if="attachmentsOverflow" class="att-more">
          {{ t('composer.attachmentCount', { n: attachments.length }) }}
        </span>
        <Tooltip v-if="attachments.length >= 2" :text="t('composer.clearAll')">
          <IconButton
            class="att-clear"
            size="sm"
            :label="t('composer.clearAll')"
            @click="clearAttachments"
          >
            <Icon name="trash" />
          </IconButton>
        </Tooltip>
      </div>

      <div class="cin-wrap">
        <SlashMenu
          v-if="slashOpen && !isMobile"
          id="composer-slash-menu"
          :items="slashItems"
          :active-index="slashActive"
          @select="selectSlashCommand"
          @hover="slashActive = $event"
        />

        <!-- Mention menu (above textarea) -->
        <MentionMenu
          v-if="mentionOpen && !isMobile"
          id="composer-mention-menu"
          :items="mentionItems"
          :active-index="mentionActive"
          :loading="mentionLoading"
          :stale="mentionStale"
          @select="selectMentionItem"
          @hover="mentionActive = $event"
        />

        <Transition name="composer-menu-pop">
          <div
            v-if="modesOpen && !isMobile"
            ref="modesMenuRef"
            class="add-menu"
            @click.stop
            @keydown="handleAddMenuKeydown"
          >
            <div
              ref="addMenuScrollRef"
              class="am-scroll"
              role="menu"
              @scroll="measureAddMenuThumb"
            >
              <button
                v-for="row in addMenuRows"
                :key="row.id"
                type="button"
                class="am-row"
                role="menuitem"
                @mousedown.prevent
                @click="activateAddMenuRow(row)"
              >
                <span class="am-icon"><Icon :name="row.icon" size="sm" /></span>
                <span class="am-name">{{ t(row.nameKey) }}</span>
                <span v-if="row.descKey" class="am-desc">{{ t(row.descKey) }}</span>
              </button>
            </div>
            <div
              v-if="addMenuThumb"
              class="scroll-thumb"
              :style="{ top: `${addMenuThumb.top}px`, height: `${addMenuThumb.height}px` }"
            />
          </div>
        </Transition>

        <div class="input-row">
          <span v-if="workMode" ref="workModePillRef" class="wm-pill">
            <Icon :name="workMode === 'goal' ? 'target' : 'file-edit'" size="sm" />
            <span>{{ workMode === 'goal' ? t('status.goalLabel') : t('status.planLabel') }}</span>
            <IconButton
              class="wm-x"
              size="sm"
              :label="t('status.workModeDismiss')"
              @mousedown.prevent
              @click="dismissWorkMode"
            >
              <Icon name="close" size="sm" />
            </IconButton>
          </span>
          <textarea
            ref="textareaRef"
            v-model="text"
            class="ph"
            :style="textareaStyle"
            :placeholder="placeholder"
            :disabled="starting"
            autocomplete="off"
            spellcheck="false"
            rows="1"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            :aria-expanded="Boolean(popupControls)"
            :aria-controls="popupControls"
            :aria-activedescendant="activePopupOption"
            @keydown="handleKeydown"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
            @input="handleInput"
            @blur="if (!isMobile) { slashOpen = false; mentionOpen = false; }"
          />
          <Tooltip :text="expanded ? t('composer.collapseTitle') : t('composer.expandTitle')">
            <button
              v-if="expanded || isGrown"
              class="expand-btn"
              type="button"
              :aria-label="expanded ? t('composer.collapseTitle') : t('composer.expandTitle')"
              @click="toggleExpand"
            >
              <Icon v-if="expanded" name="collapse" size="sm" />
              <Icon v-else name="expand" size="sm" />
            </button>
          </Tooltip>
        </div>
      </div>

      <input
        v-if="hasUpload"
        ref="fileInputRef"
        type="file"
        multiple
        class="file-input-hidden"
        @change="handleFileInputChange"
      />

      <div ref="toolbarRef" class="toolbar">
        <div ref="menuMeasureRef" class="menu-measure" aria-hidden="true">
          <span class="pd-desc" />
        </div>

        <div class="toolbar-left">
          <IconButton
            size="md"
            class="composer-attach"
            :label="t('composer.addMenu')"
            aria-haspopup="menu"
            :aria-expanded="modesOpen"
            @mousedown.prevent
            @click.stop="toggleModes"
          >
            <Icon name="plus" />
          </IconButton>

          <CapabilityMenu ref="capMenuRef" :session-id="sessionId" triggerless />

          <span
            v-if="status"
            ref="permissionPillRef"
            class="perm-pill"
            :class="['perm-' + status.permission, { open: permDropdownOpen }]"
            role="button"
            tabindex="0"
            :aria-label="permLabel"
            @click.stop="togglePermDropdown"
            @keydown.enter="togglePermDropdown"
            @keydown.space.prevent="togglePermDropdown"
          >
            <Icon class="perm-pill-icon" :name="permIcon" size="md" />
            <span class="perm-pill-label">{{ permLabel }}</span>
          </span>

          <Transition name="composer-menu-pop">
            <div
              v-if="permDropdownOpen && status"
              ref="permDropdownRef"
              class="perm-dropdown"
              :style="permissionMenuStyle"
              role="menu"
              @click.stop
            >
              <button
                v-for="opt in PERM_MODES"
                :key="opt.mode"
                class="pd-row"
                :class="{ 'is-current': opt.mode === status.permission }"
                role="menuitem"
                @click="choosePermission(opt.mode)"
              >
                <span class="pd-icon" :style="{ color: opt.color }">
                  <Icon :name="opt.icon" size="md" />
                </span>
                <span class="pd-info">
                  <span class="pd-name" :style="{ color: opt.color }">{{ t(opt.labelKey) }}</span>
                  <span class="pd-desc">{{ t(opt.descKey) }}</span>
                </span>
                <span class="pd-check">
                  <Icon v-if="opt.mode === status.permission" name="check" size="sm" />
                </span>
              </button>
            </div>
          </Transition>

          <span v-if="workflowOn" class="workflow-chip">
            <Icon class="workflow-ic" name="sparkles" size="md" />
            <span class="workflow-label">{{ t('status.dynamicWorkflowLabel') }}</span>
            <IconButton
              class="workflow-x"
              size="sm"
              :label="t('status.dynamicWorkflowDismiss')"
              @mousedown.prevent
              @click.stop="emit('toggleWorkflow')"
            >
              <Icon name="close" size="sm" />
            </IconButton>
          </span>
        </div>

        <div class="toolbar-right">
          <button v-if="showCompact" class="compact-chip" @click.stop="emit('compact')">/compact</button>

          <Tooltip :text="ctxTooltip">
            <span
              v-if="status && !hideContext"
              class="ctx-group"
              role="img"
              tabindex="0"
              :aria-label="ctxTooltip"
            >
              <ContextRing :pct="pct" />
            </span>
          </Tooltip>

          <Tooltip :text="modelIconOnly ? status?.model : null">
            <button
              v-if="status"
              ref="modelPillRef"
              type="button"
              class="model-pill"
              :class="{ open: dropdownOpen, 'icon-only': modelIconOnly }"
              aria-haspopup="menu"
              :aria-expanded="dropdownOpen"
              :aria-label="modelIconOnly ? status.model : undefined"
              @click.stop="toggleDropdown"
            >
              <Icon v-if="modelIconOnly" name="cute-bot" size="md" />
              <template v-else>
                <span ref="modelNameRef" class="mp-name">{{ status.model }}</span>
                <Icon class="cv" name="chevron-down" size="sm" />
              </template>
            </button>
          </Tooltip>
          <Tooltip v-if="status && thinkingAvailability !== 'unsupported'" :text="thinkingAriaLabel">
            <button
              ref="thinkingPillRef"
              type="button"
              class="thinking-pill"
              :class="{ open: thinkingDropdownOpen }"
              :disabled="thinkingReadonly"
              aria-haspopup="dialog"
              :aria-expanded="thinkingDropdownOpen"
              :aria-label="thinkingAriaLabel"
              @click.stop="toggleThinkingDropdown"
            >
              <Icon name="thinking" size="sm" />
              <span class="thinking-pill-label">{{ thinkingPillLabel }}</span>
              <Icon v-if="!thinkingReadonly" class="cv" name="chevron-down" size="sm" />
            </button>
          </Tooltip>
          <Tooltip v-if="working" :text="t('composer.interruptTitle')">
            <button
              class="stop"
              :aria-label="t('composer.interrupt')"
              @click="emit('interrupt')"
            >
              <span class="stop-square" aria-hidden="true" />
            </button>
          </Tooltip>
          <button
            class="send"
            :class="{ 'is-starting': starting }"
            :aria-label="sendLabel"
            :disabled="starting || !canSend"
            @click="handleSubmit()"
          >
            <Spinner v-if="starting" size="sm" />
            <Icon v-else name="send" size="sm" />
          </button>
        </div>

        <Transition name="composer-menu-pop">
          <div
            v-if="dropdownOpen && status"
            ref="modelDropdownRef"
            class="composer-dropdown model-dropdown"
            :class="{ 'flip-down': modelMenuFlipDown }"
            :style="modelMenuStyle"
            role="menu"
            @click.stop
            @keydown="handleModelDropdownKeydown"
          >
            <div class="md-list">
              <div v-if="starredOtherModels.length > 0" class="md-section">{{ t('status.starredModels') }}</div>
              <button
                v-for="m in starredOtherModels"
                :key="m.id"
                class="md-row"
                :class="{ 'is-current': m.id === status.modelId }"
                role="menuitem"
                @click="selectModel(m.id)"
              >
                <span class="md-check"><Icon v-if="m.id === status.modelId" name="check" size="sm" /></span>
                <span class="md-name">{{ m.displayName ?? m.model }}</span>
                <span class="md-provider">{{ m.provider }}</span>
                <Icon class="md-star" name="star" size="sm" />
              </button>
              <div v-if="starredOtherModels.length > 0" class="md-divider" />
              <div v-if="providerModels.length > 0" class="md-section">{{ currentProvider }}</div>
              <button
                v-for="m in providerModels"
                :key="m.id"
                class="md-row"
                :class="{ 'is-current': m.id === status.modelId }"
                role="menuitem"
                @click="selectModel(m.id)"
              >
                <span class="md-check"><Icon v-if="m.id === status.modelId" name="check" size="sm" /></span>
                <span class="md-name">{{ m.displayName ?? m.model }}</span>
                <Icon v-if="isStarred(m.id)" class="md-star" name="star" size="sm" />
              </button>
            </div>
            <div v-if="providerModels.length > 0" class="md-divider" />
            <button
              class="md-row md-row-more"
              role="menuitem"
              @click="closeDropdown(); emit('pickModel')"
            >
              <span class="md-check md-more-icon"><Icon name="list" size="sm" /></span>
              <span class="md-name">{{ t('status.moreModels') }}</span>
              <Icon class="md-more-arrow" name="chevron-right" size="sm" />
            </button>
          </div>
        </Transition>

        <Transition name="composer-menu-pop">
          <div
            v-if="thinkingDropdownOpen && status"
            ref="thinkingDropdownRef"
            class="composer-dropdown thinking-dropdown"
            :style="thinkingMenuStyle"
            role="dialog"
            :aria-label="t('composer.thinkingMenuTitle')"
            @click.stop
          >
            <div class="thinking-dropdown-title">
              <Icon name="thinking" size="sm" />
              <span>{{ t('composer.thinkingMenuTitle') }}</span>
            </div>
            <SegmentedControl
              :model-value="activeThinkingSegment"
              :options="thinkingOptions"
              size="sm"
              @update:model-value="setThinkingSegment"
            />
            <div class="thinking-cache-note">{{ t('status.cacheNote') }}</div>
          </div>
        </Transition>
      </div>
    </div>
    <div class="drop-overlay" :class="{ show: isDragOver }" aria-hidden="true">
      <div class="drop-card">
        <Icon name="file-plus" size="lg" />
        <span>{{ t('composer.dropToAttach') }}</span>
      </div>
    </div>
    <Teleport to="body">
      <BottomSheet
        :model-value="isMobile && slashOpen"
        :title="t('composer.slashSheetTitle')"
        @update:model-value="updateSlashSheet"
      >
        <div class="msheet-search">
          <Input
            ref="slashSheetSearchRef"
            v-model="slashSheetQuery"
            :placeholder="t('composer.slashSearchPlaceholder')"
            autocomplete="off"
            spellcheck="false"
            @keydown="handleKeydown"
          />
        </div>
        <SlashMenu
          id="composer-slash-menu"
          layout="sheet"
          :items="slashItems"
          :active-index="slashActive"
          :query="slashSheetQuery"
          @select="selectSlashCommand"
          @hover="slashActive = $event"
        />
      </BottomSheet>

      <BottomSheet
        :model-value="isMobile && mentionOpen"
        :title="t('composer.mentionSheetTitle')"
        @update:model-value="updateMentionSheet"
      >
        <div class="msheet-search">
          <Input
            ref="mentionSheetSearchRef"
            v-model="mentionSheetQuery"
            :placeholder="t('composer.mentionSearchPlaceholder')"
            autocomplete="off"
            spellcheck="false"
            @keydown="handleKeydown"
          />
        </div>
        <MentionMenu
          id="composer-mention-menu"
          layout="sheet"
          :items="mentionItems"
          :active-index="mentionActive"
          :loading="mentionLoading"
          :stale="mentionStale"
          @select="selectMentionItem"
          @hover="mentionActive = $event"
        />
      </BottomSheet>

      <BottomSheet
        :model-value="isMobile && modesOpen"
        @update:model-value="updateModesSheet"
      >
        <div
          ref="mobileModesMenuRef"
          class="msheet-add"
          role="menu"
          @click.stop
          @keydown="handleAddMenuKeydown"
        >
          <button
            v-for="row in addMenuRows"
            :key="row.id"
            type="button"
            class="am-row"
            role="menuitem"
            @mousedown.prevent
            @click="activateAddMenuRow(row)"
          >
            <span class="am-icon"><Icon :name="row.icon" size="sm" /></span>
            <span class="am-name">{{ t(row.nameKey) }}</span>
            <span v-if="row.descKey" class="am-desc">{{ t(row.descKey) }}</span>
          </button>
        </div>
      </BottomSheet>
    </Teleport>
  </div>
</template>

<style scoped>

.composer {
    padding: 7px var(--dock-inline-right, 16px) 12px var(--dock-inline-left, 16px);
    background: transparent;
    transition: background .12s
}


.composer.drag-over {
    background: var(--color-accent-soft)
}


.drop-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--color-bg) 72%, transparent);
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--duration-base) ease, visibility var(--duration-base)
}


.drop-overlay.show {
    opacity: 1;
    visibility: visible
}


.drop-card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-lg);
    border: .5px dashed var(--color-accent);
    background: var(--color-bg);
    color: var(--color-accent);
    font-size: var(--ui-font-size-lg);
    font-weight: var(--weight-medium);
    box-shadow: var(--shadow-md)
}


.composer-card {
    --composer-control-size: var(--space-8);
    --composer-send-size: var(--composer-control-size);
    --composer-control-inset: var(--space-2);
    --composer-valve-floor: 4em;
    --composer-valve-expand-margin: 3.4em;
    position: relative;
    border: .5px solid var(--color-composer-line);
    border-radius: var(--radius-composer);
    corner-shape: var(--corner-shape-composer);
    background: var(--color-composer-bg);
    box-shadow: var(--shadow-input);
    user-select: none;
    container-type: inline-size
}


.composer-card:after {
    content: "";
    position: absolute;
    inset: 0;
    border: inherit;
    border-color: var(--color-composer-focus-line);
    border-radius: var(--radius-composer);
    corner-shape: var(--corner-shape-composer);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-slow) var(--ease-in-out)
}


.composer-card:focus-within:after {
    opacity: 1
}


.att-strip {
    position: relative;
    padding: calc(var(--space-4) + var(--space-05)) var(--space-4) 0 calc(var(--space-4) + var(--space-05))
}


.att-scroll {
    max-height: calc(128px + var(--space-2));
    overflow-y: auto;
    margin-right: calc(var(--icon-button-sm) + var(--space-1))
}


.att-scroll-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-right: var(--space-1)
}


.att-scroll.is-overflowing {
    padding-bottom: var(--space-6)
}


.att-more {
    position: absolute;
    left: var(--space-4);
    bottom: var(--space-1);
    z-index: var(--z-raised);
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 var(--space-2);
    border: .5px solid var(--color-line);
    border-radius: var(--radius-full);
    background: var(--color-surface-raised);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    box-shadow: var(--shadow-sm);
    pointer-events: none
}


.att-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px
}


.att-row-media {
    gap: var(--space-2)
}


.att-scroll-content .att-chip {
    corner-shape: superellipse(1.5)
}


.att-scroll-content .att-tile {
    margin-left: calc(-1 * (var(--att-chip-pad-left, 5px) + var(--space-05)))
}


.att-clear {
    position: absolute;
    top: calc(var(--space-4) + var(--space-05));
    right: var(--space-4);
    z-index: var(--z-raised)
}


.file-input-hidden {
    display: none
}


.cin-wrap {
    position: relative;
    padding: 14px 16px 8px
}


.input-row {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--space-2)
}


.expand-btn {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--dim);
    cursor: pointer;
    padding: 0;
    transition: background .12s, color .12s
}


.expand-btn:hover {
    background: var(--panel2);
    color: var(--color-text)
}


.expand-btn:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px
}


.ph {
    color: var(--faint);
    caret-color: var(--color-text);
    flex: 1;
    border: none;
    outline: none;
    resize: none;
    font-family: var(--font-ui);
    font-size: var(--content-font-size);
    text-autospace: normal;
    background: transparent;
    min-height: 36px;
    max-height: 25vh;
    overflow-y: auto;
    scrollbar-width: none;
    line-height: 1.5;
    margin-bottom: 6px;
    user-select: text
}


.ph::-webkit-scrollbar {
    display: none
}


.ph::placeholder {
    color: var(--muted)
}


.ph:not(:placeholder-shown) {
    color: var(--color-text)
}


.composer.expanded .ph {
    min-height: 70vh;
    max-height: 70vh
}


.compact-chip {
    height: var(--composer-control-size);
    padding: 0 var(--space-2);
    border: .5px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-warning);
    font-family: var(--mono);
    font-size: var(--ui-font-size);
    cursor: pointer;
    line-height: 1;
    flex: none;
    transition: background var(--duration-base) var(--ease-out)
}


.compact-chip:hover {
    background: var(--color-hover)
}


.composer-attach {
    width: var(--composer-control-size);
    height: var(--composer-control-size);
    border-radius: var(--radius-full)
}


.add-menu {
    position: absolute;
    bottom: calc(100% + var(--space-2));
    left: 0;
    right: 0;
    z-index: var(--z-dropdown);
    background: var(--color-menu-bg-frost);
    -webkit-backdrop-filter: var(--p-menu-backdrop);
    backdrop-filter: var(--p-menu-backdrop);
    border: .5px solid var(--color-line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-menu);
    padding: var(--space-1-5) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--menu-rows-seam);
    font-family: var(--font-ui);
    transform-origin: bottom left
}


.am-scroll {
    max-height: var(--p-add-menu-h);
    margin: 0 calc(-1 * var(--menu-row-hug));
    padding: 0 var(--menu-row-hug);
    overflow-y: auto;
    scrollbar-width: none;
    display: flex;
    flex-direction: column;
    gap: var(--menu-rows-seam)
}


.am-scroll::-webkit-scrollbar {
    display: none
}


.scroll-thumb {
    position: absolute;
    right: var(--menu-scrollbar-edge);
    width: var(--menu-scrollbar-width);
    border-radius: var(--radius-full);
    background: var(--color-menu-scrollbar);
    transition: background var(--duration-base) var(--ease-out);
    pointer-events: none;
    z-index: var(--z-raised)
}


.add-menu:hover .scroll-thumb {
    background: var(--color-menu-scrollbar-hover)
}

.msheet-search {
    padding: 0 var(--space-4) var(--space-2)
}


.msheet-add {
    display: flex;
    flex-direction: column;
    gap: var(--menu-rows-seam);
    padding: 0 var(--menu-row-hug);
    font-family: var(--font-ui)
}


.am-row {
    display: flex;
    align-items: center;
    gap: var(--menu-row-gap-icon);
    margin: 0 calc(-1 * var(--menu-row-hug));
    padding: var(--menu-row-padding-block) var(--menu-row-padding-inline);
    border: none;
    border-radius: var(--radius-menu-row);
    background: none;
    cursor: pointer;
    font-size: var(--ui-font-size);
    color: var(--color-text);
    text-align: left;
    transition: background var(--duration-base) var(--ease-out)
}


.am-row:hover {
    background: var(--color-hover)
}


.am-row:focus-visible {
    background: var(--color-selected);
    outline: none
}


@media(hover:none) {
    .am-row {
        padding-top: var(--menu-row-touch-padding-block);
        padding-bottom: var(--menu-row-touch-padding-block)
    }
}


.am-row:hover .am-icon,
.am-row:focus-visible .am-icon {
    color: var(--color-text)
}


.am-icon {
    flex: none;
    width: var(--p-ic-sm);
    display: flex;
    justify-content: center;
    color: var(--color-text-muted);
    transition: color var(--duration-base) var(--ease-out)
}


.am-name {
    flex: none;
    font-weight: var(--weight-medium)
}


.am-desc {
    margin-left: var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--ui-font-size-sm)
}


.send {
    width: var(--composer-send-size);
    height: var(--composer-send-size);
    border-radius: var(--radius-full);
    background: var(--color-send-bg);
    color: var(--color-send-icon);
    border: none;
    box-shadow: var(--shadow-send);
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--duration-slow) var(--ease-out), transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-slow) var(--ease-out);
    position: relative
}


.send:hover:not(:disabled) {
    background: var(--color-send-bg-hover);
    box-shadow: var(--shadow-send-hover)
}


.send:active {
    transform: scale(.92)
}


.send:disabled {
    cursor: not-allowed;
    background: var(--color-send-bg-disabled);
    color: var(--color-send-icon-disabled);
    opacity: var(--opacity-send-disabled)
}


.send:disabled:active {
    transform: none
}


.send.is-starting:disabled {
    background: var(--color-send-bg);
    color: var(--color-send-icon)
}


.send.is-starting .ui-spinner {
    color: var(--color-send-icon)
}


.send.is-starting .ui-spinner__track {
    stroke: color-mix(in srgb, var(--color-send-icon) 32%, transparent)
}


.send svg {
    flex: none;
    width: var(--composer-send-icon-size);
    height: var(--composer-send-icon-size)
}


.stop {
    width: var(--composer-send-size);
    height: var(--composer-send-size);
    border-radius: var(--radius-full);
    background: var(--color-subtle);
    color: var(--color-stop-glyph);
    border: none;
    box-shadow: var(--shadow-xs);
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background .16s ease, color .16s ease, transform .12s ease
}


.stop:hover {
    background: var(--color-danger);
    color: var(--color-text-on-accent)
}


.stop:active {
    transform: scale(.92)
}


.stop .stop-square {
    display: block;
    width: 10px;
    height: 10px;
    border-radius: var(--radius-xs);
    background: currentColor
}


.toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--composer-control-inset) var(--composer-control-inset);
    position: relative
}


.menu-measure {
    position: absolute;
    width: max-content;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none
}


.toolbar-left,
.toolbar-right {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0
}


.toolbar-left {
    flex: none;
    overflow: hidden;
    padding-right: var(--space-2)
}


.toolbar-right {
    flex: 1 1 auto;
    justify-content: flex-end
}


.perm-pill,
.workflow-chip,
.model-pill,
.thinking-pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--composer-control-size);
    padding: 0 var(--space-3);
    border: .5px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: var(--ui-font-size);
    font-weight: var(--weight-medium);
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    transition: background var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out)
}


.perm-pill {
    font-size: var(--ui-font-size-sm)
}


.perm-pill:after,
.workflow-chip:after,
.model-pill:after,
.thinking-pill:after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: var(--radius-full);
    background: var(--color-hover);
    opacity: 0;
    transition: opacity var(--duration-base) var(--ease-out);
    pointer-events: none
}


.perm-pill:hover:after,
.workflow-chip:hover:after,
.model-pill:hover:after,
.thinking-pill:hover:after {
    opacity: 1
}


.perm-pill.open,
.model-pill.open,
.thinking-pill.open {
    background: var(--color-accent-soft)
}


.workflow-chip {
    cursor: default
}


.perm-pill.perm-manual {
    color: var(--dim)
}


.perm-pill.perm-yolo {
    color: var(--color-warning)
}


.perm-pill.perm-auto {
    color: var(--color-danger)
}


.perm-pill-icon {
    flex: none
}


.labels-collapsed .perm-pill {
        width: var(--composer-control-size);
        height: var(--composer-control-size);
        padding: 0;
        justify-content: center;
        flex: none
}

.labels-collapsed .perm-pill-label {
        display: none
}

.labels-collapsed .workflow-chip {
        position: relative;
        width: var(--composer-control-size);
        height: var(--composer-control-size);
        padding: 0;
        justify-content: center;
        flex: none
}

.labels-collapsed .workflow-label {
        display: none
}

.labels-collapsed .thinking-pill {
        width: var(--composer-control-size);
        padding: 0;
        justify-content: center
}

.labels-collapsed .thinking-pill-label,
.labels-collapsed .thinking-pill .cv {
        display: none
}


.ctx-group {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 2px 0;
    border-radius: var(--radius-xs)
}


.ctx-group:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px
}


.model-pill {
    gap: var(--space-1);
    line-height: var(--leading-normal);
    overflow: hidden;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 320px;
    transition: background var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out), transform var(--duration-fast) var(--ease-out)
}


.model-pill:active {
    transform: scale(.97)
}


.model-pill:focus-visible {
    outline: none;
    box-shadow: var(--p-focus-ring)
}


.model-pill .mp-name {
    flex: 0 1 auto;
    font-weight: var(--weight-medium);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0
}


.thinking-pill {
    flex: none;
    padding: 0 var(--space-2);
    color: var(--color-accent);
    font-size: var(--ui-font-size-sm);
    transition: background var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out), transform var(--duration-fast) var(--ease-out)
}


.thinking-pill:active:not(:disabled) {
    transform: scale(.97)
}


.thinking-pill:focus-visible {
    outline: none;
    box-shadow: var(--p-focus-ring)
}


.thinking-pill:disabled {
    color: var(--muted);
    cursor: default
}


.thinking-pill:disabled:hover:after {
    opacity: 0
}


.model-pill .cv,
.thinking-pill .cv {
    color: var(--faint);
    flex: none;
    transition: transform var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out)
}


.model-pill:hover .cv,
.model-pill.open .cv,
.thinking-pill:hover .cv,
.thinking-pill.open .cv {
    color: var(--dim)
}


.model-pill.open .cv,
.thinking-pill.open .cv {
    transform: rotate(180deg)
}

.model-pill.icon-only {
    width: var(--composer-control-size);
    height: var(--composer-control-size);
    padding: 0;
    justify-content: center;
    flex: none
}




.composer-dropdown {
    position: absolute;
    bottom: calc(100% + var(--space-1));
    right: calc(var(--composer-control-inset) + var(--composer-send-size) + var(--space-1));
    z-index: var(--z-dropdown);
    min-width: 200px;
    background: var(--color-menu-bg);
    -webkit-backdrop-filter: var(--p-menu-backdrop);
    backdrop-filter: var(--p-menu-backdrop);
    border: .5px solid var(--color-line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-menu);
    padding: var(--space-1);
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-family: var(--font-ui);
    transform-origin: bottom right;
    overflow-y: auto;
    overscroll-behavior: contain
}


.thinking-dropdown {
    width: 320px;
    min-width: 0;
    max-width: calc(100vw - 24px);
    padding: var(--space-3);
    gap: var(--space-3);
    overflow: hidden
}


.thinking-dropdown-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text);
    font-size: var(--ui-font-size);
    font-weight: var(--weight-semibold)
}


.thinking-dropdown .ui-seg {
    width: 100%
}


.thinking-cache-note {
    color: var(--muted);
    font-size: var(--ui-font-size-xs);
    line-height: 1.4
}


.model-dropdown.flip-down {
    top: calc(100% + var(--space-1));
    bottom: auto;
    transform-origin: top right
}


.composer-menu-pop-enter-active {
    transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out)
}


.composer-menu-pop-leave-active {
    transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
    pointer-events: none
}


.composer-menu-pop-enter-from,
.composer-menu-pop-leave-to {
    opacity: 0;
    transform: scale(.97) translateY(2px)
}


.model-dropdown.flip-down.composer-menu-pop-enter-from,
.model-dropdown.flip-down.composer-menu-pop-leave-to {
    transform: scale(.97) translateY(-2px)
}


.md-list {
    display: flex;
    flex-direction: column;
    gap: 1px
}


.md-section {
    padding: 4px 9px 2px;
    font-size: var(--text-xs);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
    font-weight: var(--weight-semibold)
}


.md-row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: var(--ui-font-size);
    color: var(--color-text);
    padding: 5px 9px;
    border-radius: 6px;
    text-align: left;
    transition: background var(--duration-base) var(--ease-out)
}


.md-row:hover {
    background: var(--color-hover)
}


.md-row:hover .md-name {
    color: var(--color-text-strong)
}


.md-row:focus-visible {
    outline: none;
    box-shadow: var(--p-focus-ring)
}


.md-row:disabled {
    cursor: default;
    opacity: .58
}


.md-row:disabled:hover {
    background: none
}


.md-row.is-current {
    background: var(--color-selected)
}


.md-note {
    margin-left: auto;
    color: var(--muted);
    font-size: var(--ui-font-size-xs)
}


.md-row-more .md-more-icon {
    color: var(--dim)
}


.md-row-more .md-more-arrow {
    color: var(--faint);
    flex: none;
    transition: color var(--duration-base) var(--ease-out)
}


.md-row-more:hover .md-more-arrow {
    color: var(--dim)
}


.md-check {
    width: 14px;
    flex: none;
    color: var(--color-accent);
    font-weight: 500;
    display: flex;
    justify-content: center
}


.md-name {
    flex: 1;
    transition: color var(--duration-base) var(--ease-out)
}


.md-provider {
    color: var(--muted);
    font-size: var(--ui-font-size-xs);
    flex: none
}


.md-star {
    color: var(--star);
    flex: none;
    margin-left: auto
}


.md-divider {
    height: 1px;
    background: var(--line);
    margin: 3px 0
}


.perm-dropdown {
    position: absolute;
    bottom: calc(100% + 4px);
    left: var(--composer-control-inset);
    z-index: var(--z-dropdown);
    min-width: 220px;
    width: max-content;
    max-width: calc(100vw - var(--space-8));
    background: var(--color-menu-bg);
    -webkit-backdrop-filter: var(--p-menu-backdrop);
    backdrop-filter: var(--p-menu-backdrop);
    border: .5px solid var(--color-line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-menu);
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    transform-origin: bottom left
}


.pd-row {
    display: grid;
    grid-template-columns: var(--p-ic-md) var(--composer-menu-desc-width, max-content) var(--p-ic-sm);
    column-gap: 7px;
    row-gap: 2px;
    align-items: start;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 7px;
    border-radius: 6px;
    text-align: left
}


.pd-row:hover,
.pd-row.is-current {
    background: var(--color-hover)
}


.pd-icon {
    grid-column: 1;
    grid-row: 1;
    width: var(--p-ic-md);
    min-height: 1lh;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: var(--leading-tight)
}


.pd-check {
    grid-column: 3;
    grid-row: 1;
    width: var(--p-ic-sm);
    min-height: 1lh;
    color: var(--color-accent);
    font-size: var(--ui-font-size);
    font-weight: var(--weight-medium);
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: var(--leading-tight)
}


.pd-info {
    display: contents
}


.pd-name {
    grid-column: 2;
    grid-row: 1;
    font-family: var(--font-ui);
    font-size: var(--ui-font-size-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-tight)
}


.pd-desc {
    grid-column: 2;
    grid-row: 2;
    width: var(--composer-menu-desc-width, auto);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-caption);
    color: var(--muted);
    line-height: var(--leading-tight)
}


.wm-pill {
    position: absolute;
    top: 0;
    left: 0;
    margin-left: calc(-1 * var(--space-05));
    z-index: var(--z-raised);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: calc(var(--content-font-size) * 1.5);
    padding: 0 calc((var(--content-font-size) * 1.5 - var(--wm-x-size)) / 2) 0 var(--space-2);
    border: none;
    border-radius: var(--radius-full);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: var(--ui-font-size-sm);
    font-weight: var(--weight-medium);
    line-height: calc(var(--content-font-size) * 1.5);
    white-space: nowrap;
    user-select: none
}


.wm-x,
.workflow-x {
    position: relative;
    width: var(--wm-x-size);
    height: var(--wm-x-size);
    border-radius: var(--radius-full)
}


.wm-x:before,
.workflow-x:before {
    content: "";
    position: absolute;
    inset: calc(-1 * var(--wm-x-ring))
}


@media(hover:none) {
    .wm-x:before,
    .workflow-x:before {
        inset: calc((var(--wm-x-size) - var(--touch-target-min)) / 2)
    }
}


@media(max-width:980px) {
    .perm-pill {
        max-width: 104px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap
    }
}


@media(max-width:640px) {
    .composer {
        padding: 9px var(--dock-inline-right, max(12px, var(--safe-right))) max(24px, var(--safe-bottom)) var(--dock-inline-left, max(12px, var(--safe-left)))
    }

    .composer-card {
        --composer-control-size: 36px;
        max-width: 100%
    }

    .input-row {
        gap: 6px;
        min-width: 0
    }

    .send {
        width: var(--composer-send-size);
        height: var(--composer-send-size);
        min-width: var(--composer-send-size);
        padding: 0;
        border-radius: var(--radius-full);
        font-size: 0;
        align-self: flex-end;
        position: relative
    }

    .send svg {
        display: none
    }

    .send:after {
        content: "↑";
        font-size: 17px;
        line-height: 1;
        color: var(--bg)
    }

    .stop {
        width: var(--composer-send-size);
        height: var(--composer-send-size);
        min-width: var(--composer-send-size);
        padding: 0;
        border-radius: var(--radius-full);
        font-size: 0;
        align-self: flex-end;
        position: relative
    }

    .stop .stop-square {
        width: 12px;
        height: 12px
    }

    .perm-pill,
    .wm-pill {
        display: none
    }

    .model-dropdown {
        right: calc(var(--composer-control-inset) + var(--composer-send-size) + var(--space-1));
        left: auto;
        min-width: 180px;
        max-width: calc(100vw - 24px)
    }

    .thinking-dropdown {
        max-width: calc(100vw - 24px)
    }

    .ph {
        font-size: 16px
    }

    .model-pill,
    .thinking-pill,
    .attach-btn {
        font-size: var(--ui-font-size)
    }

    .toolbar {
        gap: 6px;
        min-width: 0
    }

    .toolbar-left,
    .toolbar-right {
        min-width: 0
    }

    .model-pill {
        max-width: min(52vw, 220px)
    }

    .model-pill .mp-name {
        max-width: min(40vw, 170px)
    }

    .md-row,
    .md-section {
        font-size: var(--ui-font-size)
    }

    .pd-name {
        font-size: var(--ui-font-size)
    }

    .pd-desc {
        font-size: var(--text-xs)
    }
}
.att-lightbox {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(20, 23, 28, 0.62);
}
.att-lightbox-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: min(960px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
}
.att-lightbox-media {
  max-width: 100%;
  max-height: calc(100vh - 96px);
  border-radius: 6px;
  background: var(--bg);
  box-shadow: var(--shadow-xl);
  object-fit: contain;
}
.att-lightbox-name {
  max-width: 100%;
  color: var(--surface-light);
  font-family: var(--mono);
  font-size: calc(var(--ui-font-size) - 2px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-lightbox-close {
  position: absolute;
  top: -14px;
  right: -14px;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255,255,255,0.45);
  border-radius: 50%;
  background: rgba(20,23,28,0.82);
  color: var(--surface-light);
  cursor: pointer;
}
</style>
