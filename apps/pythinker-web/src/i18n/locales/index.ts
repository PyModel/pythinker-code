import en_common from './en/common';
import en_app from './en/app';
import en_sidebar from './en/sidebar';
import en_workspace from './en/workspace';
import en_conversation from './en/conversation';
import en_status from './en/status';
import en_composer from './en/composer';
import en_login from './en/login';
import en_providers from './en/providers';
import en_model from './en/model';
import en_newSession from './en/newSession';
import en_sessions from './en/sessions';
import en_approval from './en/approval';
import en_question from './en/question';
import en_tasks from './en/tasks';
import en_thinking from './en/thinking';
import en_diff from './en/diff';
import en_fileTree from './en/fileTree';
import en_filePreview from './en/filePreview';
import en_mention from './en/mention';
import en_warnings from './en/warnings';
import en_commands from './en/commands';
import en_tools from './en/tools';
import en_layout from './en/layout';
import en_mobile from './en/mobile';
import en_theme from './en/theme';
import en_onboarding from './en/onboarding';
import en_settings from './en/settings';
import en_header from './en/header';
import en_sideChat from './en/sideChat';
import en_update from './en/update';

export const messages = {
  en: {
    common: en_common,
    app: en_app,
    sidebar: en_sidebar,
    workspace: en_workspace,
    conversation: en_conversation,
    status: en_status,
    composer: en_composer,
    login: en_login,
    providers: en_providers,
    model: en_model,
    newSession: en_newSession,
    sessions: en_sessions,
    approval: en_approval,
    question: en_question,
    tasks: en_tasks,
    thinking: en_thinking,
    diff: en_diff,
    fileTree: en_fileTree,
    filePreview: en_filePreview,
    mention: en_mention,
    warnings: en_warnings,
    commands: en_commands,
    tools: en_tools,
    layout: en_layout,
    mobile: en_mobile,
    theme: en_theme,
    onboarding: en_onboarding,
    settings: en_settings,
    header: en_header,
    sideChat: en_sideChat,
    update: en_update,
  },
} as const;

export default messages;
