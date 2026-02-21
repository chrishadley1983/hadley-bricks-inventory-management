import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { ImageSourcer } from '../src/lib/minifig-sync/image-sourcer';

async function test() {
  const sourcer = new ImageSourcer(process.env.REBRICKABLE_API_KEY ?? '');

  console.log('Testing image sourcing for sw1096 (Ahsoka Tano)...\n');
  const images = await sourcer.sourceImages(
    'Ahsoka Tano (Adult) - Dark Blue Jumpsuit',
    'sw1096',
    'https://example.com/bricqer-fallback.jpg',
  );

  console.log(`\nResult: ${images.length} images sourced`);
  for (const img of images) {
    console.log(`  [${img.source}/${img.type}] ${img.url.substring(0, 120)}`);
  }
}

test().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
