<!-- apps/pythinker-web/src/components/QuestionCard.vue -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UIQuestion } from '../types';
import type { QuestionAnswer, QuestionResponse } from '../api/types';
import Markdown from './Markdown.vue';

const props = defineProps<{ question: UIQuestion }>();

const { t } = useI18n();

const emit = defineEmits<{
  answer: [questionId: string, response: QuestionResponse];
  dismiss: [questionId: string];
}>();

// ---------------------------------------------------------------------------
// Multi-question navigation
// ---------------------------------------------------------------------------

const step = ref(0);

// Temporarily collapse the card to a thin bar so it stops covering the chat
// while the user reads. State is local — answers/step are kept either way.
const minimized = ref(false);

const current = computed(() => props.question.questions[step.value]!);
const total = computed(() => props.question.questions.length);
const hasPreview = computed(() =>
  current.value.options.some((option) => option.preview?.trim()),
);
const now = ref(Date.now());
const remainingMinutes = computed(() => {
  const expiresAt = Date.parse(props.question.expiresAt);
  if (Number.isNaN(expiresAt)) return undefined;
  return Math.ceil((expiresAt - now.value) / 60_000);
});
const leaseWarning = computed(() => {
  const expiresAt = Date.parse(props.question.expiresAt);
  if (Number.isNaN(expiresAt)) return undefined;
  const remainingMs = expiresAt - now.value;
  if (remainingMs <= 0 || remainingMs > 5 * 60_000) return undefined;
  if (remainingMs < 60_000) return t('question.expiresSoonSeconds');
  const minutes = remainingMinutes.value;
  if (minutes === undefined) return undefined;
  return t('question.expiresSoon', { minutes });
});

function goBack(): void {
  if (step.value > 0) step.value--;
}

function goNext(): void {
  if (step.value < total.value - 1) step.value++;
}

// ---------------------------------------------------------------------------
// Per-question answers: Record<questionId, QuestionAnswer>
// ---------------------------------------------------------------------------

const answers = ref<Record<string, QuestionAnswer>>({});
const notes = ref<Record<string, string>>({});
const previewOption = computed(() => {
  const question = current.value;
  const answer = answers.value[question.id];
  const selectedId =
    answer?.kind === 'single'
      ? answer.optionId
      : answer?.kind === 'multi' || answer?.kind === 'multiWithOther'
        ? answer.optionIds[0]
        : undefined;
  return (
    question.options.find(
      (option) => option.id === selectedId && option.preview?.trim(),
    ) ?? question.options.find((option) => option.preview?.trim())
  );
});

function isRecommendedOption(option: { label: string; description?: string; recommended?: boolean }): boolean {
  if (option.recommended === true) return true;
  return /\b(?:recommended|recommend)\b/.test(`${option.label} ${option.description ?? ''}`.toLowerCase());
}

function seedRecommendedAnswers(): void {
  const next = { ...answers.value };
  let changed = false;
  for (const q of props.question.questions) {
    if (next[q.id]) continue;
    const recommended = q.options.filter(isRecommendedOption);
    if (recommended.length === 0) continue;
    next[q.id] = q.multiSelect
      ? { kind: 'multi', optionIds: recommended.map((option) => option.id) }
      : { kind: 'single', optionId: recommended[0]!.id };
    changed = true;
  }
  if (changed) answers.value = next;
}

watch(
  () => props.question.questionId,
  () => {
    step.value = 0;
    minimized.value = false;
    answers.value = {};
    otherTexts.value = {};
    notes.value = {};
  },
);

watch(
  () => props.question,
  () => {
    if (step.value >= props.question.questions.length) step.value = 0;
    seedRecommendedAnswers();
  },
  { immediate: true, deep: true },
);

// Single-select: pick one optionId
function pickSingle(qid: string, optionId: string): void {
  const cur = answers.value[qid];
  // toggle off if already selected (allow deselect)
  if (cur && cur.kind === 'single' && cur.optionId === optionId) {
    const next = { ...answers.value };
    delete next[qid];
    answers.value = next;
  } else {
    answers.value = { ...answers.value, [qid]: { kind: 'single', optionId } };
  }
}

// Multi-select: toggle an optionId
function toggleMulti(qid: string, optionId: string): void {
  const cur = answers.value[qid];
  const ids: string[] = cur && (cur.kind === 'multi' || cur.kind === 'multiWithOther')
    ? (cur.kind === 'multi' ? [...cur.optionIds] : [...cur.optionIds])
    : [];
  const idx = ids.indexOf(optionId);
  if (idx >= 0) { ids.splice(idx, 1); } else { ids.push(optionId); }

  const existing = answers.value[qid];
  const otherText = existing && existing.kind === 'multiWithOther' ? existing.otherText : '';
  if (otherText) {
    answers.value = { ...answers.value, [qid]: { kind: 'multiWithOther', optionIds: ids, otherText } };
  } else {
    answers.value = { ...answers.value, [qid]: { kind: 'multi', optionIds: ids } };
  }
}

