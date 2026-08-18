import { promises as fs } from 'node:fs';

import ignore from 'ignore';
import { dirname, isAbsolute, join, relative, resolve } from 'pathe';

import { expandSkillParameters, skillArgumentNames } from './parser';
import { discoverSkills, type DiscoverSkillsOptions } from './scanner';
import type { SkillDefinition, SkillRoot, SkillSource, SkippedSkill } from './types';
import { isInlineSkillType, normalizeSkillName } from './types';
import type { SkillRegistry as AgentSkillRegistry } from '../agent/skill/types';
import { expandBraces } from '../tools/builtin/file/glob';
import { escapeXmlAttr } from '../utils/xml-escape';

const LISTING_DESC_MAX = 250;
const NESTED_SKILL_DIRS = ['.agents/skills', '.pythinker-code/skills'] as const;

export interface SkillRegistryOptions {
  readonly discover?: typeof discoverSkills;
  readonly isPathIgnored?: (path: string, cwd: string) => Promise<boolean>;
  readonly onWarning?: (message: string, cause?: unknown) => void;
  readonly sessionId?: string;
  /** Skill names the user turned off; they are never registered. */
  readonly disabledNames?: readonly string[];
}

export class SessionSkillRegistry implements AgentSkillRegistry {
  private readonly byName = new Map<string, SkillDefinition>();
  private readonly byPluginAndName = new Map<string, SkillDefinition>();
  private readonly conditionalByName = new Map<
    string,
    { readonly skill: SkillDefinition; readonly patterns: readonly string[] }
  >();
  private readonly roots: string[] = [];
  private readonly checkedNestedRoots = new Set<string>();
  private readonly skipped: SkippedSkill[] = [];
  private readonly discoverImpl: typeof discoverSkills;
  private readonly isPathIgnored: (path: string, cwd: string) => Promise<boolean>;
  private readonly onWarning: (message: string, cause?: unknown) => void;
  private readonly disabledNames: ReadonlySet<string>;
  readonly sessionId?: string;

  constructor(options: SkillRegistryOptions = {}) {
    this.discoverImpl = options.discover ?? discoverSkills;
    this.isPathIgnored = options.isPathIgnored ?? (() => Promise.resolve(false));
    this.onWarning = options.onWarning ?? (() => {});
    this.sessionId = options.sessionId;
    this.disabledNames = new Set(
      (options.disabledNames ?? []).map((name) => normalizeSkillName(name)),
    );
  }

  async loadRoots(roots: readonly SkillRoot[]): Promise<readonly SkillDefinition[]> {
    for (const root of roots) {
      if (!this.roots.includes(root.path)) this.roots.push(root.path);
    }

    const skills = await this.discoverImpl({
      roots,
      onWarning: this.onWarning,
      onSkippedByPolicy: (skill) => this.skipped.push(skill),
      onDiscoveredSkill: (skill) => {
        this.indexPluginSkill(skill);
      },
    } satisfies DiscoverSkillsOptions);

    for (const skill of skills) {
      this.register(skill, { replace: true });
    }
    return skills;
  }

  registerBuiltinSkill(skill: SkillDefinition): void {
    this.register(skill.source === 'builtin' ? skill : { ...skill, source: 'builtin' });
  }

  register(skill: SkillDefinition, options: { readonly replace?: boolean } = {}): void {
    const key = normalizeSkillName(skill.name);
    // A disabled skill is dropped here, the one funnel every source goes
    // through, so it is invisible to the model, the slash menu and the API.
    if (this.disabledNames.has(key)) return;
    if (
      options.replace !== true &&
      (this.byName.has(key) || this.conditionalByName.has(key))
    ) {
      return;
    }

    this.byName.delete(key);
    this.conditionalByName.delete(key);
    const patterns = conditionalSkillPatterns(skill);
    if (patterns.length > 0) {
      this.conditionalByName.set(key, { skill, patterns });
    } else {
      this.byName.set(key, skill);
      this.indexPluginSkill(skill, options);
    }
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.byName.get(normalizeSkillName(name));
  }

