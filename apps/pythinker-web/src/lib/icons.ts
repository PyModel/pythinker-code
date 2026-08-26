// apps/pythinker-web/src/lib/icons.ts
// Single source of truth for apps/pythinker-web icons (design-system §02).
//
// Icons come from three collections, all bundled by unplugin-icons at build
// time — only the icons listed below end up in the production bundle:
//   - `~icons/pythinker/*` — Pythinker Design System icons (24×24 outlined,
//     fill="currentColor"), local SVGs under src/icons/pythinker/ registered as a
//     custom collection in vite.config.ts. Preferred when a Pythinker icon exists
//     for the intent.
//   - `~icons/tabler/*` — Tabler Icons (https://tabler.io/icons, MIT),
//     24×24 stroke-based (stroke="currentColor"); used for the sidebar
//     panel toggle, which neither pack above covers well.
//   - `~icons/ri/*` — Remix Icon (https://remixicon.com/, Apache-2.0) for
//     the remaining intents.
// Each static icon is imported twice: once as a Vue component (for
// <Icon name=... />) and once as a `?raw` SVG string (for iconSvg() in v-html
// contexts such as lib/toolMeta.ts). Self-animated icons are raw-only — see
// animatedEntry() below.
//
// All collections share the 24x24 source grid and follow currentColor; the
// rendered size comes from the size token prop. Colour follows text.
//
// Two consumers share this registry:
//   - the <Icon> Vue component (components/ui/Icon.vue) for template use;
//   - iconSvg() below, for v-html contexts (e.g. lib/toolMeta.ts).

import type { Component } from 'vue';
import { fileIconSvg } from './fileIcons';

// Components (Pythinker collection) ----------------------------------------------
import PythinkerAddConversation from '~icons/pythinker/add-conversation';
import PythinkerFolder from '~icons/pythinker/folder';
import PythinkerMore from '~icons/pythinker/more';
import PythinkerThinking from '~icons/pythinker/thinking';

// Components (Tabler) ---------------------------------------------------------
import TablerCircleCheck from '~icons/tabler/circle-check';
import TablerCircleDashed from '~icons/tabler/circle-dashed';
import TablerSidebarLeftCollapse from '~icons/tabler/layout-sidebar-left-collapse';
import TablerSidebarLeftExpand from '~icons/tabler/layout-sidebar-left-expand';
import TablerPaperclip from '~icons/tabler/paperclip';

