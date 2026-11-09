import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { ILogService } from '#/_base/log/log';
import { IMAGE_SECTION, type ImageConfig } from '#/agent/media/configSection';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigRegistry, IConfigService } from '#/app/config/config';
import { ConfigRegistry, ConfigService } from '#/app/config/configService';
import { THINKING_SECTION } from '#/app/kosongConfig/configSection';
import { type ThinkingConfig } from '#/llm-adapter/model/thinking';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { TomlAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { IAtomicTomlDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';

import { stubLog } from '../../_base/log/stubs';
import { stubBootstrap } from '../bootstrap/stubs';

describe('config.toml writeback preservation', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'pythinker-v2-writeback-'));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  async function setup(toml: string, env: Record<string, string> = {}) {
    const disposables = new DisposableStore();
    const ix = disposables.add(new TestInstantiationService());
    const storage = new InMemoryStorageService();
    await storage.write('', 'config.toml', new TextEncoder().encode(toml));
    ix.stub(ILogService, stubLog());
    ix.stub(IBootstrapService, stubBootstrap(homeDir, env));
    ix.stub(IFileSystemStorageService, storage);
    ix.set(IAtomicTomlDocumentStore, new SyncDescriptor(TomlAtomicDocumentStore));
    ix.set(IConfigRegistry, new SyncDescriptor(ConfigRegistry));
    ix.set(IConfigService, new SyncDescriptor(ConfigService));
    const config = ix.get(IConfigService);
    await config.ready;
    const readText = async (): Promise<string> => {
      const bytes = await storage.read('', 'config.toml');
      if (bytes === undefined) throw new Error('config.toml missing');
      return new TextDecoder().decode(bytes);
    };
    return { config, disposables, storage, readText };
  }

  function section(parsed: Record<string, unknown>, key: string): Record<string, unknown> {
    return parsed[key] as Record<string, unknown>;
  }

  it('preserves comments, blank lines and untouched domains byte-for-byte on set()', async () => {
    const seed = [
      '# zhzh',
      'default_model = "kimi-k2"   # zh',
      '',
      '# zh',
      '[image]',
      'max_edge_px = 1500',
      '',
      '# zh',
      '[custom]',
      'notes = """',
      'zh',
      '[not_a_header] zh',
      '"""',
      'keep_me = "yes"',
      '',
    ].join('\n');
    const { config, disposables, readText } = await setup(seed);

    await config.set(IMAGE_SECTION, { maxEdgePx: 2000 });

    const text = await readText();
    expect(
      text.startsWith(
        '# zhzh\ndefault_model = "kimi-k2"   # zh\n\n# zh\n',
      ),
    ).toBe(true);
    expect(
      text.endsWith(
        '\n# zh\n[custom]\nnotes = """\nzh\n[not_a_header] zh\n"""\nkeep_me = "yes"\n',
      ),
    ).toBe(true);
    const parsed = parseToml(text) as Record<string, unknown>;
    expect(section(parsed, 'image')['max_edge_px']).toBe(2000);
    expect(parsed['default_model']).toBe('kimi-k2');
    expect(section(parsed, 'custom')['keep_me']).toBe('yes');
    expect(config.get<ImageConfig>(IMAGE_SECTION)).toEqual({ maxEdgePx: 2000 });

    disposables.dispose();
  });

  it('skips the write entirely when the staged result is byte-identical', async () => {
    const { config, disposables, storage, readText } = await setup('[image]\nmax_edge_px = 1500\n');
    const writeSpy = vi.spyOn(storage, 'write');

    await config.set(IMAGE_SECTION, { maxEdgePx: 2000 });
    const afterFirst = await readText();
    expect(writeSpy).toHaveBeenCalledTimes(1);

    await config.set(IMAGE_SECTION, { maxEdgePx: 2000 });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(await readText()).toBe(afterFirst);

    disposables.dispose();
  });

  it('appends a new domain at the end with a single trailing newline', async () => {
    const seed = '# zh\n[image]\nmax_edge_px = 1500\n';
    const { config, disposables, readText } = await setup(seed);

    await config.set(THINKING_SECTION, { effort: 'high' });

    const text = await readText();
    expect(text.startsWith(seed)).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    const parsed = parseToml(text) as Record<string, unknown>;
    expect(section(parsed, 'thinking')['effort']).toBe('high');
    expect(config.get<ThinkingConfig>(THINKING_SECTION)).toEqual({ effort: 'high' });

    disposables.dispose();
  });

  it('removes a deleted domain region while keeping neighboring trivia', async () => {
    const seed = [
      '# zh',
      '[thinking]',
      'effort = "high"',
      '',
      '# zh',
      '[image]',
      'max_edge_px = 1500',
      '',
      '# zh',
      '[custom]',
      'keep_me = "yes"',
      '',
    ].join('\n');
    const { config, disposables, readText } = await setup(seed);

    await config.replace(IMAGE_SECTION, null);

    const text = await readText();
    expect(text.includes('[image]')).toBe(false);
    expect(text.includes('max_edge_px')).toBe(false);
    expect(text.includes('# zh\n[thinking]\neffort = "high"\n')).toBe(true);
    expect(text.includes('# zh')).toBe(true);
    expect(text.includes('# zh\n[custom]\nkeep_me = "yes"\n')).toBe(true);
    const parsed = parseToml(text) as Record<string, unknown>;
    expect(parsed['image']).toBeUndefined();
    expect(section(parsed, 'thinking')['effort']).toBe('high');

    disposables.dispose();
  });

  it('preserves CRLF line endings in untouched regions', async () => {
    const seed = '# zh\r\ndefault_model = "kimi-k2"\r\n\r\n[image]\r\nmax_edge_px = 1500\r\n';
    const { config, disposables, readText } = await setup(seed);

    await config.set(IMAGE_SECTION, { maxEdgePx: 3000 });

    const text = await readText();
    expect(text.startsWith('# zh\r\ndefault_model = "kimi-k2"\r\n\r\n')).toBe(true);
    const parsed = parseToml(text) as Record<string, unknown>;
    expect(section(parsed, 'image')['max_edge_px']).toBe(3000);

    disposables.dispose();
  });

});
