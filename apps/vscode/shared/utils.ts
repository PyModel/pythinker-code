export function cleanSystemTags(text: string): string {
  return text.replaceAll(/<system>.*?<\/system>\s*/gs, "").trim();
}
