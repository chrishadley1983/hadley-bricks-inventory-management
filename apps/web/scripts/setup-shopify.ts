/**
 * One-time Shopify store setup script.
 *
 * Creates pages, smart collections, blog posts, navigation menus,
 * and fetches the location ID — all via the Shopify Admin API.
 *
 * Usage:  cd apps/web && npx tsx scripts/setup-shopify.ts
 *
 * Idempotent: safe to run multiple times.
 */
import dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local from the apps/web directory
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { ShopifyClient } from '../src/lib/shopify/client';
import * as fs from 'fs';

// ── Types ──────────────────────────────────────────────────────

interface ShopifyPage {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  template_suffix: string | null;
}

interface ShopifySmartCollection {
  id: number;
  title: string;
  handle: string;
  rules: Array<{ column: string; relation: string; condition: string }>;
  disjunctive: boolean;
}

interface ShopifyBlog {
  id: number;
  title: string;
  handle: string;
}

interface ShopifyArticle {
  id: number;
  title: string;
  handle: string;
  blog_id: number;
}

// ── Helpers ────────────────────────────────────────────────────

function log(emoji: string, msg: string) {
  console.log(`${emoji}  ${msg}`);
}

function logSection(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

// ── Bootstrap ──────────────────────────────────────────────────

async function bootstrap() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: config, error } = await supabase
    .from('shopify_config')
    .select('*')
    .limit(1)
    .single();

  if (error || !config) {
    throw new Error(`Failed to fetch shopify_config: ${error?.message ?? 'no row found'}`);
  }

  log('OK', `Connected to shop: ${config.shop_domain}`);

  const client = new ShopifyClient({
    shop_domain: config.shop_domain,
    client_id: config.client_id,
    client_secret: config.client_secret,
    api_version: config.api_version,
  });

  return { supabase, client, config };
}

// ── Step 1: Pages ──────────────────────────────────────────────

const PAGES_TO_CREATE = [
  {
    title: 'About',
    handle: 'about',
    template_suffix: 'about',
    body_html: '',
  },
  {
    title: 'Our Stores',
    handle: 'our-stores',
    template_suffix: 'our-stores',
    body_html: '',
  },
  {
    title: 'Shipping & Returns',
    handle: 'shipping-returns',
    template_suffix: 'shipping-returns',
    body_html: `<p>Delivery is via Royal Mail or Hermes, depending on the size and weight of your order.</p>
<ul>
<li>Orders over £50: Free tracked shipping</li>
<li>Standard delivery: £2.99 (2-3 working days)</li>
<li>Tracked delivery: £3.99 (1-2 working days)</li>
</ul>
<p>We dispatch within 1-2 business days. You'll receive tracking information by email once your order ships.</p>
<p><strong>Returns:</strong> If you're not happy with your purchase, contact us within 14 days for a full refund. Items must be in the condition they were received. We cover return shipping if the item is faulty or doesn't match its description.</p>`,
  },
  {
    title: 'Contact',
    handle: 'contact',
    template_suffix: 'contact',
    body_html: '',
  },
];

async function createPages(client: ShopifyClient): Promise<Map<string, number>> {
  logSection('Step 1: Create Pages');
  const pageGids = new Map<string, number>();

  for (const page of PAGES_TO_CREATE) {
    // Check if page already exists
    const existing = await client.request<{ pages: ShopifyPage[] }>(
      'GET',
      `/pages.json?handle=${page.handle}&fields=id,handle,title`
    );

    if (existing.pages.length > 0) {
      const p = existing.pages[0];
      log('SKIP', `Page "${p.title}" already exists (id: ${p.id})`);
      pageGids.set(page.handle, p.id);
      continue;
    }

    const created = await client.request<{ page: ShopifyPage }>('POST', '/pages.json', {
      page: {
        title: page.title,
        handle: page.handle,
        body_html: page.body_html,
        template_suffix: page.template_suffix,
        published: true,
      },
    });

    log('OK', `Created page "${created.page.title}" (id: ${created.page.id})`);
    pageGids.set(page.handle, created.page.id);
  }

  return pageGids;
}

// ── Step 2: Smart Collections ──────────────────────────────────

