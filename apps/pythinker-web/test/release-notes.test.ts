import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';

import ReleaseNotes from '../src/components/ReleaseNotes.vue';
import enUpdate from '../src/i18n/locales/en/update';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { update: enUpdate } },
});

function render(text: string) {
  return mount(ReleaseNotes, { props: { text }, global: { plugins: [i18n] } });
}

describe('ReleaseNotes', () => {
  it('renders the body the release generator produces', () => {
    const wrapper = render(
      '- Install Windows updates in the background instead of opening the installer wizard.\n'
      + '\n---\n\n'
      + 'Built from https://github.com/PyModel/pythinker-code/commit/e9ebda621aa4c9f1b2.\n',
    );

    const items = wrapper.findAll('.release-notes__list li');
    expect(items).toHaveLength(1);
    expect(items[0]?.text())
      .toBe('Install Windows updates in the background instead of opening the installer wizard.');

    const link = wrapper.get('[data-testid="release-notes-provenance"] a');
    expect(link.text()).toBe('e9ebda6');
    expect(link.attributes('href'))
      .toBe('https://github.com/PyModel/pythinker-code/commit/e9ebda621aa4c9f1b2');
    expect(link.attributes('rel')).toBe('noreferrer noopener');
    expect(wrapper.get('[data-testid="release-notes-provenance"]').text())
      .toBe('Built from e9ebda6');
  });

  it('keeps the provenance line out of the notes themselves', () => {
    const wrapper = render('- One fix.\n\n---\n\nBuilt from https://example.com/commit/abc1234.');

    expect(wrapper.findAll('.release-notes__list li')).toHaveLength(1);
    expect(wrapper.findAll('.release-notes__paragraph')).toHaveLength(0);
  });

  it('groups a heading with the bullets under it', () => {
    const wrapper = render('## New Features\n\n- Added the compact updater.\n- Added a second thing.');

    expect(wrapper.get('.release-notes__heading').text()).toBe('New Features');
    expect(wrapper.findAll('.release-notes__list li').map(item => item.text()))
      .toEqual(['Added the compact updater.', 'Added a second thing.']);
  });

  it('joins a wrapped bullet into one item', () => {
    const wrapper = render('- A note that the release body\n  wrapped across two lines.');

    expect(wrapper.findAll('.release-notes__list li').map(item => item.text()))
      .toEqual(['A note that the release body wrapped across two lines.']);
  });

  it('renders markup as text rather than as elements', () => {
    // What `updater.ts` hands over once it has reduced GitHub's rendered HTML:
    // the angle brackets arrive escaped so the value stays inert for any
    // renderer. Show the characters the author typed, never an element.
    const wrapper = render('Note\n&lt;script&gt;payload&lt;/script&gt;');

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.get('.release-notes__paragraph').text())
      .toBe('Note <script>payload</script>');
    expect(wrapper.html()).not.toContain('<script>');
  });

  it('refuses a provenance link that is not a web page', () => {
    const wrapper = render('- One fix.\n\nBuilt from javascript:alert(1).');

    expect(wrapper.find('[data-testid="release-notes-provenance"]').exists()).toBe(false);
    expect(wrapper.findAll('a')).toHaveLength(0);
  });

  it('falls back to the unavailable message when there is nothing to show', () => {
    expect(render('').get('.release-notes__empty').text())
      .toBe('Release notes are not available for this version.');
    expect(render('\n\n---\n\n').get('.release-notes__empty').exists()).toBe(true);
  });
});
