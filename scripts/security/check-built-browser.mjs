#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const webRoot = resolve(repositoryRoot, process.argv[2] ?? 'apps/pythinker-code/dist-web');

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
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const relativePath = relative(webRoot, resolve(webRoot, requested));
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      response.writeHead(403).end();
      return;
    }
    const file = resolve(webRoot, relativePath);
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentType(file),
    });
    response.end(await readFile(file));
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
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
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
    const id = this.nextId++;
    return new Promise((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

function browserExpression(editorAsset, mermaidAsset) {
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
      globalThis.__artifactSecurityExecuted = 0;

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

      const mermaidModule = await import(${JSON.stringify(mermaidAsset)});
      const mermaid = findApi(mermaidModule, (value) => typeof value.initialize === 'function' && typeof value.render === 'function');
      if (!mermaid) throw new Error('Could not resolve the built Mermaid API.');
      mermaid.initialize({ htmlLabels: true, securityLevel: 'strict', startOnLoad: false });
      const rendered = await mermaid.render(
        'artifactSecurityDiagram',
        ${JSON.stringify('flowchart TD\nA["<img src=/missing-mermaid-fixture onerror=globalThis.__artifactSecurityExecuted=10>unsafe-diagram"]')},
      );
      const diagram = document.createElement('div');
      diagram.innerHTML = rendered.svg;
      document.body.append(diagram);
      await sleep(100);
      const mermaidDangerous = dangerousDom(diagram);
      if (diagram.querySelector('script') || mermaidDangerous.length || globalThis.__artifactSecurityExecuted !== 0) {
        throw new Error('The built Mermaid sanitizer retained executable markup: ' + mermaidDangerous.join(', '));
      }
      if (!diagram.textContent.includes('unsafe-diagram')) {
        throw new Error('The built Mermaid fixture did not render.');
      }
      diagram.remove();
      return { mermaid: 'sanitized', monaco: 'sanitized' };
    })()
  `;
}

async function main() {
  await access(join(webRoot, 'index.html'));
  const [editorAsset, mermaidAsset, chrome] = await Promise.all([
    findAsset(/^editor\.main-[\w-]+\.js$/),
    findAsset(/^mermaid\.core-[\w-]+\.js$/),
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
      `http://127.0.0.1:${endpoint.port}/json/new?${encodeURIComponent(`${origin}/`)}`,
      { method: 'PUT' },
    );
    if (!targetResponse.ok) throw new Error(`Chrome target creation failed: ${targetResponse.status}`);
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.call('Runtime.enable');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const ready = await client.call('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      if (ready.result.value === 'complete') break;
      await new Promise((resolveWait) => {
        setTimeout(resolveWait, 50);
      });
    }
    const evaluation = await client.call('Runtime.evaluate', {
      awaitPromise: true,
      expression: browserExpression(editorAsset, mermaidAsset),
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

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Built browser security failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