const COLLECTIONS_TO_CREATE = [
  {
    title: 'New & Sealed',
    handle: 'sealed-sets',
    rules: [
      { column: 'tag', relation: 'equals', condition: 'New' },
      { column: 'tag', relation: 'equals', condition: 'Sealed' },
    ],
    disjunctive: false,
  },
  {
    title: 'Restored Sets',
    handle: 'restored-used-sets',
    rules: [
      { column: 'tag', relation: 'equals', condition: 'Used' },
      { column: 'tag', relation: 'equals', condition: 'Restored' },
    ],
    disjunctive: false,
  },
  {
    title: 'Minifigures',
    handle: 'minifigures',
    rules: [{ column: 'type', relation: 'equals', condition: 'Minifigure' }],
    disjunctive: false,
  },
];

async function createSmartCollections(
  client: ShopifyClient
): Promise<Map<string, number>> {
  logSection('Step 2: Create Smart Collections');
  const collectionGids = new Map<string, number>();

  for (const col of COLLECTIONS_TO_CREATE) {
    // Check if collection already exists
    const existing = await client.request<{ smart_collections: ShopifySmartCollection[] }>(
      'GET',
      `/smart_collections.json?handle=${col.handle}&fields=id,handle,title`
    );

    if (existing.smart_collections.length > 0) {
      const c = existing.smart_collections[0];
      log('SKIP', `Collection "${c.title}" already exists (id: ${c.id})`);
      collectionGids.set(col.handle, c.id);
      continue;
    }

    const created = await client.request<{ smart_collection: ShopifySmartCollection }>(
      'POST',
      '/smart_collections.json',
      {
        smart_collection: {
          title: col.title,
          handle: col.handle,
          rules: col.rules,
          disjunctive: col.disjunctive,
          published: true,
        },
      }
    );

    log('OK', `Created collection "${created.smart_collection.title}" (id: ${created.smart_collection.id})`);
    collectionGids.set(col.handle, created.smart_collection.id);
  }

  return collectionGids;
}

// ── Step 3: Blog + Posts ───────────────────────────────────────

interface BlogPostMeta {
  title: string;
  handle: string;
  tags: string;
  seoTitle: string;
  seoDescription: string;
}

function parseBlogPostFile(filePath: string): { meta: BlogPostMeta; bodyHtml: string } {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Parse the HTML comment header
  const commentMatch = content.match(/<!--\s*([\s\S]*?)-->/);
  if (!commentMatch) throw new Error(`No metadata comment found in ${filePath}`);

  const metaBlock = commentMatch[1];
  const getField = (label: string): string => {
    const match = metaBlock.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
    return match ? match[1].trim() : '';
  };

  const meta: BlogPostMeta = {
    title: getField('Blog Post \\d+').replace(/^:\s*/, ''),
    handle: getField('URL Handle'),
    tags: getField('Tags'),
    seoTitle: getField('SEO Title'),
    seoDescription: getField('SEO Description'),
  };

  // Body is everything after the closing comment
  const bodyHtml = content.replace(/<!--[\s\S]*?-->\s*/, '').trim();

  return { meta, bodyHtml };
}