// "Other" text input (single)
const otherTexts = ref<Record<string, string>>({});

function pickOther(qid: string): void {
  const q = props.question.questions.find((qi) => qi.id === qid)!;
  const text = otherTexts.value[qid] ?? '';
  if (q.multiSelect) {
    const cur = answers.value[qid];
    const ids: string[] = cur && (cur.kind === 'multi' || cur.kind === 'multiWithOther')
      ? (cur.kind === 'multi' ? [...cur.optionIds] : [...cur.optionIds])
      : [];
    answers.value = { ...answers.value, [qid]: { kind: 'multiWithOther', optionIds: ids, otherText: text } };
  } else {
    answers.value = { ...answers.value, [qid]: { kind: 'other', text } };
  }
}

function isSelected(qid: string, optionId: string): boolean {
  const cur = answers.value[qid];
  if (!cur) return false;
  if (cur.kind === 'single') return cur.optionId === optionId;
  if (cur.kind === 'multi') return cur.optionIds.includes(optionId);
  if (cur.kind === 'multiWithOther') return cur.optionIds.includes(optionId);
  return false;
}

function isOtherSelected(qid: string): boolean {
  const cur = answers.value[qid];
  return !!(cur && (cur.kind === 'other' || cur.kind === 'multiWithOther'));
}

