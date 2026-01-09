/**
 * Brickset API v3 Types
 *
 * Type definitions for the Brickset API responses and requests.
 */

// ============================================================================
// API Request Types
// ============================================================================

export interface BricksetSearchParams {
  /** Internal Brickset set ID */
  setID?: number;
  /** Search query (searches number, name, theme, subtheme) */
  query?: string;
  /** Filter by theme */
  theme?: string;
  /** Filter by subtheme */
  subtheme?: string;
  /** Full set number (e.g., "75192-1") */
  setNumber?: string;
  /** Release year (supports comma-delimited lists) */
  year?: string;
  /** Filter by tag */
  tag?: string;
  /** Results modified after date (yyyy-mm-dd) */
  updatedSince?: string;
  /** Sort order */
  orderBy?:
    | 'Number'
    | 'YearFrom'
    | 'Pieces'
    | 'Minifigs'
    | 'Rating'
    | 'UKRetailPrice'
    | 'USRetailPrice'
    | 'Theme'
    | 'Name'
    | 'Random';
  /** Page number (1-indexed) */
  pageNumber?: number;
  /** Records per page (default: 20, max: 500) */
  pageSize?: number;
  /** Include extended data (tags, descriptions, notes) */
  extendedData?: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface BricksetApiResponse<T = BricksetApiSet[]> {
  status: string;
  message?: string;
  matches?: number;
  sets?: T;
  themes?: BricksetTheme[];
}

export interface BricksetApiSet {
  setID: number;
  number: string;
  numberVariant: number;
  name: string;
  year: number;
  theme: string;
  themeGroup: string;
  subtheme: string;
  category: string;
  released: boolean;
  pieces: number;
  minifigs: number;
  image: {
    thumbnailURL: string;
    imageURL: string;
  };
  bricksetURL: string;
  collection: {
    owned: boolean;
    wanted: boolean;
    qtyOwned: number;
    rating: number;
    notes: string;
  };
  collections: {
    ownedBy: number;
    wantedBy: number;
  };
  LEGOCom: {
    US?: BricksetRegionData;
    UK?: BricksetRegionData;
    CA?: BricksetRegionData;
    DE?: BricksetRegionData;
  };
  rating: number;
  reviewCount: number;
  packagingType: string;
  availability: string;
  instructionsCount: number;
  additionalImageCount: number;
  ageRange: {
    min: number;
    max: number;
  };
  dimensions: {
    height: number;
    width: number;
    depth: number;
    weight: number;
  };
  barcode: {
    EAN: string;
    UPC: string;
  };
  extendedData?: {
    description: string;
    notes: string;
    tags: string[];
  };
  lastUpdated: string;
}

export interface BricksetRegionData {
  retailPrice: number;
  dateFirstAvailable: string;
  dateLastAvailable: string;
}

export interface BricksetTheme {
  theme: string;
  setCount: number;
  subthemeCount: number;
  yearFrom: number;
  yearTo: number;
}

export interface BricksetUsageStats {
  dateFrom: string;
  dateTo: string;
  count: number;
}

export interface BricksetKeyCheckResponse {
  status: string;
  message?: string;
}

// ============================================================================
// Internal Types (for cache/database)
// ============================================================================

export interface BricksetSet {
  id: string;
  setNumber: string;
  variant: number;
  bricksetId: number | null;
  yearFrom: number | null;
  category: string | null;
  theme: string | null;
  themeGroup: string | null;
  subtheme: string | null;
  setName: string;
  imageUrl: string | null;
  imageFilename: string | null;
  usRetailPrice: number | null;
  ukRetailPrice: number | null;
  caRetailPrice: number | null;
  deRetailPrice: number | null;
  usDateAdded: string | null;
  usDateRemoved: string | null;
  pieces: number | null;
  minifigs: number | null;
  packagingType: string | null;
  availability: string | null;
  usItemNumber: string | null;
  euItemNumber: string | null;
  ean: string | null;
  upc: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  weight: number | null;
  ageMin: number | null;
  ageMax: number | null;
  ownCount: number | null;
  wantCount: number | null;
  instructionsCount: number | null;
  additionalImageCount: number | null;
  released: boolean;
  rating: number | null;
  bricklinkSoldPriceNew: number | null;
  bricklinkSoldPriceUsed: number | null;
  designers: string[] | null;
  launchDate: string | null;
  exitDate: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BricksetCredentials {
  apiKey: string;
}

// ============================================================================
// Transformation Helpers
// ============================================================================

/**
 * Convert API response to internal BricksetSet format
 */
export function apiSetToInternal(apiSet: BricksetApiSet): Omit<BricksetSet, 'id' | 'createdAt' | 'updatedAt'> {
  // Extract image filename from URL
  const imageFilename = apiSet.image?.imageURL
    ? apiSet.image.imageURL.split('/').pop() || null
    : null;

  return {
    setNumber: `${apiSet.number}-${apiSet.numberVariant}`,
    variant: apiSet.numberVariant,
    bricksetId: apiSet.setID,
    yearFrom: apiSet.year,
    category: apiSet.category || null,
    theme: apiSet.theme || null,
    themeGroup: apiSet.themeGroup || null,
    subtheme: apiSet.subtheme || null,
    setName: apiSet.name,
    imageUrl: apiSet.image?.imageURL || null,
    imageFilename,
    usRetailPrice: apiSet.LEGOCom?.US?.retailPrice || null,
    ukRetailPrice: apiSet.LEGOCom?.UK?.retailPrice || null,
    caRetailPrice: apiSet.LEGOCom?.CA?.retailPrice || null,
    deRetailPrice: apiSet.LEGOCom?.DE?.retailPrice || null,
    usDateAdded: apiSet.LEGOCom?.US?.dateFirstAvailable || null,
    usDateRemoved: apiSet.LEGOCom?.US?.dateLastAvailable || null,
    pieces: apiSet.pieces || null,
    minifigs: apiSet.minifigs || null,
    packagingType: apiSet.packagingType || null,
    availability: apiSet.availability || null,
    usItemNumber: null, // Not directly in standard response
    euItemNumber: null, // Not directly in standard response
    ean: apiSet.barcode?.EAN || null,
    upc: apiSet.barcode?.UPC || null,
    width: apiSet.dimensions?.width || null,
    height: apiSet.dimensions?.height || null,
    depth: apiSet.dimensions?.depth || null,
    weight: apiSet.dimensions?.weight || null,
    ageMin: apiSet.ageRange?.min || null,
    ageMax: apiSet.ageRange?.max || null,
    ownCount: apiSet.collections?.ownedBy || null,
    wantCount: apiSet.collections?.wantedBy || null,
    instructionsCount: apiSet.instructionsCount || null,
    additionalImageCount: apiSet.additionalImageCount || null,
    released: apiSet.released || false,
    rating: apiSet.rating || null,
    bricklinkSoldPriceNew: null, // Would need separate BrickLink API call
    bricklinkSoldPriceUsed: null, // Would need separate BrickLink API call
    designers: apiSet.extendedData?.tags?.filter(t => t.startsWith('Designer:'))
      .map(t => t.replace('Designer:', '').trim()) || null,
    launchDate: apiSet.LEGOCom?.UK?.dateFirstAvailable || apiSet.LEGOCom?.US?.dateFirstAvailable || null,
    exitDate: apiSet.LEGOCom?.UK?.dateLastAvailable || apiSet.LEGOCom?.US?.dateLastAvailable || null,
    lastFetchedAt: new Date().toISOString(),
  };
}

/**
 * Convert internal format to database insert format
 */
export function internalToDbInsert(set: Omit<BricksetSet, 'id' | 'createdAt' | 'updatedAt'>) {
  return {
    set_number: set.setNumber,
    variant: set.variant,
    brickset_id: set.bricksetId,
    year_from: set.yearFrom,
    category: set.category,
    theme: set.theme,
    theme_group: set.themeGroup,
    subtheme: set.subtheme,
    set_name: set.setName,
    image_url: set.imageUrl,
    image_filename: set.imageFilename,
    us_retail_price: set.usRetailPrice,
    uk_retail_price: set.ukRetailPrice,
    ca_retail_price: set.caRetailPrice,
    de_retail_price: set.deRetailPrice,
    us_date_added: set.usDateAdded,
    us_date_removed: set.usDateRemoved,
    pieces: set.pieces,
    minifigs: set.minifigs,
    packaging_type: set.packagingType,
    availability: set.availability,
    us_item_number: set.usItemNumber,
    eu_item_number: set.euItemNumber,
    ean: set.ean,
    upc: set.upc,
    width: set.width,
    height: set.height,
    depth: set.depth,
    weight: set.weight,
    age_min: set.ageMin,
    age_max: set.ageMax,
    own_count: set.ownCount,
    want_count: set.wantCount,
    instructions_count: set.instructionsCount,
    additional_image_count: set.additionalImageCount,
    released: set.released,
    rating: set.rating,
    bricklink_sold_price_new: set.bricklinkSoldPriceNew,
    bricklink_sold_price_used: set.bricklinkSoldPriceUsed,
    designers: set.designers,
    launch_date: set.launchDate,
    exit_date: set.exitDate,
    last_fetched_at: set.lastFetchedAt,
  };
}

/**
 * Convert database row to internal format
 */
export function dbRowToInternal(row: Record<string, unknown>): BricksetSet {
  return {
    id: row.id as string,
    setNumber: row.set_number as string,
    variant: (row.variant as number) || 1,
    bricksetId: row.brickset_id as number | null,
    yearFrom: row.year_from as number | null,
    category: row.category as string | null,
    theme: row.theme as string | null,
    themeGroup: row.theme_group as string | null,
    subtheme: row.subtheme as string | null,
    setName: row.set_name as string,
    imageUrl: row.image_url as string | null,
    imageFilename: row.image_filename as string | null,
    usRetailPrice: row.us_retail_price as number | null,
    ukRetailPrice: row.uk_retail_price as number | null,
    caRetailPrice: row.ca_retail_price as number | null,
    deRetailPrice: row.de_retail_price as number | null,
    usDateAdded: row.us_date_added as string | null,
    usDateRemoved: row.us_date_removed as string | null,
    pieces: row.pieces as number | null,
    minifigs: row.minifigs as number | null,
    packagingType: row.packaging_type as string | null,
    availability: row.availability as string | null,
    usItemNumber: row.us_item_number as string | null,
    euItemNumber: row.eu_item_number as string | null,
    ean: row.ean as string | null,
    upc: row.upc as string | null,
    width: row.width as number | null,
    height: row.height as number | null,
    depth: row.depth as number | null,
    weight: row.weight as number | null,
    ageMin: row.age_min as number | null,
    ageMax: row.age_max as number | null,
    ownCount: row.own_count as number | null,
    wantCount: row.want_count as number | null,
    instructionsCount: row.instructions_count as number | null,
    additionalImageCount: row.additional_image_count as number | null,
    released: (row.released as boolean) || false,
    rating: row.rating as number | null,
    bricklinkSoldPriceNew: row.bricklink_sold_price_new as number | null,
    bricklinkSoldPriceUsed: row.bricklink_sold_price_used as number | null,
    designers: row.designers as string[] | null,
    launchDate: row.launch_date as string | null,
    exitDate: row.exit_date as string | null,
    lastFetchedAt: row.last_fetched_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