// Components (Remix) ---------------------------------------------------------
import RiAddLine from '~icons/ri/add-line';
import RiAiGenerate from '~icons/ri/ai-generate';
import RiAlertLine from '~icons/ri/alert-line';
import RiArchiveLine from '~icons/ri/archive-line';
import RiArrowDownLine from '~icons/ri/arrow-down-line';
import RiArrowDownSLine from '~icons/ri/arrow-down-s-line';
import RiArrowGoBackLine from '~icons/ri/arrow-go-back-line';
import RiArrowRightLine from '~icons/ri/arrow-right-line';
import RiArrowRightSLine from '~icons/ri/arrow-right-s-line';
import RiArrowUpLine from '~icons/ri/arrow-up-line';
import RiArrowUpSLine from '~icons/ri/arrow-up-s-line';
import RiBracesLine from '~icons/ri/braces-line';
import RiCalendarCloseLine from '~icons/ri/calendar-close-line';
import RiCalendarScheduleLine from '~icons/ri/calendar-schedule-line';
import RiCalendarTodoLine from '~icons/ri/calendar-todo-line';
import RiCheckLine from '~icons/ri/check-line';
import RiCloseLine from '~icons/ri/close-line';
import RiCodeLine from '~icons/ri/code-line';
import RiCollapseDiagonalLine from '~icons/ri/collapse-diagonal-line';
import RiDeleteBinLine from '~icons/ri/delete-bin-line';
import RiDownloadLine from '~icons/ri/download-line';
import RiDraggable from '~icons/ri/draggable';
import RiEqualizerLine from '~icons/ri/equalizer-line';
import RiExpandDiagonalLine from '~icons/ri/expand-diagonal-line';
import RiExternalLinkLine from '~icons/ri/external-link-line';
import RiEyeLine from '~icons/ri/eye-line';
import RiEyeOffLine from '~icons/ri/eye-off-line';
import RiFileAddLine from '~icons/ri/file-add-line';
import RiFileCopyLine from '~icons/ri/file-copy-line';
import RiFileEditLine from '~icons/ri/file-edit-line';
import RiFileLine from '~icons/ri/file-line';
import RiFileTextLine from '~icons/ri/file-text-line';
import RiFlaskLine from '~icons/ri/flask-line';
import RiFlashlightLine from '~icons/ri/flashlight-line';
import RiFolderAddLine from '~icons/ri/folder-add-line';
import RiFolderFill from '~icons/ri/folder-fill';
import RiGitForkLine from '~icons/ri/git-fork-line';
import RiGitPullRequestLine from '~icons/ri/git-pull-request-line';
import RiFingerprintLine from '~icons/ri/fingerprint-line';
import RiGlobalLine from '~icons/ri/global-line';
import RiImageLine from '~icons/ri/image-line';
import RiInformationLine from '~icons/ri/information-line';
import RiLinksLine from '~icons/ri/links-line';
import RiListCheck from '~icons/ri/list-check';
import RiListUnordered from '~icons/ri/list-unordered';
import RiLoginBoxLine from '~icons/ri/login-box-line';
import RiMailLine from '~icons/ri/mail-line';
import RiMessageLine from '~icons/ri/message-line';
import RiMicroscopeLine from '~icons/ri/microscope-line';
import RiPauseFill from '~icons/ri/pause-fill';
import RiPencilLine from '~icons/ri/pencil-line';
import RiPlayFill from '~icons/ri/play-fill';
import RiPushpinFill from '~icons/ri/pushpin-fill';
import RiPushpinLine from '~icons/ri/pushpin-line';
import RiQuestionLine from '~icons/ri/question-line';
import RiShieldFlashLine from '~icons/ri/shield-flash-line';
import RiShieldLine from '~icons/ri/shield-line';
import RiShutDownLine from '~icons/ri/shut-down-line';
import RiSortDesc from '~icons/ri/sort-desc';
import RiSparklingLine from '~icons/ri/sparkling-line';
import RiStarFill from '~icons/ri/star-fill';
import RiStarLine from '~icons/ri/star-line';
import RiStopFill from '~icons/ri/stop-fill';
import RiSubtractLine from '~icons/ri/subtract-line';
import RiTargetLine from '~icons/ri/target-line';
import RiTimeLine from '~icons/ri/time-line';
import RiToolsLine from '~icons/ri/tools-line';
import RiUserLine from '~icons/ri/user-line';

// Raw SVG strings (Pythinker collection) -----------------------------------------
import RawPythinkerAddConversation from '~icons/pythinker/add-conversation?raw';
import RawPythinkerCuteBot from '~icons/pythinker/cute-bot?raw';
import RawPythinkerFolder from '~icons/pythinker/folder?raw';
import RawPythinkerFolderOpen from '~icons/pythinker/folder-open?raw';
import RawPythinkerLoadingSpinner from '~icons/pythinker/loading-spinner?raw';
import RawPythinkerMore from '~icons/pythinker/more?raw';
import RawPythinkerSearch from '~icons/pythinker/search?raw';
import RawPythinkerSetting from '~icons/pythinker/setting?raw';
import RawPythinkerTerminal from '~icons/pythinker/terminal?raw';
import RawPythinkerThinking from '~icons/pythinker/thinking?raw';
import RawPythinkerUpdateButton from '~icons/pythinker/update_button?raw';
import RawPythinkerUpdateIcon from '~icons/pythinker/update_icon?raw';

