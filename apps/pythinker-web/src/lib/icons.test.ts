// apps/pythinker-web/src/lib/icons.test.ts
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Icon from '../components/ui/Icon.vue';
import { ICONS, SIZE_PX, getIcon, iconSvg } from './icons';

/** Registry names served as self-animated artwork (raw SVG with its own <style>). */
const ANIMATED_NAMES = [
  'terminal',
  'cute-bot',
  'loading-spinner',
  'update-button',
  'update-available',
  'back-arrow',
] as const;

const STATIC_IDLE_NAMES = ['chat-new', 'search', 'folder', 'settings'] as const;

describe('ICONS registry', () => {
  it('is non-empty', () => {
    expect(Object.keys(ICONS).length).toBeGreaterThan(0);
  });

  it('static entries have a component; animated entries are raw-only', () => {
    for (const [name, entry] of Object.entries(ICONS)) {
      if (entry.animated) {
        expect(entry.component, `${name} must not carry a compiled component`).toBeUndefined();
      } else {
        // unplugin-icons component can be a function or a defineComponent object
        const ct = typeof entry.component;
        expect(['function', 'object'], `${name} component type`).toContain(ct);
      }
      expect(typeof entry.svg, `${name} svg type`).toBe('string');
      expect(entry.svg.trim(), `${name} svg`).not.toBe('');
      expect(entry.svg.toLowerCase(), `${name} svg contains <svg`).toContain('<svg');
    }
  });

  it('every entry svg is on a 24x24 grid with a viewBox', () => {
    for (const [name, entry] of Object.entries(ICONS)) {
      expect(entry.svg, `${name} viewBox`).toContain('viewBox="0 0 24 24"');
    }
  });
});

describe('thinking icon', () => {
  // ThinkingBulb looks these three paths up by class name and animates them
  // separately (glass swell, filament draw, base breathe). Renaming a class or
  // merging the paths silently drops that limb out of the animation.
  it.each(['bulb', 'filament', 'base'])('exposes a non-empty %s path', (cls) => {
    const d = new RegExp(`class="${cls}"[^>]*\\sd="([^"]+)"`).exec(getIcon('thinking').svg)?.[1];
    expect(d?.trim(), `${cls} path`).toBeTruthy();
  });

  // The icon pipeline strips <style> out of the SVG, so any animation authored
  // there is dead on arrival and the paths lose their only stroke declaration.
  it('carries stroke as presentation attributes, not a <style> block', () => {
    expect(getIcon('thinking').svg).not.toContain('<style');
    expect(getIcon('thinking').svg).toContain('stroke="currentColor"');
  });
});