function canSubmit(): boolean {
  // All questions must have an answer
  return props.question.questions.every((qi) => {
    const a = answers.value[qi.id];
    if (!a) return false;
    if (a.kind === 'multi') return a.optionIds.length > 0;
    if (a.kind === 'multiWithOther') return a.optionIds.length > 0 || a.otherText.trim().length > 0;
    if (a.kind === 'other') return a.text.trim().length > 0;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Submit / dismiss
// ---------------------------------------------------------------------------

function submit(): void {
  if (!canSubmit()) return;
  const annotations: Record<string, { preview?: string; notes?: string }> = {};
  for (const question of props.question.questions) {
    const answer = answers.value[question.id];
    const selectedId = answer?.kind === 'single' ? answer.optionId : undefined;
    const preview = question.options.find((option) => option.id === selectedId)?.preview;
    const questionNotes = notes.value[question.id]?.trim();
    if ((preview !== undefined && preview.length > 0) || (questionNotes !== undefined && questionNotes.length > 0)) {
      annotations[question.question] = {
        preview,
        notes: questionNotes?.length ? questionNotes : undefined,
      };
    }
  }
  const response: QuestionResponse = {
    answers: answers.value,
    method: 'click',
    annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
  };
  emit('answer', props.question.questionId, response);
}

function dismiss(): void {
  emit('dismiss', props.question.questionId);
}

// ---------------------------------------------------------------------------
// Keyboard: number keys pick options for the current question and Enter submits.
// ---------------------------------------------------------------------------

function handleKeydown(e: KeyboardEvent): void {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  // While minimized the options are not visible, so keyboard selection is disabled.
  if (minimized.value) return;

  if (e.key === 'Enter') { e.preventDefault(); submit(); return; }

  const num = parseInt(e.key, 10);
  if (!isNaN(num) && num >= 1 && num <= 9) {
    e.preventDefault();
    const q = current.value;
    const optIdx = num - 1;
    const opt = q.options[optIdx];
    if (opt) {
      if (q.multiSelect) {
        toggleMulti(q.id, opt.id);
      } else {
        pickSingle(q.id, opt.id);
      }
    }
  }
}

let leaseTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  leaseTimer = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (leaseTimer !== undefined) clearInterval(leaseTimer);
});
</script>

<template>
  <div class="qcard" :class="{ minimized }">
    <!-- Step indicator (multi-question) -->
    <div class="qh">
      <span class="qtitle">{{ t('question.title') }}</span>
      <span v-if="leaseWarning" class="qexpires">{{ leaseWarning }}</span>
      <template v-if="total > 1 && !minimized">
        <span class="qstep">{{ t('question.step', { current: step + 1, total }) }}</span>
        <button class="qnav" :disabled="step === 0" @click="goBack">{{ t('question.prev') }}</button>
        <button class="qnav" :disabled="step === total - 1" @click="goNext">{{ t('question.next') }}</button>
      </template>
      <!-- When minimized, surface the question text so the bar stays identifiable -->
      <span v-if="minimized" class="qmin-peek">{{ current.question }}</span>
      <button
        class="qmin"
        :title="minimized ? t('question.expand') : t('question.minimize')"
        :aria-label="minimized ? t('question.expand') : t('question.minimize')"
        @click="minimized = !minimized"
      >
        <svg v-if="minimized" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 10l5-5 5 5"/></svg>
        <svg v-else viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 8h10"/></svg>
      </button>
    </div>

    <!-- Current question -->
    <div v-if="!minimized" class="qbody">
      <!-- Header chip -->
      <div v-if="current.header" class="qheader-chip">{{ current.header }}</div>

      <!-- Question text -->
      <div class="qtext">{{ current.question }}</div>

      <!-- Body markdown -->
      <Markdown v-if="current.body" :text="current.body" class="qmdbody" />

      <div class="qchoice-layout" :class="{ 'with-preview': hasPreview }">
        <!-- Options -->
        <div class="qopts">
          <label
            v-for="(opt, oi) in current.options"
            :key="opt.id"
            class="qopt"
            :class="{ selected: isSelected(current.id, opt.id) }"
            @click.prevent="current.multiSelect ? toggleMulti(current.id, opt.id) : pickSingle(current.id, opt.id)"
          >
            <span class="qopt-key">{{ oi + 1 }}</span>
            <span class="qopt-glyph">
              <template v-if="current.multiSelect">
                <span class="chk">{{ isSelected(current.id, opt.id) ? '■' : '□' }}</span>
              </template>
              <template v-else>
                <span class="rad">{{ isSelected(current.id, opt.id) ? '●' : '○' }}</span>
              </template>
            </span>
            <span class="qopt-text">
              <span class="qopt-label">{{ opt.label }}</span>
              <span v-if="opt.description" class="qopt-desc">{{ opt.description }}</span>
            </span>
          </label>

          <!-- Other option -->
          <label
            v-if="current.allowOther && !hasPreview"
            class="qopt"
            :class="{ selected: isOtherSelected(current.id) }"
            @click.prevent="() => {}"
          >
            <span class="qopt-key"></span>
            <span class="qopt-glyph">
              <template v-if="current.multiSelect">
                <span class="chk">{{ isOtherSelected(current.id) ? '■' : '□' }}</span>
              </template>
              <template v-else>
                <span class="rad">{{ isOtherSelected(current.id) ? '●' : '○' }}</span>
              </template>
            </span>
            <span class="qopt-label">{{ current.otherLabel ?? t('question.otherDefault') }}</span>
            <input
              v-model="otherTexts[current.id]"
              class="other-input"
              type="text"
              :placeholder="current.otherLabel ?? t('question.otherDefault')"
              @input="pickOther(current.id)"
              @focus="pickOther(current.id)"
            />
          </label>
        </div>

        <div v-if="hasPreview && previewOption?.preview" class="qpreview">
          <Markdown :text="previewOption.preview" />
          <label class="qnotes">
            <span>{{ t('question.notes') }}</span>
            <textarea
              v-model="notes[current.id]"
              class="qnotes-input"
              rows="2"
              :placeholder="t('question.notesPlaceholder')"
            />
          </label>
        </div>
      </div>
    </div>

    <!-- Action buttons -->
    <div v-if="!minimized" class="qfooter">
      <button class="qbtn pri" :disabled="!canSubmit()" @click="submit">{{ t('question.submit') }}</button>
      <button class="qbtn" @click="dismiss">{{ t('question.dismiss') }}</button>
    </div>
  </div>
</template>

<style scoped>
.qcard {
  border: 1px solid var(--bd);
  border-radius: 3px;
  background: var(--bg);
  margin: 8px 0;
}

/* Header row */
.qh {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--soft);
  border-bottom: 1px solid var(--bd);
  border-radius: 3px 3px 0 0;
  font-size: var(--ui-font-size);
}
.qtitle { color: var(--blue2); font-weight: 700; }
.qstep { color: var(--muted); font-size: calc(var(--ui-font-size) - 3px); margin-left: 4px; }
.qexpires { color: var(--muted); font-size: calc(var(--ui-font-size) - 3px); margin-left: 4px; }
.qnav {
  font-family: var(--mono);
  font-size: calc(var(--ui-font-size) - 3px);
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--bg);
  color: var(--dim);
  cursor: pointer;
}
.qnav:disabled { color: var(--faint); cursor: default; }
.qnav:not(:disabled):hover { background: var(--panel2); }

/* Minimize toggle — pinned to the right of the header row. */
.qmin {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--bg);
  color: var(--dim);
  cursor: pointer;
}
.qmin:hover { background: var(--panel2); color: var(--blue); }
/* Question preview shown only while minimized — truncated to one line. */
.qmin-peek {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dim);
  font-size: var(--ui-font-size-xs);
  font-weight: 400;
}
.qcard.minimized { margin: 8px 0; }
.qcard.minimized .qh { border-bottom: none; border-radius: 3px; }

