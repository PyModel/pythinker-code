declare const __PYTHINKER_CODE_BUILT_IN_CATALOG__: string | undefined;

export const BUILT_IN_MODELS_DEV_JSON: string | undefined =
  typeof __PYTHINKER_CODE_BUILT_IN_CATALOG__ === 'string'
    ? __PYTHINKER_CODE_BUILT_IN_CATALOG__
    : undefined;