// Raw SVG strings (Tabler) ----------------------------------------------------
import RawTablerCircleCheck from '~icons/tabler/circle-check?raw';
import RawTablerCircleDashed from '~icons/tabler/circle-dashed?raw';
import RawTablerSidebarLeftCollapse from '~icons/tabler/layout-sidebar-left-collapse?raw';
import RawTablerSidebarLeftExpand from '~icons/tabler/layout-sidebar-left-expand?raw';
import RawTablerPaperclip from '~icons/tabler/paperclip?raw';

// Raw SVG strings (Remix) ----------------------------------------------------
import RawAddLine from '~icons/ri/add-line?raw';
import RawAiGenerate from '~icons/ri/ai-generate?raw';
import RawAlertLine from '~icons/ri/alert-line?raw';
import RawArchiveLine from '~icons/ri/archive-line?raw';
import RawArrowDownLine from '~icons/ri/arrow-down-line?raw';
import RawArrowDownSLine from '~icons/ri/arrow-down-s-line?raw';
import RawArrowGoBackLine from '~icons/ri/arrow-go-back-line?raw';
import RawArrowRightLine from '~icons/ri/arrow-right-line?raw';
import RawArrowRightSLine from '~icons/ri/arrow-right-s-line?raw';
import RawArrowUpLine from '~icons/ri/arrow-up-line?raw';
import RawArrowUpSLine from '~icons/ri/arrow-up-s-line?raw';
import RawBracesLine from '~icons/ri/braces-line?raw';
import RawCalendarCloseLine from '~icons/ri/calendar-close-line?raw';
import RawCalendarScheduleLine from '~icons/ri/calendar-schedule-line?raw';
import RawCalendarTodoLine from '~icons/ri/calendar-todo-line?raw';
import RawCheckLine from '~icons/ri/check-line?raw';
import RawCloseLine from '~icons/ri/close-line?raw';
import RawCodeLine from '~icons/ri/code-line?raw';
import RawCollapseDiagonalLine from '~icons/ri/collapse-diagonal-line?raw';
import RawDeleteBinLine from '~icons/ri/delete-bin-line?raw';
import RawDownloadLine from '~icons/ri/download-line?raw';
import RawDraggable from '~icons/ri/draggable?raw';
import RawEqualizerLine from '~icons/ri/equalizer-line?raw';
import RawExpandDiagonalLine from '~icons/ri/expand-diagonal-line?raw';
import RawExternalLinkLine from '~icons/ri/external-link-line?raw';
import RawEyeLine from '~icons/ri/eye-line?raw';
import RawEyeOffLine from '~icons/ri/eye-off-line?raw';
import RawFileAddLine from '~icons/ri/file-add-line?raw';
import RawFileCopyLine from '~icons/ri/file-copy-line?raw';
import RawFileEditLine from '~icons/ri/file-edit-line?raw';
import RawFileLine from '~icons/ri/file-line?raw';
import RawFileTextLine from '~icons/ri/file-text-line?raw';
import RawFlaskLine from '~icons/ri/flask-line?raw';
import RawFlashlightLine from '~icons/ri/flashlight-line?raw';
import RawFolderAddLine from '~icons/ri/folder-add-line?raw';
import RawFolderFill from '~icons/ri/folder-fill?raw';
import RawGitForkLine from '~icons/ri/git-fork-line?raw';
import RawGitPullRequestLine from '~icons/ri/git-pull-request-line?raw';
import RawFingerprintLine from '~icons/ri/fingerprint-line?raw';
import RawGlobalLine from '~icons/ri/global-line?raw';
import RawImageLine from '~icons/ri/image-line?raw';
import RawInformationLine from '~icons/ri/information-line?raw';
import RawLinksLine from '~icons/ri/links-line?raw';
import RawListCheck from '~icons/ri/list-check?raw';
import RawListUnordered from '~icons/ri/list-unordered?raw';
import RawLoginBoxLine from '~icons/ri/login-box-line?raw';
import RawMailLine from '~icons/ri/mail-line?raw';
import RawMessageLine from '~icons/ri/message-line?raw';
import RawMicroscopeLine from '~icons/ri/microscope-line?raw';
import RawPauseFill from '~icons/ri/pause-fill?raw';
import RawPencilLine from '~icons/ri/pencil-line?raw';
import RawPlayFill from '~icons/ri/play-fill?raw';
import RawPushpinFill from '~icons/ri/pushpin-fill?raw';
import RawPushpinLine from '~icons/ri/pushpin-line?raw';
import RawQuestionLine from '~icons/ri/question-line?raw';
import RawShieldFlashLine from '~icons/ri/shield-flash-line?raw';
import RawShieldLine from '~icons/ri/shield-line?raw';
import RawShutDownLine from '~icons/ri/shut-down-line?raw';
import RawSortDesc from '~icons/ri/sort-desc?raw';
import RawSparklingLine from '~icons/ri/sparkling-line?raw';
import RawStarFill from '~icons/ri/star-fill?raw';
import RawStarLine from '~icons/ri/star-line?raw';
import RawStopFill from '~icons/ri/stop-fill?raw';
import RawSubtractLine from '~icons/ri/subtract-line?raw';
import RawTargetLine from '~icons/ri/target-line?raw';
import RawTimeLine from '~icons/ri/time-line?raw';
import RawToolsLine from '~icons/ri/tools-line?raw';
import RawUserLine from '~icons/ri/user-line?raw';