describe('animated registry icons', () => {
  // unplugin-icons strips <style> when compiling the ~icons component form,
  // which kills both the motion and the CSS-declared strokes. Animated
  // artwork must therefore stay raw-only (animatedEntry) so the style block
  // reaches the DOM byte-identical.
  it.each(ANIMATED_NAMES)('%s is flagged animated and ships its own animation', (name) => {
    const target = getIcon(name);
    expect(target.animated, `${name} animated flag`).toBe(true);
    expect(target.svg).toContain('<style');
    expect(target.svg).toContain('@keyframes');
    expect(target.svg).toContain('prefers-reduced-motion');
  });

  // The style blocks are inlined into the document (v-html), so every selector
  // must live under the artwork's ptx-* root class and every keyframe must be
  // ptx-prefixed — a bare `.cursor` or `@keyframes blink` would restyle the app.
  // Motion is opt-in: a resting icon stays still and only plays while hovered
  // or under a .ptx-live host (the agent is working). The spinner is a progress
  // indicator and stays always-on.
  it.each(ANIMATED_NAMES.filter((n) => n !== 'loading-spinner'))(
    '%s only animates on hover or under .ptx-live',
    (name) => {
      const style = /<style>([\s\S]*?)<\/style>/.exec(getIcon(name).svg)?.[1] ?? '';
      const rules = [...style.matchAll(/([^{}]+?)\s*\{([^{}]*)\}/g)];
      for (const [, sel = '', body = ''] of rules) {
        if (!/\banimation(-delay)?:/.test(body) || /animation:\s*none/.test(body)) continue;
        expect(sel, `${name}: ${sel.trim()}`).toContain('.ptx-live');
        expect(sel).toContain(':hover');
      }
      expect(style).toContain('.ptx-live');
    },
  );

  it.each(ANIMATED_NAMES)('%s namespaces its css under a ptx-* root class', (name) => {
    const svg = getIcon(name).svg;
    expect(svg.slice(0, 120)).toMatch(/class="ptx ptx-[a-z-]+"/);
    const style = /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1] ?? '';
    // Every rule-opening line must live under the ptx namespace: skip at-rule
    // headers (@keyframes/@media) and keyframe step lines, then require 'ptx-'
    // on what's left.
    const bareRules = style
      .split('\n')
      .filter((line) => line.trimEnd().endsWith('{'))
      .filter((line) => !/^\s*@/.test(line))
      .filter((line) => !/^\s*([\d.]+%|from\b|to\b)/.test(line))
      .filter((line) => !line.includes('ptx-'));
    expect(bareRules, `bare rules: ${bareRules.join(' | ')}`).toEqual([]);
    const bareKeyframes = style.match(/@keyframes\s+(?!ptx-)[\w-]+/g) ?? [];
    expect(bareKeyframes, `bare keyframes: ${bareKeyframes.join(' | ')}`).toEqual([]);
  });

  it.each(ANIMATED_NAMES)(`iconSvg('%s') sizes only the root tag and hoists the css to head`, (name) => {
    const svg = iconSvg(name);
    expect(svg).toContain(`width="${SIZE_PX.md}" height="${SIZE_PX.md}"`);
    expect(svg).toContain('class="ui-icon ptx');
    // the style block never enters the markup — it lives in document.head,
    // where it cannot pollute ancestors' textContent or duplicate per mount
    expect(svg).not.toContain('<style');
    const sheet = document.head.querySelector(`style[data-ptx-icon-style="${name}"]`);
    expect(sheet?.textContent, `${name} hoisted css`).toContain('@keyframes');
    // nested shapes keep their own width/height (e.g. folder papers' rects)
    const widthCount = (svg.match(/\bwidth="/g) ?? []).length;
    expect(widthCount).toBeGreaterThanOrEqual(1);
    expect(svg).not.toContain('role="img"');
  });

  it('<Icon> renders animated artwork style-less while head carries the motion', () => {
    const wrapper = mount(Icon, { props: { name: 'terminal', size: 'md' } });
    const html = wrapper.html();
    expect(html).not.toContain('<style');
    expect(html).toContain(`width="${SIZE_PX.md}"`);
    expect(html).toContain('aria-hidden="true"');
    const sheet = document.head.querySelector('style[data-ptx-icon-style="terminal"]');
    expect(sheet?.textContent).toContain('@keyframes ptx-term-blink-cursor');
  });
});

describe('idle sidebar icons', () => {
  it.each(STATIC_IDLE_NAMES)('%s is static artwork without an animation stylesheet', (name) => {
    const target = getIcon(name);
    expect(target.animated).toBeUndefined();
    expect(target.component).toBeDefined();
    expect(target.svg).not.toContain('<style');
    expect(target.svg).not.toContain('@keyframes');
    expect(target.svg).not.toContain('animation:');
  });

  it('adds the hover-animation hook to the new chat icon', () => {
    const wrapper = mount(Icon, { props: { name: 'chat-new' } });
    expect(wrapper.get('svg').classes()).toContain('ui-icon--chat-new');
  });
});

describe('getIcon', () => {
  it('returns the entry for a known name', () => {
    expect(getIcon('plus')).toBe(ICONS.plus);
  });

  it('returns undefined for an unknown name (runtime fallback)', () => {
    // @ts-expect-error - intentional runtime misuse path
    expect(getIcon('definitely-not-an-icon')).toBeUndefined();
  });
});

describe('iconSvg', () => {
  it('renders a Remix icon with ui-icon class and default md size', () => {
    const svg = iconSvg('plus');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('class="ui-icon"');
    expect(svg).toContain('width="16" height="16"');
  });

  it('maps size tokens to pixel width/height', () => {
    expect(iconSvg('plus', 'sm')).toContain(`width="${SIZE_PX.sm}" height="${SIZE_PX.sm}"`);
    expect(iconSvg('plus', 'md')).toContain(`width="${SIZE_PX.md}" height="${SIZE_PX.md}"`);
    expect(iconSvg('plus', 'lg')).toContain(`width="${SIZE_PX.lg}" height="${SIZE_PX.lg}"`);
  });

  it('does not duplicate width/height attributes from the raw icon', () => {
    const svg = iconSvg('plus');
    const widthCount = (svg.match(/\bwidth="/g) ?? []).length;
    const heightCount = (svg.match(/\bheight="/g) ?? []).length;
    expect(widthCount).toBe(1);
    expect(heightCount).toBe(1);
  });

  it('returns empty string for an unknown name', () => {
    // @ts-expect-error - intentional runtime misuse path
    expect(iconSvg('definitely-not-an-icon')).toBe('');
  });
});
