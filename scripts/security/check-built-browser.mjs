#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const webRoot = resolve(repositoryRoot, process.argv[2] ?? 'apps/pythinker-code/dist-web');
const fixtureSessionId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const fixtureWorkspaceId = 'artifact-security-workspace';
const fixtureTimestamp = '2026-01-01T00:00:00.000Z';
const fixtureMarkdown = [
  '```mermaid',
  'flowchart TD',
  'A["<img src=/missing-mermaid-fixture onerror=globalThis.__artifactSecurityExecuted=10>unsafe-diagram"]',
  '```',
].join('\n');
const fixtureSession = {
  id: fixtureSessionId,
  title: 'Artifact security fixture',
  created_at: fixtureTimestamp,
  updated_at: fixtureTimestamp,
  busy: false,
  main_turn_active: false,
  pending_interaction: 'none',
  archived: false,
  workspace_id: fixtureWorkspaceId,
  metadata: { cwd: '/workspace' },
  agent_config: { model: 'fixture-model' },
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_cost_usd: 0,
    context_tokens: 0,
    context_limit: 0,
    turn_count: 1,
  },
  permission_rules: [],
  message_count: 1,
  last_seq: 1,
};

async function findAsset(pattern) {
  const assets = await readdir(join(webRoot, 'assets'));
  const matches = assets.filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${pattern} asset, found ${matches.length}.`);
  }
  return `/assets/${matches[0]}`;
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [command], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('Chrome or Chromium is required for the built-browser security check.');
}

function contentType(path) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  }[extname(path)] ?? 'application/octet-stream';
}

function serveFixtureApi(pathname, response) {
  let data;
  if (pathname === '/api/v1/auth') {
    data = { ready: true, providers_count: 1, default_model: 'fixture-model' };
  } else if (pathname === '/api/v1/healthz') {
    data = { ok: true };
  } else if (pathname === '/api/v1/meta') {
    data = {
      server_version: 'artifact-security',
      server_id: 'artifact-security',
      started_at: fixtureTimestamp,
      capabilities: {},
      open_in_apps: [],
      dangerous_bypass_auth: false,
      backend: 'v2',
    };
  } else if (pathname === '/api/v1/models' || pathname === '/api/v1/providers') {
    data = { items: [] };
  } else if (pathname === '/api/v1/config') {
    data = {};
  } else if (pathname === '/api/v1/workspaces') {
    data = {
      items: [{
        id: fixtureWorkspaceId,
        root: '/workspace',
        name: 'Artifact security',
        last_opened_at: fixtureTimestamp,
        session_count: 1,
      }],
      has_more: false,
    };
  } else if (pathname === '/api/v1/fs:home') {
    data = { home: '/workspace', recent_roots: [] };
  } else if (pathname === '/api/v1/sessions') {
    data = { items: [fixtureSession], has_more: false };
  } else if (pathname === '/api/v2/sessions') {
    data = {
      groups: [{
        workspace: { id: fixtureWorkspaceId, cwd: '/workspace' },
        sessions: [{
          id: fixtureSessionId,
          workspace: { id: fixtureWorkspaceId, cwd: '/workspace' },
          meta: {
            title: fixtureSession.title,
            last_prompt: 'Artifact security fixture',
            created_at: Date.parse(fixtureTimestamp),
            updated_at: Date.parse(fixtureTimestamp),
            archived: false,
            archived_at: null,
          },
          activity: { status: 'idle', model: 'fixture-model' },
        }],
        total: 1,
      }],
      total: 1,
      has_more: false,
      next_page_token: null,
    };
  } else if (pathname === `/api/v1/sessions/${fixtureSessionId}/snapshot`) {
    data = {
      as_of_seq: 1,
      epoch: 'artifact-security',
      session: fixtureSession,
      messages: {
        items: [{
          id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
          session_id: fixtureSessionId,
          role: 'assistant',
          content: [{ type: 'text', text: fixtureMarkdown }],
          created_at: fixtureTimestamp,
        }],
        has_more: false,
      },
      in_flight_turn: null,
      subagents: [],
      pending_approvals: [],
      pending_questions: [],
    };
  } else if (pathname === `/api/v1/sessions/${fixtureSessionId}/status`) {
    data = {
      model: 'fixture-model',
      thinking_level: 'off',
      permission: 'manual',
      plan_mode: false,
      dynamic_workflow_mode: false,
      context_tokens: 0,
      max_context_tokens: 0,
      context_usage: 0,
    };
  } else if (pathname === `/api/v1/sessions/${fixtureSessionId}/goal`) {
    data = null;
  } else if (pathname === `/api/v1/sessions/${fixtureSessionId}/warnings`) {
    data = { warnings: [] };
  } else {
    return false;
  }
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify({ code: 0, msg: '', data, request_id: 'artifact-security' }));
  return true;
}

async function startServer() {
  // createServer's handler is declared to return void, so handing it an async
  // function hands Node a floating promise: a rejection escapes as an
  // unhandled rejection instead of the 404 below. Keep the handler sync and
  // serve inside it.
  const server = createServer((request, response) => {
    void serve(request, response);
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not resolve test server port.');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function serve(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (serveFixtureApi(pathname, response)) return;
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const relativePath = relative(webRoot, resolve(webRoot, requested));
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      response.writeHead(403).end();
      return;
    }
    const file = resolve(webRoot, relativePath);
    const handle = await open(file, 'r');
    try {
      if (!(await handle.stat()).isFile()) throw new Error('not a file');
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentType(file),
      });
      response.end(await handle.readFile());
    } finally {
      await handle.close();
    }
  } catch {
    response.writeHead(404).end('Not found');
  }
}

async function launchChrome(executable, profile) {
  const browser = spawn(
    executable,
    [
      '--headless=new',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Chrome did not expose DevTools. ${stderr}`));
    }, 15_000);
    browser.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolveEndpoint(match[1]);
    });
    browser.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before the test started (${code}). ${stderr}`));
    });
  });
  return { browser, endpoint };
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.failure = null;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('close', () => {
      this.rejectPending(new Error('CDP WebSocket closed.'));
    });
    this.socket.addEventListener('error', () => {
      this.rejectPending(new Error('CDP WebSocket failed.'));
    });
  }

  async connect() {
    if (this.failure) throw this.failure;
    await new Promise((resolveOpen, reject) => {
      const cleanup = () => {
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('close', onFailure);
        this.socket.removeEventListener('error', onFailure);
      };
      const onOpen = () => {
        cleanup();
        resolveOpen();
      };
      const onFailure = () => {
        cleanup();
        reject(this.failure ?? new Error('CDP WebSocket failed before opening.'));
      };
      this.socket.addEventListener('open', onOpen, { once: true });
      this.socket.addEventListener('close', onFailure, { once: true });
      this.socket.addEventListener('error', onFailure, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  call(method, params = {}) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP WebSocket is not open.'));
    }
    const id = this.nextId++;
    return new Promise((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  rejectPending(error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
  }

  close() {
    this.rejectPending(new Error('CDP WebSocket closed.'));
    this.socket.close();
  }
}

function browserExpression(editorAsset) {
  return `
    (async () => {
      const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
      const findApi = (root, predicate) => {
        const queue = [root];
        const seen = new Set();
        while (queue.length && seen.size < 500) {
          const value = queue.shift();
          if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) continue;
          seen.add(value);
          if (predicate(value)) return value;
          for (const child of Object.values(value)) queue.push(child);
        }
        return null;
      };
      const dangerousDom = (root) => {
        const nodes = [root, ...root.querySelectorAll('*')];
        return nodes.flatMap((node) => [...node.attributes]
          .filter((attribute) => /^on/i.test(attribute.name) || /^javascript:/i.test(attribute.value.trim()))
          .map((attribute) => attribute.name + '=' + attribute.value));
      };

      // Poll rather than assert once: this evaluates as soon as the navigation
      // resolves, and a CI runner is slow enough to get here before the document
      // has parsed. Asserting immediately failed there while passing locally.
      for (let waited = 0; !document.querySelector('#app') && waited < 30000; waited += 100) {
        await sleep(100);
      }
      if (!document.querySelector('#app')) throw new Error('The built application did not load.');

      let productionDiagram = null;
      for (let attempt = 0; attempt < 600 && !productionDiagram; attempt += 1) {
        await sleep(50);
        const candidate = document.querySelector('.mermaid-block-container[data-markstream-mode="preview"]');
        if (candidate?.querySelector('svg') && candidate.textContent.includes('unsafe-diagram')) {
          productionDiagram = candidate;
        }
      }
      if (!productionDiagram) {
        throw new Error('The production Markdown renderer did not render the Mermaid fixture.');
      }
      const mermaidDangerous = dangerousDom(productionDiagram);
      if (
        productionDiagram.querySelector('script')
        || mermaidDangerous.length
        || globalThis.__artifactSecurityExecuted !== 0
      ) {
        throw new Error(
          'The production Mermaid sanitizer retained executable markup: ' + mermaidDangerous.join(', '),
        );
      }

      const editorModule = await import(${JSON.stringify(editorAsset)});
      const monaco = findApi(editorModule, (value) => value.editor?.create && value.languages?.registerHoverProvider);
      if (!monaco) throw new Error('Could not resolve the built Monaco API.');
      const host = document.createElement('div');
      host.style.cssText = 'width:600px;height:240px;position:fixed;inset:0;z-index:2147483647';
      document.body.append(host);
      const language = 'artifact-security-language';
      const languageRegistration = monaco.languages.register({ id: language });
      const provider = monaco.languages.registerHoverProvider(language, {
        provideHover: () => ({
          contents: [{
            isTrusted: true,
            supportHtml: true,
            value: ${JSON.stringify('<img src="/missing-security-fixture" onerror="globalThis.__artifactSecurityExecuted=1"><a href="javascript:globalThis.__artifactSecurityExecuted=2">unsafe-link</a><svg onload="globalThis.__artifactSecurityExecuted=3"><script>globalThis.__artifactSecurityExecuted=4</script></svg>')},
          }],
        }),
      });
      const editor = monaco.editor.create(host, {
        automaticLayout: false,
        hover: { delay: 0 },
        language,
        minimap: { enabled: false },
        value: 'target',
      });
      editor.setPosition({ lineNumber: 1, column: 2 });
      editor.focus();
      await editor.getAction('editor.action.showHover').run();
      let hover = null;
      for (let attempt = 0; attempt < 40 && !hover; attempt += 1) {
        await sleep(50);
        hover = document.querySelector('.monaco-hover');
      }
      if (!hover || !hover.textContent.includes('unsafe-link')) {
        throw new Error('The built Monaco hover fixture did not render.');
      }
      const monacoDangerous = dangerousDom(hover);
      if (hover.querySelector('script') || monacoDangerous.length || globalThis.__artifactSecurityExecuted !== 0) {
        throw new Error('The built Monaco sanitizer retained executable markup: ' + monacoDangerous.join(', '));
      }
      editor.dispose();
      provider?.dispose?.();
      languageRegistration?.dispose?.();
      host.remove();
      return { mermaid: 'sanitized', monaco: 'sanitized' };
    })()
  `;
}

async function main() {
  await access(join(webRoot, 'index.html'));
  const [editorAsset, chrome] = await Promise.all([
    findAsset(/^editor\.main-[\w-]+\.js$/),
    findChrome(),
  ]);
  const profile = await mkdtemp(join(tmpdir(), 'pythinker-security-chrome-'));
  const { server, origin } = await startServer();
  let browser;
  let client;
  try {
    const launched = await launchChrome(chrome, profile);
    browser = launched.browser;
    const endpoint = new URL(launched.endpoint);
    const targetResponse = await fetch(
      `http://127.0.0.1:${endpoint.port}/json/new?about:blank`,
      { method: 'PUT' },
    );
    if (!targetResponse.ok) throw new Error(`Chrome target creation failed: ${targetResponse.status}`);
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.call('Runtime.enable');
    await client.call('Page.enable');
    await client.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        globalThis.__artifactSecurityExecuted = 0;
        localStorage.setItem('pythinker-web.onboarded', '1');
      `,
    });
    await client.call('Page.navigate', { url: `${origin}/` });
    let loaded = false;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const ready = await client.call('Runtime.evaluate', {
        expression: '({ origin: location.origin, readyState: document.readyState })',
        returnByValue: true,
      });
      loaded = ready.result.value.origin === origin && ready.result.value.readyState === 'complete';
      if (loaded) break;
      await new Promise((resolveWait) => {
        setTimeout(resolveWait, 50);
      });
    }
    if (!loaded) throw new Error('The built application navigation did not complete.');
    const evaluation = await client.call('Runtime.evaluate', {
      awaitPromise: true,
      expression: browserExpression(editorAsset),
      returnByValue: true,
    });
    if (evaluation.exceptionDetails) {
      const detail = evaluation.exceptionDetails.exception?.description
        ?? evaluation.exceptionDetails.text;
      throw new Error(detail);
    }
    process.stdout.write(`Built browser security OK: ${JSON.stringify(evaluation.result.value)}\n`);
  } finally {
    client?.close();
    if (browser && browser.exitCode === null) {
      browser.kill('SIGTERM');
      await once(browser, 'exit');
    }
    await new Promise((resolveClose) => {
      server.close(resolveClose);
    });
    await rm(profile, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `Built browser security failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

export { CdpClient };
