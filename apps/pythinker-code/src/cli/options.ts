export type UIMode = 'shell' | 'print';
export type PromptOutputFormat = 'text' | 'json' | 'stream-json';

export interface CLIOptions {
  session: string | undefined;
  /** Set by the parser when canonical and legacy session selectors are both present. */
  sessionSelectorConflict?: boolean;
  continue: boolean;
  yolo: boolean;
  auto: boolean;
  init?: boolean;
  initOnly?: boolean;
  maintenance?: boolean;
  plan: boolean;
  model: string | undefined;
  outputFormat: PromptOutputFormat | undefined;
  jsonSchema?: string;
  prompt: string | undefined;
  rewindFiles: string | undefined;
  skillsDirs: string[];
  additionalDirs?: string[];
}

export interface ValidatedOptions {
  options: CLIOptions;
  uiMode: UIMode;
}

export class OptionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionConflictError';
  }
}

export function validateOptions(opts: CLIOptions): ValidatedOptions {
  if (opts.sessionSelectorConflict === true) {
    throw new OptionConflictError('Cannot combine --session with --resume.');
  }
  const prompt = opts.prompt;
  const promptMode = prompt !== undefined;
  const rewindFiles = opts.rewindFiles;
  const rewindMode = rewindFiles !== undefined;
  if (promptMode && prompt.trim().length === 0) {
    throw new OptionConflictError('Prompt cannot be empty.');
  }
  if (opts.model !== undefined && opts.model.trim().length === 0) {
    throw new OptionConflictError('Model cannot be empty.');
  }
  if (rewindFiles !== undefined && rewindFiles.trim().length === 0) {
    throw new OptionConflictError(
      'Checkpoint ID for --rewind-files cannot be empty.',
    );
  }
  if (
    rewindMode &&
    (opts.session === undefined ||
      opts.session.trim().length === 0 ||
      opts.continue)
  ) {
    throw new OptionConflictError(
      '--rewind-files requires --resume with a session ID.',
    );
  }
  if (rewindMode && promptMode) {
    throw new OptionConflictError('Cannot combine --rewind-files with --prompt.');
  }
  if (!promptMode && opts.outputFormat !== undefined) {
    throw new OptionConflictError('Output format is only supported in prompt mode.');
  }
  if (!promptMode && opts.jsonSchema !== undefined) {
    throw new OptionConflictError('JSON Schema is only supported in prompt mode.');
  }
  if (promptMode && opts.yolo) {
    throw new OptionConflictError('Cannot combine --prompt with --yolo.');
  }
  if (promptMode && opts.auto) {
    throw new OptionConflictError('Cannot combine --prompt with --auto.');
  }
  if (promptMode && opts.plan) {
    throw new OptionConflictError('Cannot combine --prompt with --plan.');
  }
  if (promptMode && opts.session === '') {
    throw new OptionConflictError('Cannot use --session without an id in prompt mode.');
  }
  if (opts.continue && opts.session !== undefined) {
    throw new OptionConflictError('Cannot combine --continue, --session.');
  }
  if (opts.yolo && opts.auto) {
    throw new OptionConflictError('Cannot combine --yolo with --auto.');
  }
  return { options: opts, uiMode: promptMode || rewindMode ? 'print' : 'shell' };
}
