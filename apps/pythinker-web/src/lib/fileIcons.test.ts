// apps/pythinker-web/src/lib/fileIcons.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILE_ICON,
  DEFAULT_FOLDER_ICON,
  FILE_EXTENSIONS,
  FILE_NAMES,
  FOLDER_NAMES,
} from './fileIconsData';
import { fileIconName, fileIconSvg } from './fileIcons';

describe('fileIconName', () => {
  it('resolves common code files to their Material Icon Theme icons', () => {
    expect(FILE_EXTENSIONS['js']).toBeDefined();
    expect(fileIconName('src/site.js')).toBe(FILE_EXTENSIONS['js']);
    expect(fileIconName('src/app.ts')).toBe(FILE_EXTENSIONS['ts']);
    expect(fileIconName('styles.css')).toBe(FILE_EXTENSIONS['css']);
  });

  it('matches exact file names before extensions (package.json → nodejs icon)', () => {
    expect(fileIconName('package.json')).toBe(FILE_NAMES['package.json']);
    expect(fileIconName('packages/app/package.json')).toBe(FILE_NAMES['package.json']);
  });

  it('prefers the longest dotted-extension suffix', () => {
    // `ts.map` is a distinct theme key and must beat plain `map`.
    expect(FILE_EXTENSIONS['ts.map']).toBeDefined();
    expect(fileIconName('dist/bundle.ts.map')).toBe(FILE_EXTENSIONS['ts.map']);
  });

  it('matches file names case-insensitively when the exact case misses', () => {
    expect(fileIconName('README.MD')).toBe(fileIconName('readme.md'));
  });

  it('renders directory paths through the folder-name theme', () => {
    if (FOLDER_NAMES['src'] !== undefined) {
      expect(fileIconName('src/')).toBe(FOLDER_NAMES['src']);
    }
    // Unknown folder names fall back to the default folder icon.
    expect(fileIconName('totally-unknown-folder-name/')).toBe(DEFAULT_FOLDER_ICON);
  });

  it('falls back to the default file icon for unknown types', () => {
    expect(fileIconName('archive.xyzq')).toBe(DEFAULT_FILE_ICON);
  });

  it('honours an explicit display name over the path basename', () => {
    expect(fileIconName('downloads/anything', 'site.js')).toBe(fileIconName('x/site.js'));
  });
});

describe('fileIconSvg', () => {
  it('returns sized svg markup with the shared ui-icon class', () => {
    const svg = fileIconSvg('a.ts');
    expect(svg).toContain('<svg');
    expect(svg).toContain('class="ui-icon"');
    expect(svg).toContain('width="14"');
    expect(svg).toContain('aria-hidden="true"');
    // The injected size replaces the source 16×16 dimensions.
    expect(svg).not.toContain('width="16"');
  });

  it('keeps the theme colors (not currentColor)', () => {
    const js = fileIconSvg('site.js');
    expect(js).toMatch(/fill="#[0-9a-f]{6}"/i);
  });

  it('resolves directories and unknown files without throwing', () => {
    expect(fileIconSvg('src/')).toContain('<svg');
    expect(fileIconSvg('archive.xyzq')).toContain('<svg');
  });
});
