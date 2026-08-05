import type { ConfigStore, UrlFetcher, WebSearchProvider } from '../builtin';

export interface ToolServices {
  readonly configStore?: ConfigStore;
  readonly urlFetcher?: UrlFetcher;
  readonly webSearcher?: WebSearchProvider;
}