  getPluginSkill(pluginId: string, name: string): SkillDefinition | undefined {
    return this.byPluginAndName.get(pluginSkillKey(pluginId, name));
  }

  activateForPaths(filePaths: readonly string[], cwd: string): readonly SkillDefinition[] {
    const activated: SkillDefinition[] = [];
    for (const [key, conditional] of this.conditionalByName) {
      const matcher = ignore().add(conditional.patterns);
      const matched = filePaths.some((filePath) => {
        const relativePath = (isAbsolute(filePath) ? relative(cwd, filePath) : filePath).replaceAll(
          '\\',
          '/',
        );
        return (
          relativePath.length > 0 &&
          !relativePath.startsWith('..') &&
          !isAbsolute(relativePath) &&
          matcher.ignores(relativePath)
        );
      });
      if (!matched) continue;

      this.conditionalByName.delete(key);
      this.byName.set(key, conditional.skill);
      this.indexPluginSkill(conditional.skill, { replace: true });
      activated.push(conditional.skill);
    }
    return activated;
  }

  async loadNestedForPaths(
    filePaths: readonly string[],
    cwd: string,
  ): Promise<readonly SkillDefinition[]> {
    const normalizedCwd = resolve(cwd);
    const candidates: Array<{ readonly path: string; readonly owner: string }> = [];
    for (const filePath of filePaths) {
      let current = dirname(isAbsolute(filePath) ? filePath : resolve(cwd, filePath));
      while (current !== normalizedCwd && isWithinPath(current, normalizedCwd)) {
        for (const nestedDir of NESTED_SKILL_DIRS) {
          const skillRoot = join(current, nestedDir);
          if (this.checkedNestedRoots.has(skillRoot)) continue;
          this.checkedNestedRoots.add(skillRoot);
          if (await isDirectory(skillRoot)) candidates.push({ path: skillRoot, owner: current });
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }

    const loaded: SkillDefinition[] = [];
    for (const candidate of candidates.toSorted(
      (left, right) => pathDepth(left.path) - pathDepth(right.path),
    )) {
      if (await this.isPathIgnored(candidate.owner, normalizedCwd)) continue;
      const root = await fs.realpath(candidate.path);
      loaded.push(...(await this.loadRoots([{ path: root, source: 'project' }])));
    }
    return loaded.filter((skill) => this.getSkill(skill.name) === skill);
  }

  private indexPluginSkill(
    skill: SkillDefinition,
    options: { readonly replace?: boolean } = {},
  ): void {
    if (skill.plugin === undefined) return;
    // Discovery indexes plugin skills before `register` runs, so the disabled
    // check has to repeat here or `getPluginSkill` would still hand one back.
    if (this.disabledNames.has(normalizeSkillName(skill.name))) return;
    const key = pluginSkillKey(skill.plugin.id, skill.name);
    if (options.replace === true || !this.byPluginAndName.has(key)) {
      this.byPluginAndName.set(key, skill);
    }
  }

  renderSkillPrompt(skill: SkillDefinition, rawArgs: string): string {
    const argumentNames = skillArgumentNames(skill.metadata);
    const content = expandSkillParameters(skill.content, rawArgs, {
      skillDir: skill.dir,
      sessionId: this.sessionId,
      argumentNames,
    });
    const plugin = skill.plugin;
    if (plugin === undefined) return content;
    const instructions = plugin.instructions;
    if (instructions === undefined || instructions.trim().length === 0) return content;
    return (
      `<pythinker-plugin-instructions plugin="${escapeXmlAttr(plugin.id)}">\n` +
      `${instructions}\n` +
      `</pythinker-plugin-instructions>\n\n${content}`
    );
  }

  listSkills(): readonly SkillDefinition[] {
    return [...this.byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  }

  listInvocableSkills(): readonly SkillDefinition[] {
    return this.listSkills().filter(
      (skill) =>
        skill.metadata.disableModelInvocation !== true && isInlineSkillType(skill.metadata.type),
    );
  }

  getSkillRoots(): readonly string[] {
    return [...this.roots];
  }

  getSkippedByPolicy(): readonly SkippedSkill[] {
    return [...this.skipped];
  }

  getPythinkerSkillsDescription(): string {
    const rendered = renderGroupedSkills(this.listSkills(), formatFullSkill);
    return rendered.length === 0 ? 'No skills' : rendered;
  }

  getModelSkillListing(): string {
    const lines = ['DISREGARD any earlier skill listings. Current available skills:'];
    const listing = renderGroupedSkills(
      this.listInvocableSkills().filter((skill) => skill.metadata.isSubSkill !== true),
      formatModelSkill,
    );
    if (listing.length > 0) {
      lines.push(listing);
    }
    return lines.length === 1 ? '' : lines.join('\n');
  }
}

function pluginSkillKey(pluginId: string, skillName: string): string {
  return `${pluginId}\0${normalizeSkillName(skillName)}`;
}

function conditionalSkillPatterns(skill: SkillDefinition): readonly string[] {
  if (!isInlineSkillType(skill.metadata.type)) return [];
  const paths = skill.metadata.paths;
  const values = typeof paths === 'string' ? [paths] : paths;
  return (
    values?.flatMap((value) => splitPathPatterns(value).flatMap((pattern) => expandBraces(pattern))) ??
    []
  );
}

function splitPathPatterns(value: string): readonly string[] {
  const patterns: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '{') depth++;
    if (value[index] === '}') depth--;
    if (value[index] !== ',' || depth !== 0) continue;
    patterns.push(value.slice(start, index).trim());
    start = index + 1;
  }
  patterns.push(value.slice(start).trim());
  return patterns.filter((pattern) => pattern.length > 0);
}

function isWithinPath(child: string, parent: string): boolean {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent.length > 0 &&
    !pathFromParent.startsWith('..') &&
    !isAbsolute(pathFromParent)
  );
}

