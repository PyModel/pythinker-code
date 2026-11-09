import { useEffect, useState } from "react";

function resolveUrl(imageName: string): string {
  if (typeof document !== "undefined") {
    const baseUri = document.body.dataset.baseuri;
    if (baseUri) {
      return `${baseUri}/dist/${imageName}`;
    }
  }
  return `/dist/${imageName}`;
}

export function useExtensionImageUrl(imageName: string): string {
  const [url, setUrl] = useState(() => resolveUrl(imageName));

  useEffect(() => {
    setUrl(resolveUrl(imageName));
  }, [imageName]);

  return url;
}
