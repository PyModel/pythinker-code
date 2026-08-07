import { ErrorCodes } from '@pythoughts/pythinker-code-sdk';

export const PRODUCT_NAME = 'Pythinker';
export const CLI_COMMAND_NAME = 'pythinker';
export const PROCESS_NAME = 'pythinker-code';

// Used in telemetry app names and HTTP User-Agent headers.
export const CLI_USER_AGENT_PRODUCT = 'pythinker-code-cli';
export const CLI_UI_MODE = 'shell';
// Telemetry ui_mode for the `pythinker web` / `pythinker server run` host. Same product
// as the CLI (CLI_USER_AGENT_PRODUCT); the surface is distinguished by ui_mode.
export const WEB_UI_MODE = 'web';

// Give telemetry a short flush window without making CLI exit feel stuck.
export const CLI_SHUTDOWN_TIMEOUT_MS = 3000;

// Published npm package name; this can differ from the executable command.
export const NPM_PACKAGE_NAME = '@pythoughts/pythinker-code';

// App-owned data paths. SDK/core runtime config is intentionally not routed here.
export const PYTHINKER_CODE_HOME_ENV = 'PYTHINKER_CODE_HOME';
export const PYTHINKER_CODE_DATA_DIR_NAME = '.pythinker-code';
export const PYTHINKER_CODE_LOG_DIR_NAME = 'logs';
export const PYTHINKER_CODE_CACHE_DIR_NAME = 'cache';
export const PYTHINKER_CODE_UPDATE_DIR_NAME = 'updates';
export const PYTHINKER_CODE_BIN_DIR_NAME = 'bin';
export const PYTHINKER_CODE_UPDATE_STATE_FILE_NAME = 'latest.json';
export const PYTHINKER_CODE_UPDATE_INSTALL_STATE_FILE_NAME = 'install.json';
export const PYTHINKER_CODE_UPDATE_INSTALL_LOCK_FILE_NAME = 'install.lock';
export const PYTHINKER_CODE_UPDATE_INSTALL_LOG_FILE_NAME = 'install.log';
export const PYTHINKER_CODE_UPDATE_ROLLOUT_LOG_FILE_NAME = 'rollout.log';
export const PYTHINKER_CODE_INPUT_HISTORY_DIR_NAME = 'user-history';
export const PYTHINKER_CODE_BANNER_DIR_NAME = 'banner';
export const PYTHINKER_CODE_BANNER_STATE_FILE_NAME = 'state.json';

// SDK/core error code that tells the TUI to show a login-required startup
// notice. Derived from sdk's ErrorCodes so a future rename in core
// auto-propagates instead of silently breaking the startup recovery path.
export const OAUTH_LOGIN_REQUIRED_CODE = ErrorCodes.AUTH_LOGIN_REQUIRED;

export const FEEDBACK_ISSUE_URL = 'https://github.com/Pythoughts-labs/pythinker-code/issues';
export const PYTHINKER_CODE_CHANGELOG_URL =
  'https://pythoughts-labs.github.io/pythinker-code/release-notes/changelog.html';

// Sent in the feedback `version` field so the backend can distinguish this
// TypeScript client from clients that send a bare version.
export const FEEDBACK_VERSION_PREFIX = 'pythinker-code-';

// Telemetry event name; keep stable for dashboard queries.
export const FEEDBACK_TELEMETRY_EVENT = 'feedback_submitted';

// CDN source of truth: all version checks and native install scripts pull from here.
export const PYTHINKER_CODE_CDN_BASE = 'https://code.pythinker.com/pythinker-code';
export const PYTHINKER_CODE_CDN_LATEST_URL = `${PYTHINKER_CODE_CDN_BASE}/latest`;
// Rollout manifest consumed by update checks; the plain-text `/latest` above
// stays unchanged forever — already-shipped clients hard-fail on non-semver
// bodies, and the CDN install scripts read it for fresh installs.
export const PYTHINKER_CODE_CDN_LATEST_JSON_URL = `${PYTHINKER_CODE_CDN_BASE}/latest.json`;
export const PYTHINKER_CODE_TIPS_BANNER_URL = 'https://cdn.pythinker.com/pythinker-code-tips/tips.json';
export const PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL = `${PYTHINKER_CODE_CDN_BASE}/plugins/marketplace.json`;
export const PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL_ENV = 'PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL';
export const PYTHINKER_CODE_PLUGIN_MARKETPLACE_ALIAS = 'pythinker';
export const ANTHROPIC_PLUGIN_MARKETPLACE_ALIAS = 'anthropic';
export const ANTHROPIC_PLUGIN_MARKETPLACE_REPOSITORY = 'anthropics/claude-plugins-official';
export const CLAUDE_PLUGIN_MARKETPLACE_PATH = '.claude-plugin/marketplace.json';
export const ANTHROPIC_PLUGIN_MARKETPLACE_URL =
  `https://raw.githubusercontent.com/${ANTHROPIC_PLUGIN_MARKETPLACE_REPOSITORY}/HEAD/${CLAUDE_PLUGIN_MARKETPLACE_PATH}`;
export const PYTHINKER_CODE_INSTALL_SH_URL = 'https://code.pythinker.com/pythinker-code/install.sh';
export const PYTHINKER_CODE_INSTALL_PS1_URL = 'https://code.pythinker.com/pythinker-code/install.ps1';

// Native install commands, split by platform. Use these for prompt copy and spawn calls only; do not assemble the strings elsewhere.
export const NATIVE_INSTALL_COMMAND_UNIX = `curl -fsSL ${PYTHINKER_CODE_INSTALL_SH_URL} | bash`;
export const NATIVE_INSTALL_COMMAND_WIN = `irm ${PYTHINKER_CODE_INSTALL_PS1_URL} | iex`;
