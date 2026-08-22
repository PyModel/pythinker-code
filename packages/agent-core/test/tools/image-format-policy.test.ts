import type { ContentPart } from '@pymodel/kosong';
import { describe, expect, it } from 'vitest';

import { gateImageFormatParts } from '../../src/tools/support/image-compress';

function image(mimeType: string, bytes: Buffer): ContentPart {
  return {
    type: 'image_url',
    imageUrl: { url: `data:${mimeType};base64,${bytes.toString('base64')}` },
  };
}

describe('gateImageFormatParts', () => {
  it('canonicalizes aliases and trusts recognized bytes over a wrong MIME label', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    expect(gateImageFormatParts([image('image/jpg', jpeg)])).toEqual([
      {
        type: 'image_url',
        imageUrl: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` },
      },
    ]);
    expect(gateImageFormatParts([image('image/png', jpeg)])).toEqual([
      {
        type: 'image_url',
        imageUrl: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` },
      },
    ]);
  });

  it('replaces unsupported images with text notices', () => {
    const bmp = Buffer.from('BMunsupported', 'binary');

    const parts = gateImageFormatParts([image('image/png', bmp)]);

    expect(parts).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringMatching(/image\/bmp/iu) }),
    ]);
  });
});
