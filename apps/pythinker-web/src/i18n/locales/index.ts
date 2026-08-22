import en_app from './en/app';
import en_admin from './en/admin';
import en_approval from './en/approval';
import en_capabilityMenu from './en/capabilityMenu';
import en_codexLogin from './en/codexLogin';
import en_commands from './en/commands';
import en_common from './en/common';
import en_composer from './en/composer';
import en_conversation from './en/conversation';
import en_diff from './en/diff';
import en_editor from './en/editor';
import en_filePreview from './en/filePreview';
import en_fileTree from './en/fileTree';
import en_header from './en/header';
import en_layout from './en/layout';
import en_login from './en/login';
import en_mention from './en/mention';
import en_mobile from './en/mobile';
import en_model from './en/model';
import en_onboarding from './en/onboarding';
import en_providers from './en/providers';
import en_question from './en/question';
import en_sessions from './en/sessions';
import en_settings from './en/settings';
import en_sideChat from './en/sideChat';
import en_sidebar from './en/sidebar';
import en_status from './en/status';
import en_suggestions from './en/suggestions';
import en_tasks from './en/tasks';
import en_terminal from './en/terminal';
import en_theme from './en/theme';
import en_thinking from './en/thinking';
import en_tools from './en/tools';
import en_update from './en/update';
import en_warnings from './en/warnings';
import en_workspace from './en/workspace';

export const messages = {
  en: {
    admin: en_admin,
    app: en_app,
    approval: en_approval,
    capabilityMenu: en_capabilityMenu,
    codexLogin: en_codexLogin,
    commands: en_commands,
    common: en_common,
    composer: en_composer,
    conversation: en_conversation,
    diff: en_diff,
    editor: en_editor,
    filePreview: en_filePreview,
    fileTree: en_fileTree,
    header: en_header,
    layout: en_layout,
    login: en_login,
    mention: en_mention,
    mobile: en_mobile,
    model: en_model,
    onboarding: en_onboarding,
    providers: en_providers,
    question: en_question,
    sessions: en_sessions,
    settings: en_settings,
    sideChat: en_sideChat,
    sidebar: en_sidebar,
    status: en_status,
    suggestions: en_suggestions,
    tasks: en_tasks,
    terminal: en_terminal,
    theme: en_theme,
    thinking: en_thinking,
    tools: en_tools,
    update: en_update,
    warnings: en_warnings,
    workspace: en_workspace,
  },
} as const;

export default messages;
