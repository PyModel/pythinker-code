import {
  catalogModelToAlias,
  catalogConnectionWire,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  loadBuiltInCatalog,
  type Catalog,
  type CatalogModel,
  type ModelAlias,
} from '@pythoughts/pythinker-code-sdk';
import { capabilitiesForModel } from '@pythoughts/pythinker-code-oauth';
import type {
  ManagedPythinkerCodeModelInfo,
  OpenPlatformDefinition,
} from '@pythoughts/pythinker-code-oauth';

import { ApiKeyInputDialogComponent, type ApiKeyInputResult } from '../components/dialogs/api-key-input-dialog';
import { ChoicePickerComponent, type ChoiceOption } from '../components/dialogs/choice-picker';
import { FeedbackInputDialogComponent, type FeedbackInputDialogResult } from '../components/dialogs/feedback-input-dialog';
import { ModelSelectorComponent } from '../components/dialogs/model-selector';
import { PlatformSelectorComponent } from '../components/dialogs/platform-selector';
import { BUILT_IN_CATALOG_JSON } from '#/built-in-catalog';
import { coerceEffortForModel, effortLevelsForModel } from '../utils/thinking-levels';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

export interface PlatformSelection {
  readonly platformId: string;
  readonly catalog: Catalog;
}

export async function promptPlatformSelection(
  host: SlashCommandHost,
): Promise<PlatformSelection | undefined> {
  let catalog = loadBuiltInCatalog(BUILT_IN_CATALOG_JSON) ?? {};
  const controller = new AbortController();
  const cancel = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancel;
  const spinner = host.showLoginProgressSpinner('Loading provider catalog');
  try {
    catalog = await fetchCatalog(DEFAULT_CATALOG_URL, controller.signal);
    spinner.stop({ ok: true, label: 'Provider catalog loaded.' });
  } catch (error) {
    if (controller.signal.aborted) {
      spinner.stop({ ok: false, label: 'Aborted.' });
      return undefined;
    }
    spinner.stop({ ok: false, label: 'Using bundled provider catalog.' });
    host.showStatus(`Live provider catalog unavailable: ${formatErrorMessage(error)}`, 'warning');
  } finally {
    if (host.cancelInFlight === cancel) host.cancelInFlight = undefined;
  }

  return new Promise((resolve) => {
    const selector = new PlatformSelectorComponent({
      catalog,
      onSelect: (platformId) => {
        host.restoreEditor();
        resolve({ platformId, catalog });
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(selector);
  });
}

export function promptLogoutProviderSelection(
  host: SlashCommandHost,
  options: readonly ChoiceOption[],
  currentValue: string | undefined,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title: 'Select a provider to log out',
      options,
      currentValue,
      onSelect: (value) => {
        host.restoreEditor();
        resolve(value);
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

export function promptFeedbackInput(host: SlashCommandHost): Promise<string | undefined> {
  return new Promise((resolve) => {
    const dialog = new FeedbackInputDialogComponent((result: FeedbackInputDialogResult) => {
      host.restoreEditor();
      resolve(result.kind === 'ok' ? result.value : undefined);
    });
    host.mountEditorReplacement(dialog);
  });
}

export function promptApiKey(
  host: SlashCommandHost,
  platformName: string,
  subtitleLines: readonly string[] = ['Your key will be saved to ~/.pythinker-code/config.toml'],
  options: import('../components/dialogs/api-key-input-dialog').ApiKeyInputDialogOptions = {},
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const dialog = new ApiKeyInputDialogComponent(
      platformName,
      subtitleLines,
      (result: ApiKeyInputResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
      options,
    );
    host.mountEditorReplacement(dialog);
  });
}

export function promptCatalogProviderSelection(host: SlashCommandHost, catalog: Catalog): Promise<string | undefined> {
  return new Promise((resolve) => {
    const options: ChoiceOption[] = Object.entries(catalog)
      .filter(([, entry]) => catalogConnectionWire(entry) !== undefined)
      .map(([id, entry]) => ({
        value: id,
        label: entry.name ?? id,
        description:
          typeof entry.api === 'string' && entry.api.length > 0 ? entry.api : undefined,
      }))
      .toSorted((a, b) => a.label.localeCompare(b.label));

    if (options.length === 0) {
      host.showError('Catalog has no providers that can be configured with one API key.');
      resolve(undefined);
      return;
    }

    const picker = new ChoicePickerComponent({
      title: 'Select a provider',
      options,
      searchable: true,
      onSelect: (value) => {
        host.restoreEditor();
        resolve(value);
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

export async function promptModelSelectionForOpenPlatform(
  host: SlashCommandHost,
  models: ManagedPythinkerCodeModelInfo[],
  platform: OpenPlatformDefinition,
): Promise<{ model: ManagedPythinkerCodeModelInfo; effort: string } | undefined> {
  const modelDict: Record<string, ModelAlias> = {};
  for (const m of models) {
    modelDict[`${platform.id}/${m.id}`] = {
      provider: platform.id,
      model: m.id,
      maxContextSize: m.contextLength,
      capabilities: capabilitiesForModel(m),
      displayName: m.displayName,
    };
  }
  const selection = await runModelSelector(host, modelDict);
  if (selection === undefined) return undefined;
  const model = models.find((m) => `${platform.id}/${m.id}` === selection.alias);
  return model ? { model, effort: selection.effort } : undefined;
}

export async function promptModelSelectionForCatalog(
  host: SlashCommandHost,
  providerId: string,
  models: CatalogModel[],
): Promise<{ model: CatalogModel; effort: string } | undefined> {
  const modelDict: Record<string, ModelAlias> = {};
  for (const m of models) {
    modelDict[`${providerId}/${m.id}`] = catalogModelToAlias(providerId, m);
  }
  const selection = await runModelSelector(host, modelDict);
  if (selection === undefined) return undefined;
  const model = models.find((m) => `${providerId}/${m.id}` === selection.alias);
  return model ? { model, effort: selection.effort } : undefined;
}

export function runModelSelector(
  host: SlashCommandHost,
  modelDict: Record<string, ModelAlias>,
): Promise<{ alias: string; effort: string } | undefined> {
  return new Promise((resolve) => {
    const firstAlias = Object.keys(modelDict)[0] ?? '';
    const firstModel = modelDict[firstAlias];
    const initialEffort = coerceEffortForModel(
      firstModel,
      effortLevelsForModel(firstModel).find((level) => level !== 'off') ?? 'off',
    );
    const selector = new ModelSelectorComponent({
      models: modelDict,
      currentValue: firstAlias,
      currentEffort: initialEffort,
      searchable: true,
      onSelect: ({ alias, effort }) => {
        host.restoreEditor();
        resolve({ alias, effort });
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(selector);
  });
}