/* Body */
.qbody { padding: 12px 14px; }

.qheader-chip {
  display: inline-block;
  font-size: max(9px, calc(var(--ui-font-size) - 3.5px));
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--panel2);
  color: var(--dim);
  margin-bottom: 8px;
  letter-spacing: 0.03em;
}

.qtext {
  font-size: var(--ui-font-size-sm);
  color: var(--ink);
  font-weight: 600;
  margin-bottom: 6px;
  line-height: 1.4;
}

.qmdbody { margin-bottom: 8px; }

/* Options */
.qchoice-layout { margin-top: 8px; }
.qchoice-layout.with-preview {
  display: grid;
  grid-template-columns: minmax(220px, 2fr) minmax(280px, 3fr);
  gap: 10px;
  align-items: start;
}
.qopts { display: flex; flex-direction: column; gap: 4px; }
.qpreview {
  min-width: 0;
  max-height: 420px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--panel);
}
.qnotes {
  display: grid;
  gap: 5px;
  margin-top: 10px;
  color: var(--muted);
  font-size: var(--ui-font-size-xs);
}
.qnotes-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 52px;
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  outline: none;
  color: var(--text);
  background: var(--bg);
  font: inherit;
}
.qnotes-input:focus-visible {
  border-color: var(--blue);
  box-shadow: 0 0 0 1px var(--blue);
}

.qopt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 3px;
  cursor: pointer;
  font-size: calc(var(--ui-font-size) - 1.5px);
  transition: background 0.1s;
  user-select: none;
}
.qopt:hover { background: var(--panel); }
.qopt.selected { border-color: var(--blue); background: var(--soft); }

.qopt-key {
  color: var(--faint);
  font-size: max(9px, calc(var(--ui-font-size) - 4px));
  width: 12px;
  flex: none;
  text-align: center;
}
.qopt-glyph { color: var(--blue2); font-size: var(--ui-font-size-sm); flex: none; }
/* Label + description stack vertically (top-to-bottom) so a long description
   never squeezes the label sideways into a thin, many-line column. */
.qopt-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.qopt-label { color: var(--text); }
.qopt-desc { color: var(--muted); font-size: calc(var(--ui-font-size) - 3px); line-height: 1.45; }

.chk { font-family: var(--mono); }
.rad { font-family: var(--mono); }

.other-input {
  flex: 1;
  font-family: var(--mono);
  font-size: var(--ui-font-size);
  border: none;
  border-bottom: 1px solid var(--line);
  outline: none;
  padding: 2px 4px;
  color: var(--text);
  background: transparent;
  min-width: 0;
}
.other-input:focus-visible {
  border-bottom-color: var(--blue);
  box-shadow: 0 1px 0 0 var(--blue);
}


/* Footer */
.qfooter {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
}
.qbtn {
  font-family: var(--mono);
  font-size: var(--ui-font-size-xs);
  padding: 6px 16px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.qbtn:hover:not(:disabled) { background: var(--panel2); }
.qbtn.pri {
  background: var(--blue);
  color: var(--bg);
  border-color: var(--blue);
}
.qbtn.pri:hover:not(:disabled) { background: var(--blue2); }
.qbtn:disabled { opacity: 0.45; cursor: default; }

/* =========================================================================
   MOBILE (≤640px): bigger option taps, comfortable nav, and full-width footer
   buttons that are ≥44px tall so Submit/Dismiss are easy to hit. The card is
   already full-width inside ConversationPane; we only resize controls.
   ========================================================================= */
@media (max-width: 640px) {
  .qh { padding: 9px 12px; flex-wrap: wrap; row-gap: 6px; }
  .qnav { min-height: 34px; padding: 5px 12px; font-size: var(--ui-font-size-xs); border-radius: 6px; }

  .qbody { padding: 14px; }
  .qtext { font-size: var(--ui-font-size); }
  .qchoice-layout.with-preview { grid-template-columns: 1fr; }
  .qpreview { max-height: 300px; }

  /* Options → taller, finger-friendly rows. Label + description already stack
     via .qopt-text, so no flex-wrap hack is needed. */
  .qopt {
    min-height: 44px;
    padding: 10px 12px;
    font-size: calc(var(--ui-font-size) - 0.5px);
    border-radius: 8px;
  }
  .qopt-desc { font-size: var(--ui-font-size-xs); }
  .other-input { flex-basis: 100%; min-height: 28px; }

  /* Footer → full-width stacked buttons, Submit on top. */
  .qfooter { flex-direction: column; gap: 8px; padding: 12px 14px max(14px, env(safe-area-inset-bottom)); }
  .qbtn {
    width: 100%;
    min-height: 46px;
    font-size: var(--ui-font-size);
    border-radius: 8px;
  }
}
</style>
