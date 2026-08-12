/** Stable accent color for a session key (title or id). */
export function sessionAccentHex(key: string, mode: 'dark' | 'light'): string {
  let hash = 5381;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash, 33) + (key.codePointAt(index) ?? 0);
  }

  return accentHexForHue((hash >>> 0) % 360, mode);
}

export function accentHexForHue(hue: number, mode: 'dark' | 'light'): string {
  if (mode === 'dark') return hslToHex(hue, 0.9, 0.72);

  for (let step = 0; step <= 11; step++) {
    const accent = hslToHex(hue, 0.9, Math.max(0.2, 0.42 - step * 0.02));
    if (1.05 / (relativeLuminance(accent) + 0.05) >= 3) return accent;
  }
  return hslToHex(hue, 0.9, 0.2);
}

function relativeLuminance(hex: string): number {
  const linear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const red = linear(Number.parseInt(hex.slice(1, 3), 16) / 255);
  const green = linear(Number.parseInt(hex.slice(3, 5), 16) / 255);
  const blue = linear(Number.parseInt(hex.slice(5, 7), 16) / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
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