async function createBlogPosts(client: ShopifyClient): Promise<void> {
  logSection('Step 3: Create Blog + Posts');

  // Find or create the "News" blog
  const existingBlogs = await client.request<{ blogs: ShopifyBlog[] }>(
    'GET',
    '/blogs.json?fields=id,title,handle'
  );

  let blogId: number;
  const newsBlog = existingBlogs.blogs.find(
    (b) => b.handle === 'news' || b.title.toLowerCase() === 'news'
  );

  if (newsBlog) {
    blogId = newsBlog.id;
    log('SKIP', `Blog "News" already exists (id: ${blogId})`);
  } else {
    const created = await client.request<{ blog: ShopifyBlog }>('POST', '/blogs.json', {
      blog: { title: 'News' },
    });
    blogId = created.blog.id;
    log('OK', `Created blog "News" (id: ${blogId})`);
  }

  // Get existing articles to avoid duplicates
  const existingArticles = await client.request<{ articles: ShopifyArticle[] }>(
    'GET',
    `/blogs/${blogId}/articles.json?fields=id,handle,title`
  );
  const existingHandles = new Set(existingArticles.articles.map((a) => a.handle));

  // Create articles from content files
  const contentDir = path.resolve(__dirname, '../../../docs/shopify-content');
  const blogFiles = [
    path.join(contentDir, 'blog-post-1-restoration.html'),
    path.join(contentDir, 'blog-post-2-investing-retired-lego.html'),
  ];

  for (const filePath of blogFiles) {
    const { meta, bodyHtml } = parseBlogPostFile(filePath);

    if (existingHandles.has(meta.handle)) {
      log('SKIP', `Article "${meta.title}" already exists`);
      continue;
    }

    await client.request('POST', `/blogs/${blogId}/articles.json`, {
      article: {
        title: meta.title,
        handle: meta.handle,
        body_html: bodyHtml,
        tags: meta.tags,
        author: 'Hadley Bricks',
        published: true,
        metafields: [
          {
            namespace: 'global',
            key: 'title_tag',
            value: meta.seoTitle,
            type: 'single_line_text_field',
          },
          {
            namespace: 'global',
            key: 'description_tag',
            value: meta.seoDescription,
            type: 'single_line_text_field',
          },
        ],
      },
    });

    log('OK', `Created article "${meta.title}"`);
  }
}

// ── Step 4: Navigation Menus ───────────────────────────────────