function pathDepth(value: string): number {
  return value.replaceAll('\\', '/').split('/').length;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const SOURCE_GROUPS: ReadonlyArray<{ readonly source: SkillSource; readonly label: string }> = [
  { source: 'project', label: 'Project' },
  { source: 'user', label: 'User' },
  { source: 'extra', label: 'Extra' },
  { source: 'builtin', label: 'Built-in' },
];

function renderGroupedSkills(
  skills: readonly SkillDefinition[],
  format: (skill: SkillDefinition) => readonly string[],
): string {
  const lines: string[] = [];
  for (const group of SOURCE_GROUPS) {
    const groupSkills = skills.filter((skill) => skill.source === group.source);
    if (groupSkills.length === 0) continue;
    lines.push(`### ${group.label}`);
    for (const skill of groupSkills) {
      lines.push(...format(skill));
    }
  }
  return lines.join('\n');
}

function formatFullSkill(skill: SkillDefinition): readonly string[] {
  return [`- ${skill.name}`, `  - Path: ${skill.path}`, `  - Description: ${skill.description}`];
}

function formatModelSkill(skill: SkillDefinition): readonly string[] {
  const lines = [`- ${skill.name}: ${truncate(skill.description, LISTING_DESC_MAX)}`];
  if (typeof skill.metadata.whenToUse === 'string' && skill.metadata.whenToUse.length > 0) {
    lines.push(`  When to use: ${skill.metadata.whenToUse}`);
  }
  lines.push(`  Path: ${skill.path}`);
  return lines;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  // Reserve one code unit for the trailing ellipsis and walk whole grapheme
  // clusters so we never split a surrogate pair or combining sequence.
  let length = 0;
  let result = '';
  for (const { segment } of graphemeSegmenter.segment(value)) {
    if (length + segment.length > max - 1) break;
    result += segment;
    length += segment.length;
  }
  return `${result}…`;
}