// Public types -------------------------------------------------------------
export type IconName =
  | 'plus'
  | 'chat-new'
  | 'calendar-close'
  | 'calendar-schedule'
  | 'calendar-todo'
  | 'close'
  | 'check'
  | 'archive'
  | 'search'
  | 'copy'
  | 'link'
  | 'external-link'
  | 'download'
  | 'undo'
  | 'send'
  | 'image'
  | 'settings'
  | 'sliders'
  | 'cute-bot'
  | 'microscope'
  | 'flask'
  | 'eye'
  | 'eye-off'
  | 'log-in'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'update-button'
  | 'update-available'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-right'
  | 'minus'
  | 'panel-collapse'
  | 'panel-expand'
  | 'expand'
  | 'collapse'
  | 'list'
  | 'sort'
  | 'grip'
  | 'folder'
  | 'folder-closed'
  | 'folder-plus'
  | 'folder-solid'
  | 'file'
  | 'file-text'
  | 'file-edit'
  | 'file-plus'
  | 'file-off'
  | 'attachment'
  | 'image-off'
  | 'code'
  | 'terminal'
  | 'pencil'
  | 'tool'
  | 'glob'
  | 'globe'
  | 'check-list'
  | 'bolt'
  | 'git-fork'
  | 'git-pull-request'
  | 'message'
  | 'mail'
  | 'user'
  | 'info'
  | 'help-circle'
  | 'alert-triangle'
  | 'fingerprint'
  | 'shield-question'
  | 'full-access'
  | 'trash'
  | 'clock'
  | 'loading-spinner'
  | 'sparkles'
  | 'thinking'
  | 'target'
  | 'pause'
  | 'play'
  | 'power'
  | 'stop'
  | 'star'
  | 'star-outline'
  | 'dots-horizontal'
  | 'circle-check'
  | 'circle-dashed'
  | 'pushpin-line'
  | 'pushpin-fill'
  | 'gen-title';

export type IconSize = 'sm' | 'md' | 'lg';

export const SIZE_PX: Record<IconSize, number> = { sm: 14, md: 16, lg: 20 };

export interface IconEntry {
  /** Vue component that renders the icon (used by <Icon>). Animated entries omit it. */
  component?: Component;
  /** Raw `<svg>` string (used by iconSvg() in v-html contexts). */
  svg: string;
  /**
   * The artwork ships its own <style>-driven animation (namespaced under a
   * `ptx-*` root class). The compiled ~icons component strips <style>, which
   * kills both the motion and the CSS-declared strokes, so these entries are
   * raw-only and <Icon> inlines entry.svg via iconSvg() instead.
   */
  animated?: boolean;
}

function entry(component: Component, svg: string): IconEntry {
  return { component, svg };
}

