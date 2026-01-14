/**
 * Templates Hooks
 *
 * React Query hooks for managing listing templates.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ListingTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
} from '@/lib/listing-assistant/types';

// ============================================
// Query Keys
// ============================================

export const templateKeys = {
  all: ['listing-templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: () => [...templateKeys.lists()] as const,
  details: () => [...templateKeys.all, 'detail'] as const,
  detail: (id: string) => [...templateKeys.details(), id] as const,
};

// ============================================
// API Functions
// ============================================

async function fetchTemplates(): Promise<ListingTemplate[]> {
  const response = await fetch('/api/listing-assistant/templates');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch templates');
  }

  const { data } = await response.json();
  return data;
}

async function fetchTemplate(id: string): Promise<ListingTemplate> {
  const response = await fetch(`/api/listing-assistant/templates/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch template');
  }

  const { data } = await response.json();
  return data;
}

async function createTemplate(input: CreateTemplateInput): Promise<ListingTemplate> {
  const response = await fetch('/api/listing-assistant/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create template');
  }

  const { data } = await response.json();
  return data;
}

async function updateTemplate({
  id,
  ...input
}: UpdateTemplateInput & { id: string }): Promise<ListingTemplate> {
  const response = await fetch(`/api/listing-assistant/templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update template');
  }

  const { data } = await response.json();
  return data;
}

async function deleteTemplate(id: string): Promise<void> {
  const response = await fetch(`/api/listing-assistant/templates/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete template');
  }
}

// ============================================
// Hooks
// ============================================

/**
 * Hook to fetch all templates
 */
export function useTemplates() {
  return useQuery({
    queryKey: templateKeys.list(),
    queryFn: fetchTemplates,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch a single template
 */
export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: templateKeys.detail(id || ''),
    queryFn: () => fetchTemplate(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to create a new template
 */
export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() });
    },
  });
}

/**
 * Hook to update a template
 */
export function useUpdateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateTemplate,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() });
      queryClient.setQueryData(templateKeys.detail(data.id), data);
    },
  });
}

/**
 * Hook to delete a template
 */
export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() });
    },
  });
}
