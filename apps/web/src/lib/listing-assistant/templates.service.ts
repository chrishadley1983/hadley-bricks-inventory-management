/**
 * Templates Service
 *
 * Handles CRUD operations for listing templates in Supabase.
 */

import { createClient } from '@/lib/supabase/server';
import type { ListingTemplate, CreateTemplateInput, UpdateTemplateInput } from './types';
import { DEFAULT_TEMPLATES } from './constants';

/**
 * Get all templates for a user
 */
export async function getTemplates(userId: string): Promise<ListingTemplate[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_templates')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('name');

  if (error) {
    console.error('[Templates] Failed to fetch templates:', error);
    throw new Error('Failed to fetch templates');
  }

  return data as ListingTemplate[];
}

/**
 * Get a single template by ID
 */
export async function getTemplateById(
  userId: string,
  templateId: string
): Promise<ListingTemplate | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_templates')
    .select('*')
    .eq('id', templateId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    console.error('[Templates] Failed to fetch template:', error);
    throw new Error('Failed to fetch template');
  }

  return data as ListingTemplate;
}

/**
 * Create a new template
 */
export async function createTemplate(
  userId: string,
  input: CreateTemplateInput
): Promise<ListingTemplate> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_templates')
    .insert({
      user_id: userId,
      name: input.name,
      content: input.content,
      type: input.type,
      is_default: input.is_default ?? false,
    })
    .select()
    .single();

  if (error) {
    console.error('[Templates] Failed to create template:', error);
    throw new Error('Failed to create template');
  }

  return data as ListingTemplate;
}

/**
 * Update an existing template
 */
export async function updateTemplate(
  userId: string,
  templateId: string,
  input: UpdateTemplateInput
): Promise<ListingTemplate> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listing_templates')
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.content !== undefined && { content: input.content }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.is_default !== undefined && { is_default: input.is_default }),
    })
    .eq('id', templateId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('[Templates] Failed to update template:', error);
    throw new Error('Failed to update template');
  }

  return data as ListingTemplate;
}

/**
 * Delete a template (only custom templates can be deleted)
 */
export async function deleteTemplate(userId: string, templateId: string): Promise<void> {
  const supabase = await createClient();

  // First check if it's a default template
  const template = await getTemplateById(userId, templateId);
  if (template?.is_default) {
    throw new Error('Cannot delete default templates');
  }

  const { error } = await supabase
    .from('listing_templates')
    .delete()
    .eq('id', templateId)
    .eq('user_id', userId);

  if (error) {
    console.error('[Templates] Failed to delete template:', error);
    throw new Error('Failed to delete template');
  }
}

/**
 * Seed default templates for a new user
 * Call this when the user first accesses the Listing Assistant
 */
export async function seedDefaultTemplates(userId: string): Promise<ListingTemplate[]> {
  const supabase = await createClient();

  // Check if user already has templates
  const { count } = await supabase
    .from('listing_templates')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (count && count > 0) {
    // User already has templates, fetch and return them
    return getTemplates(userId);
  }

  // Seed default templates
  const templatesWithUserId = DEFAULT_TEMPLATES.map((template) => ({
    user_id: userId,
    name: template.name,
    content: template.content,
    type: template.type,
    is_default: template.is_default ?? false,
  }));

  const { data, error } = await supabase
    .from('listing_templates')
    .insert(templatesWithUserId)
    .select();

  if (error) {
    console.error('[Templates] Failed to seed default templates:', error);
    throw new Error('Failed to seed default templates');
  }

  return data as ListingTemplate[];
}

/**
 * Ensure user has templates, seeding defaults if needed
 */
export async function ensureTemplates(userId: string): Promise<ListingTemplate[]> {
  const templates = await getTemplates(userId);

  if (templates.length === 0) {
    return seedDefaultTemplates(userId);
  }

  return templates;
}