/** Registry entry for self-animated artwork: raw SVG only, no compiled component. */
function animatedEntry(svg: string): IconEntry {
  return { svg, animated: true };
}

export const ICONS: Record<IconName, IconEntry> = {
  plus: entry(RiAddLine, RawAddLine),
  'chat-new': entry(PythinkerAddConversation, RawPythinkerAddConversation),
  'calendar-close': entry(RiCalendarCloseLine, RawCalendarCloseLine),
  'calendar-schedule': entry(RiCalendarScheduleLine, RawCalendarScheduleLine),
  'calendar-todo': entry(RiCalendarTodoLine, RawCalendarTodoLine),
  close: entry(RiCloseLine, RawCloseLine),
  check: entry(RiCheckLine, RawCheckLine),
  archive: entry(RiArchiveLine, RawArchiveLine),
  search: animatedEntry(RawPythinkerSearch),
  copy: entry(RiFileCopyLine, RawFileCopyLine),
  link: entry(RiLinksLine, RawLinksLine),
  'external-link': entry(RiExternalLinkLine, RawExternalLinkLine),
  download: entry(RiDownloadLine, RawDownloadLine),
  undo: entry(RiArrowGoBackLine, RawArrowGoBackLine),
  send: entry(RiArrowUpLine, RawArrowUpLine),
  image: entry(RiImageLine, RawImageLine),
  settings: animatedEntry(RawPythinkerSetting),
  sliders: entry(RiEqualizerLine, RawEqualizerLine),
  'cute-bot': animatedEntry(RawPythinkerCuteBot),
  microscope: entry(RiMicroscopeLine, RawMicroscopeLine),
  flask: entry(RiFlaskLine, RawFlaskLine),
  eye: entry(RiEyeLine, RawEyeLine),
  'eye-off': entry(RiEyeOffLine, RawEyeOffLine),
  'log-in': entry(RiLoginBoxLine, RawLoginBoxLine),
  'chevron-down': entry(RiArrowDownSLine, RawArrowDownSLine),
  'chevron-right': entry(RiArrowRightSLine, RawArrowRightSLine),
  'chevron-up': entry(RiArrowUpSLine, RawArrowUpSLine),
  'update-button': animatedEntry(RawPythinkerUpdateButton),
  'update-available': animatedEntry(RawPythinkerUpdateIcon),
  'arrow-up': entry(RiArrowUpLine, RawArrowUpLine),
  'arrow-down': entry(RiArrowDownLine, RawArrowDownLine),
  'arrow-right': entry(RiArrowRightLine, RawArrowRightLine),
  minus: entry(RiSubtractLine, RawSubtractLine),
  'panel-collapse': entry(TablerSidebarLeftCollapse, RawTablerSidebarLeftCollapse),
  'panel-expand': entry(TablerSidebarLeftExpand, RawTablerSidebarLeftExpand),
  expand: entry(RiExpandDiagonalLine, RawExpandDiagonalLine),
  collapse: entry(RiCollapseDiagonalLine, RawCollapseDiagonalLine),
  list: entry(RiListUnordered, RawListUnordered),
  sort: entry(RiSortDesc, RawSortDesc),
  grip: entry(RiDraggable, RawDraggable),
  folder: animatedEntry(RawPythinkerFolderOpen),
  'folder-closed': entry(PythinkerFolder, RawPythinkerFolder),
  'folder-plus': entry(RiFolderAddLine, RawFolderAddLine),
  'folder-solid': entry(RiFolderFill, RawFolderFill),
  file: entry(RiFileLine, RawFileLine),
  'file-text': entry(RiFileTextLine, RawFileTextLine),
  'file-edit': entry(RiFileEditLine, RawFileEditLine),
  'file-plus': entry(RiFileAddLine, RawFileAddLine),
  'file-off': entry(RiFileLine, RawFileLine),
  attachment: entry(TablerPaperclip, RawTablerPaperclip),
  'image-off': entry(RiImageLine, RawImageLine),
  code: entry(RiCodeLine, RawCodeLine),
  terminal: animatedEntry(RawPythinkerTerminal),
  pencil: entry(RiPencilLine, RawPencilLine),
  tool: entry(RiToolsLine, RawToolsLine),
  glob: entry(RiBracesLine, RawBracesLine),
  globe: entry(RiGlobalLine, RawGlobalLine),
  'check-list': entry(RiListCheck, RawListCheck),
  bolt: entry(RiFlashlightLine, RawFlashlightLine),
  'git-fork': entry(RiGitForkLine, RawGitForkLine),
  'git-pull-request': entry(RiGitPullRequestLine, RawGitPullRequestLine),
  message: entry(RiMessageLine, RawMessageLine),
  mail: entry(RiMailLine, RawMailLine),
  user: entry(RiUserLine, RawUserLine),
  info: entry(RiInformationLine, RawInformationLine),
  'help-circle': entry(RiQuestionLine, RawQuestionLine),
  'alert-triangle': entry(RiAlertLine, RawAlertLine),
  fingerprint: entry(RiFingerprintLine, RawFingerprintLine),
  'shield-question': entry(RiShieldLine, RawShieldLine),
  'full-access': entry(RiShieldFlashLine, RawShieldFlashLine),
  trash: entry(RiDeleteBinLine, RawDeleteBinLine),
  clock: entry(RiTimeLine, RawTimeLine),
  'loading-spinner': animatedEntry(RawPythinkerLoadingSpinner),
  sparkles: entry(RiSparklingLine, RawSparklingLine),
  thinking: entry(PythinkerThinking, RawPythinkerThinking),
  target: entry(RiTargetLine, RawTargetLine),
  pause: entry(RiPauseFill, RawPauseFill),
  play: entry(RiPlayFill, RawPlayFill),
  power: entry(RiShutDownLine, RawShutDownLine),
  stop: entry(RiStopFill, RawStopFill),
  star: entry(RiStarFill, RawStarFill),
  'star-outline': entry(RiStarLine, RawStarLine),
  'dots-horizontal': entry(PythinkerMore, RawPythinkerMore),
  'circle-check': entry(TablerCircleCheck, RawTablerCircleCheck),
  'circle-dashed': entry(TablerCircleDashed, RawTablerCircleDashed),
  'pushpin-line': entry(RiPushpinLine, RawPushpinLine),
  'pushpin-fill': entry(RiPushpinFill, RawPushpinFill),
  'gen-title': entry(RiAiGenerate, RawAiGenerate),
};