async function createNavigationMenus(
  client: ShopifyClient,
  pageIds: Map<string, number>,
  collectionIds: Map<string, number>
): Promise<void> {
  logSection('Step 4: Create Navigation Menus');

  // Helper to build Shopify GIDs
  const pageGid = (id: number) => `gid://shopify/Page/${id}`;
  const collectionGid = (id: number) => `gid://shopify/Collection/${id}`;

  // Check existing menus
  const existingMenusQuery = `{
    menus(first: 10) {
      nodes {
        id
        handle
        title
      }
    }
  }`;

  const existingMenus = await client.graphql<{
    menus: { nodes: Array<{ id: string; handle: string; title: string }> };
  }>(existingMenusQuery);

  const existingHandles = new Set(existingMenus.menus.nodes.map((m) => m.handle));

  // Define menus
  const menus = [
    {
      title: 'Main Menu',
      handle: 'main-menu',
      items: [
        { title: 'Shop', type: 'HTTP', url: '/collections/all' },
        {
          title: 'New & Sealed',
          type: 'COLLECTION',
          resourceId: collectionIds.has('sealed-sets')
            ? collectionGid(collectionIds.get('sealed-sets')!)
            : undefined,
          url: collectionIds.has('sealed-sets') ? undefined : '/collections/sealed-sets',
        },
        {
          title: 'Restored Sets',
          type: 'COLLECTION',
          resourceId: collectionIds.has('restored-used-sets')
            ? collectionGid(collectionIds.get('restored-used-sets')!)
            : undefined,
          url: collectionIds.has('restored-used-sets')
            ? undefined
            : '/collections/restored-used-sets',
        },
        {
          title: 'Minifigures',
          type: 'COLLECTION',
          resourceId: collectionIds.has('minifigures')
            ? collectionGid(collectionIds.get('minifigures')!)
            : undefined,
          url: collectionIds.has('minifigures') ? undefined : '/collections/minifigures',
        },
        {
          title: 'About',
          type: 'PAGE',
          resourceId: pageIds.has('about') ? pageGid(pageIds.get('about')!) : undefined,
          url: pageIds.has('about') ? undefined : '/pages/about',
        },
        {
          title: 'Our Stores',
          type: 'PAGE',
          resourceId: pageIds.has('our-stores')
            ? pageGid(pageIds.get('our-stores')!)
            : undefined,
          url: pageIds.has('our-stores') ? undefined : '/pages/our-stores',
        },
      ],
    },
    {
      title: 'Quick Links',
      handle: 'quick-links',
      items: [
        { title: 'Shop All', type: 'HTTP', url: '/collections/all' },
        { title: 'New Arrivals', type: 'HTTP', url: '/collections/new-arrivals' },
        {
          title: 'About Us',
          type: 'PAGE',
          resourceId: pageIds.has('about') ? pageGid(pageIds.get('about')!) : undefined,
          url: pageIds.has('about') ? undefined : '/pages/about',
        },
        {
          title: 'Shipping & Returns',
          type: 'PAGE',
          resourceId: pageIds.has('shipping-returns')
            ? pageGid(pageIds.get('shipping-returns')!)
            : undefined,
          url: pageIds.has('shipping-returns') ? undefined : '/pages/shipping-returns',
        },
        {
          title: 'Contact',
          type: 'PAGE',
          resourceId: pageIds.has('contact') ? pageGid(pageIds.get('contact')!) : undefined,
          url: pageIds.has('contact') ? undefined : '/pages/contact',
        },
      ],
    },
    {
      title: 'Our Stores',
      handle: 'our-stores',
      items: [
        {
          title: 'eBay',
          type: 'HTTP',
          url: 'https://www.ebay.co.uk/str/hadleybricksandkicks',
        },
        {
          title: 'Amazon',
          type: 'HTTP',
          url: 'https://www.amazon.co.uk/s?me=A2RXC77QD4YUR2&marketplaceID=A1F83G8C2ARO7P',
        },
        {
          title: 'BrickLink',
          type: 'HTTP',
          url: 'https://store.bricklink.com/hadleybric',
        },
        {
          title: 'Brick Owl',
          type: 'HTTP',
          url: 'https://hadleybricks.brickowl.com/',
        },
      ],
    },
  ];

  for (const menu of menus) {
    if (existingHandles.has(menu.handle)) {
      log('SKIP', `Menu "${menu.title}" already exists`);
      continue;
    }

    // Build menu items for the mutation
    const menuItems = menu.items.map((item) => {
      const menuItem: Record<string, unknown> = {
        title: item.title,
        type: item.resourceId ? item.type : 'HTTP',
      };

      if (item.resourceId) {
        menuItem.resourceId = item.resourceId;
      } else if (item.url) {
        menuItem.url = item.url;
      }

      return menuItem;
    });

    const mutation = `
      mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
        menuCreate(title: $title, handle: $handle, items: $items) {
          menu {
            id
            handle
            title
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await client.graphql<{
      menuCreate: {
        menu: { id: string; handle: string; title: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(mutation, {
      title: menu.title,
      handle: menu.handle,
      items: menuItems,
    });

    if (result.menuCreate.userErrors.length > 0) {
      const errors = result.menuCreate.userErrors.map((e) => e.message).join(', ');
      log('ERR', `Failed to create menu "${menu.title}": ${errors}`);
    } else {
      log('OK', `Created menu "${menu.title}" (${result.menuCreate.menu?.id})`);
    }
  }
}

// ── Step 5: Fetch Location ID ──────────────────────────────────

async function fetchLocationId(
  client: ShopifyClient,
  supabase: ReturnType<typeof createClient>,
  configId: string
): Promise<void> {
  logSection('Step 5: Fetch Location ID');

  const { locations } = await client.getLocations();

  if (locations.length === 0) {
    log('ERR', 'No locations found in Shopify store');
    return;
  }

  const primary = locations[0];
  log('OK', `Found location: "${primary.name}" (id: ${primary.id})`);

  const { error } = await supabase
    .from('shopify_config')
    .update({ location_id: String(primary.id) })
    .eq('id', configId);

  if (error) {
    log('ERR', `Failed to update shopify_config.location_id: ${error.message}`);
  } else {
    log('OK', `Updated shopify_config.location_id = ${primary.id}`);
  }
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n  Shopify Store Setup Script');
  console.log('  =========================\n');

  const { supabase, client, config } = await bootstrap();

  const pageIds = await createPages(client);
  const collectionIds = await createSmartCollections(client);
  await createBlogPosts(client);
  await createNavigationMenus(client, pageIds, collectionIds);
  await fetchLocationId(client, supabase, config.id);

  logSection('Done!');
  log('OK', 'All setup tasks complete. Review your Shopify admin to confirm.');
  log('', 'Note: "New Arrivals" collection must be created manually (time-based rule).');
  log('', 'Note: Photos/images must be uploaded manually via the Shopify theme editor.');
  console.log();
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
