import en_app from './en/app';
import en_approval from './en/approval';
import en_capabilityMenu from './en/capabilityMenu';
import en_codexLogin from './en/codexLogin';
import en_commands from './en/commands';
import en_common from './en/common';
import en_composer from './en/composer';
import en_conversation from './en/conversation';
import en_diff from './en/diff';
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
import en_theme from './en/theme';
import en_thinking from './en/thinking';
import en_tools from './en/tools';
import en_update from './en/update';
import en_warnings from './en/warnings';
import en_workspace from './en/workspace';
import zh_app from './zh/app';
import zh_approval from './zh/approval';
import zh_commands from './zh/commands';
import zh_common from './zh/common';
import zh_composer from './zh/composer';
import zh_conversation from './zh/conversation';
import zh_diff from './zh/diff';
import zh_filePreview from './zh/filePreview';
import zh_header from './zh/header';
import zh_login from './zh/login';
import zh_mobile from './zh/mobile';
import zh_model from './zh/model';
import zh_onboarding from './zh/onboarding';
import zh_providers from './zh/providers';
import zh_question from './zh/question';
import zh_sessions from './zh/sessions';
import zh_settings from './zh/settings';
import zh_sidebar from './zh/sidebar';
import zh_status from './zh/status';
import zh_tasks from './zh/tasks';
import zh_theme from './zh/theme';
import zh_tools from './zh/tools';
import zh_warnings from './zh/warnings';
import zh_workspace from './zh/workspace';

export const messages = {
  en: {
    app: en_app,
    approval: en_approval,
    capabilityMenu: en_capabilityMenu,
    codexLogin: en_codexLogin,
    commands: en_commands,
    common: en_common,
    composer: en_composer,
    conversation: en_conversation,
    diff: en_diff,
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
    theme: en_theme,
    thinking: en_thinking,
    tools: en_tools,
    update: en_update,
    warnings: en_warnings,
    workspace: en_workspace,
  },
  zh: {
    app: zh_app,
    approval: zh_approval,
    commands: zh_commands,
    common: zh_common,
    composer: zh_composer,
    conversation: zh_conversation,
    diff: zh_diff,
    filePreview: zh_filePreview,
    header: zh_header,
    login: zh_login,
    mobile: zh_mobile,
    model: zh_model,
    onboarding: zh_onboarding,
    providers: zh_providers,
    question: zh_question,
    sessions: zh_sessions,
    settings: zh_settings,
    sidebar: zh_sidebar,
    status: zh_status,
    tasks: zh_tasks,
    theme: zh_theme,
    tools: zh_tools,
    warnings: zh_warnings,
    workspace: zh_workspace,
  },
} as const;

export default messages;