export function getIcon(name: IconName): IconEntry {
  return ICONS[name];
}

function applySize(svg: string, px: number): string {
  return svg
    .replaceAll(/\s(?:width|height)="[^"]*"/g, '')
    .replace(/^<svg\b/, `<svg class="ui-icon" width="${px}" height="${px}" aria-hidden="true"`);
}

/**
 * Head attribute marking the hoisted stylesheet of one animated icon.
 * Keyed by registry name: the CSS is namespaced under the artwork's ptx-*
 * root class, so one sheet per name serves every mounted instance.
 */
const ANIMATED_STYLE_ATTR = 'data-ptx-icon-style';

/** Per-name split of the artwork: style-less SVG + its extracted CSS. */
const animatedArtCache = new Map<string, { inline: string; css: string }>();

/**
 * Prepare self-animated artwork for rendering: peel the <style> block out of
 * the SVG (it would otherwise pollute ancestors' textContent and duplicate
 * itself on every mount) and install it once in document.head. Idempotent.
 */
function prepareAnimatedArt(name: IconName, target: IconEntry): string {
  let art = animatedArtCache.get(name);
  if (!art) {
    const css = /<style>([\s\S]*?)<\/style>/.exec(target.svg)?.[1] ?? '';
    art = { inline: target.svg.replace(/<style>[\s\S]*?<\/style>\s*/, ''), css };
    animatedArtCache.set(name, art);
  }
  if (art.css && typeof document !== 'undefined' && !document.head.querySelector(`style[${ANIMATED_STYLE_ATTR}="${name}"]`)) {
    const sheet = document.createElement('style');
    sheet.setAttribute(ANIMATED_STYLE_ATTR, name);
    sheet.textContent = art.css;
    document.head.append(sheet);
  }
  return art.inline;
}

