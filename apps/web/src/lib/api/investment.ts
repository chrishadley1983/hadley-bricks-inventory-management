/**
 * API client functions for the investment tracker
 */

export interface InvestmentSet {
  id: string;
  set_number: string;
  set_name: string | null;
  theme: string | null;
  subtheme: string | null;
  year_from: number | null;
  pieces: number | null;
  minifigs: number | null;
  uk_retail_price: number | null;
  retirement_status: string | null;
  expected_retirement_date: string | null;
  retirement_confidence: string | null;
  exclusivity_tier: string | null;
  is_licensed: boolean | null;
  is_ucs: boolean | null;
  is_modular: boolean | null;
  image_url: string | null;
  availability: string | null;
}

export interface InvestmentFilters {
  search?: string;
  retirementStatus?: 'available' | 'retiring_soon' | 'retired';
  theme?: string;
  minYear?: number;
  maxYear?: number;
  retiringWithinMonths?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface InvestmentPaginationParams {
  page?: number;
  pageSize?: number;
}

interface InvestmentResponse {
  data: InvestmentSet[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchInvestmentSets(
  filters?: InvestmentFilters,
  pagination?: InvestmentPaginationParams
): Promise<InvestmentResponse> {
  const params = new URLSearchParams();

  if (pagination?.page) params.set('page', String(pagination.page));
  if (pagination?.pageSize) params.set('pageSize', String(pagination.pageSize));
  if (filters?.search) params.set('search', filters.search);
  if (filters?.retirementStatus) params.set('retirementStatus', filters.retirementStatus);
  if (filters?.theme) params.set('theme', filters.theme);
  if (filters?.minYear) params.set('minYear', String(filters.minYear));
  if (filters?.maxYear) params.set('maxYear', String(filters.maxYear));
  if (filters?.retiringWithinMonths) params.set('retiringWithinMonths', String(filters.retiringWithinMonths));
  if (filters?.sortBy) params.set('sortBy', filters.sortBy);
  if (filters?.sortOrder) params.set('sortOrder', filters.sortOrder);

  const response = await fetch(`/api/investment?${params.toString()}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch investment sets (${response.status})`);
  }

  return response.json();
}
