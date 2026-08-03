import { CLI_COMMAND_NAME } from '#/constant/app';
import { registerMigrateCommand } from '#/migration/index';
import { Command, Option } from 'commander';

import type { CLIOptions } from './options';
import { registerAcpCommand } from './sub/acp';
import { registerDoctorCommand } from './sub/doctor';
import { registerExportCommand } from './sub/export';
import { registerLoginCommand } from './sub/login';
import { registerMcpCommand } from './sub/mcp';
import { registerProviderCommand } from './sub/provider';
import { registerServerCommand } from './sub/server';
import { registerDashboardCommand } from './sub/dashboard';

export type MainCommandHandler = (opts: CLIOptions) => void;
export type MigrateCommandHandler = () => void;
export type PluginNodeRunnerHandler = (entry: string, args: readonly string[]) => void;
export type UpgradeCommandHandler = () => void | Promise<void>;

export function createProgram(
  version: string,
  onMain: MainCommandHandler,
  onMigrate: MigrateCommandHandler,
  onPluginNodeRunner: PluginNodeRunnerHandler = () => {},
  onUpgrade: UpgradeCommandHandler = () => {},
): Command {
  const program = new Command(CLI_COMMAND_NAME)
    .description('The Starting Point for Next-Gen Agents')
    .version(version, '-V, --version')
    .allowUnknownOption(false)
    .configureHelp({ helpWidth: 100 })
    .helpOption('-h, --help', 'Show help.')
    .usage('[options] [command]')
    .addHelpText('after', '\nDocumentation:        https://pythoughts-labs.github.io/pythinker-code/\n');

  program
    .addOption(
      new Option(
        '-S, --session [id]',
        'Resume a session. With ID: resume that session. Without ID: interactively pick.',
      ).argParser((val: string | boolean) => (val === true ? '' : (val as string))),
    )
    .addOption(
      new Option('-r, --resume [id]')
        .hideHelp()
        .argParser((val: string | boolean) => (val === true ? '' : (val as string))),
    )
    .option('-C, --continue', 'Continue the previous session for the working directory.', false)
    .addOption(
      new Option(
        '--rewind-files <checkpoint-id>',
        'Restore files to a persisted checkpoint.',
      ).hideHelp(),
    )
    .option('-y, --yolo', 'Auto-approve regular tool calls; the agent may still ask questions.', false)
    .option('--auto', 'Start in auto permission mode: fully autonomous, the agent will not ask questions.', false)
    .addOption(
      new Option(
        '-m, --model <model>',
        'LLM model alias to use for this invocation. Defaults to default_model in config.toml.',
      ),
    )
    .addOption(
      new Option(
        '-p, --prompt <prompt>',
        'Run one prompt non-interactively and print the response.',
      ),
    )
    .addOption(
      new Option(
        '--output-format <format>',
        'Output format for prompt mode. Defaults to text.',
      ).choices(['text', 'json', 'stream-json']),
    )
    .addOption(
      new Option(
        '--json-schema <schema>',
        'JSON Schema for structured output validation.',
      ),
    )
    .addOption(
      new Option(
        '--skills-dir <dir>',
        'Load skills from this directory instead of auto-discovered user and project directories. Can be repeated.',
      )
        .argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value])
        .default([]),
    )
    .addOption(
      new Option(
        '--add-dir <directories...>',
        'Additional directories to allow file-tool access to.',
      ).default([]),
    )
    .addOption(new Option('--yes').hideHelp().default(false))
    .addOption(new Option('--auto-approve').hideHelp().default(false))
    .addOption(new Option('--init').hideHelp().default(false))
    .addOption(new Option('--init-only').hideHelp().default(false))
    .addOption(new Option('--maintenance').hideHelp().default(false))
    .option('--plan', 'Start in plan mode.', false);

  registerExportCommand(program);
  registerProviderCommand(program);
  registerAcpCommand(program);
  registerMcpCommand(program);
  registerServerCommand(program);
  registerLoginCommand(program);
  registerDoctorCommand(program);
  registerDashboardCommand(program);
  registerMigrateCommand(program, onMigrate);
  program
    .command('upgrade')
    .description('Upgrade Pythinker Code to the latest version.')
    .action(async () => {
      await onUpgrade();
    });

  program
    .command('__plugin_run_node', { hidden: true })
    .argument('<entry>')
    .argument('[args...]')
    .allowUnknownOption(true)
    .action((entry: string, args: string[]) => {
      onPluginNodeRunner(entry, args);
    });

  program.argument('[args...]').action((args: string[]) => {
    if (args.length > 0) {
      program.error(`unknown command '${args[0]}'. See '${CLI_COMMAND_NAME} --help'.`);
    }

    // `--resume` is the legacy alias of `--session`; supplying both is a
    // conflict the parser must surface instead of silently picking one.
    const raw = program.opts<Record<string, unknown>>();
    const sessionSelectorConflict =
      raw['session'] !== undefined && raw['resume'] !== undefined;

    const rawSession = raw['session'] ?? raw['resume'];
    const sessionValue = rawSession === true ? '' : (rawSession as string | undefined);
    const yoloValue = raw['yolo'] === true || raw['yes'] === true || raw['autoApprove'] === true;
    const autoValue = raw['auto'] === true;

    const opts: CLIOptions = {
      session: sessionValue,
      sessionSelectorConflict,
      continue: raw['continue'] as boolean,
      yolo: yoloValue,
      auto: autoValue,
      init: raw['init'] as boolean,
      initOnly: raw['initOnly'] as boolean,
      maintenance: raw['maintenance'] as boolean,
      plan: raw['plan'] as boolean,
      model: raw['model'] as string | undefined,
      outputFormat: raw['outputFormat'] as CLIOptions['outputFormat'],
      jsonSchema: raw['jsonSchema'] as string | undefined,
      prompt: raw['prompt'] as string | undefined,
      rewindFiles: raw['rewindFiles'] as string | undefined,
      skillsDirs: raw['skillsDir'] as string[],
      additionalDirs: raw['addDir'] as string[],
    };

    onMain(opts);
  });

  return program;
}