/**
 * Sizer for self-animated artwork. Rewrites only the ROOT <svg> tag — nested
 * shapes legitimately carry width/height (e.g. the folder papers' rects) and a
 * blanket strip like applySize would destroy them. Merges the shared ui-icon
 * class into the artwork's namespaced root class, swaps the descriptive role
 * for decorative hiding unless a label is given.
 */
function applyAnimatedSize(svg: string, px: number, label?: string): string {
  return svg.replace(/^<svg\b([^>]*)>/, (_match, attrs: string) => {
    const stripped = attrs
      .replaceAll(/\s(?:role|aria-label|width|height)="[^"]*"/g, '')
      .replace(/\sclass="[^"]*"/, '');
    const rootClass = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const classes = ['ui-icon', rootClass].filter(Boolean).join(' ');
    const a11y = label === undefined ? ' aria-hidden="true"' : ` aria-label="${label}"`;
    return `<svg${stripped}${a11y} class="${classes}" width="${px}" height="${px}">`;
  });
}

/** Render an icon to a full <svg> string for v-html contexts. Mirrors <Icon>. */
export function iconSvg(name: IconName, size: IconSize = 'md', label?: string): string {
  const target = ICONS[name];
  if (!target) return '';
  return target.animated
    ? applyAnimatedSize(prepareAnimatedArt(name, target), SIZE_PX[size], label)
    : applySize(target.svg, SIZE_PX[size]);
}

/**
 * File-type icon: resolves a path (or display name) through the Material Icon
 * Theme data (src/lib/fileIcons.ts) — exact file name first, then the longest
 * dotted-extension suffix, then the theme default. Directories end with `/`.
 * Falls back to the shared registry glyphs only if the data module is missing.
 */
export function fileTypeIconSvg(path: string, name?: string): string {
  return fileIconSvg(path, name);
}

// ---------------------------------------------------------------------------
// catalog grouping — single source of truth for design-system §02 icon list
// ---------------------------------------------------------------------------

/** Display order + grouping for the design-system §02 icon catalog. */
export const ICON_GROUPS: ReadonlyArray<readonly [string, readonly IconName[]]> = [
  [
    'Actions',
    [
      'plus',
      'attachment',
      'chat-new',
      'close',
      'check',
      'search',
      'copy',
      'link',
      'external-link',
      'download',
      'undo',
      'send',
      'image',
      'settings',
      'sliders',
      'cute-bot',
      'microscope',
      'flask',
      'eye',
      'eye-off',
      'log-in',
    ],
  ],
  [
    'Navigation & layout',
    [
      'chevron-down',
      'chevron-right',
      'chevron-up',
      'update-button',
      'update-available',
      'arrow-up',
      'arrow-down',
      'arrow-right',
      'minus',
      'panel-collapse',
      'panel-expand',
      'expand',
      'collapse',
      'list',
      'sort',
      'grip',
    ],
  ],
  [
    'Files & tools',
    [
      'folder',
      'folder-closed',
      'folder-plus',
      'folder-solid',
      'file',
      'file-text',
      'file-edit',
      'file-plus',
      'file-off',
      'image-off',
      'code',
      'terminal',
      'pencil',
      'tool',
      'glob',
      'globe',
      'check-list',
      'bolt',
      'git-fork',
      'git-pull-request',
      'archive',
      'target',
      'calendar-schedule',
      'calendar-todo',
      'calendar-close',
    ],
  ],
  ['Communication', ['message', 'mail', 'user']],
  [
    'Status & media',
    [
      'info',
      'help-circle',
      'alert-triangle',
      'clock',
      'loading-spinner',
      'sparkles',
      'thinking',
      'pause',
      'play',
      'power',
      'stop',
      'star',
      'star-outline',
      'dots-horizontal',
      'gen-title',
    ],
  ],
];
