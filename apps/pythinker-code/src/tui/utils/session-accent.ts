/** Stable accent color for a session key (title or id). */
export function sessionAccentHex(key: string, mode: 'dark' | 'light'): string {
  let hash = 5381;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash, 33) + key.codePointAt(index);
  }

  return hslToHex((hash >>> 0) % 360, 0.9, mode === 'dark' ? 0.72 : 0.42);
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const [red, green, blue] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}
