import { z } from 'zod';
import { ALL_PLATFORMS, SELLING_PLATFORMS, TARGET_PLATFORMS } from '@hadley-bricks/database';

/**
 * Schema for all platforms (integration sources)
 */
export const allPlatformSchema = z.enum(ALL_PLATFORMS);

/**
 * Schema for selling platforms (where inventory is listed)
 */
export const sellingPlatformSchema = z.enum(SELLING_PLATFORMS);

/**
 * Schema for target platforms (purchase evaluator)
 */
export const targetPlatformSchema = z.enum(TARGET_PLATFORMS);

/**
 * Optional selling platform schema (nullable)
 */
export const sellingPlatformOptionalSchema = sellingPlatformSchema.nullable().optional();

/**
 * Optional target platform schema (nullable)
 */
export const targetPlatformOptionalSchema = targetPlatformSchema.nullable().optional();

/**
 * Transform string to lowercase before validation
 */
export const sellingPlatformTransformSchema = z
  .string()
  .transform((val) => val.toLowerCase().trim())
  .pipe(sellingPlatformSchema);

/**
 * Optional selling platform with lowercase transform
 */
export const sellingPlatformTransformOptionalSchema = z
  .string()
  .transform((val) => val.toLowerCase().trim())
  .pipe(sellingPlatformSchema)
  .nullable()
  .optional();
