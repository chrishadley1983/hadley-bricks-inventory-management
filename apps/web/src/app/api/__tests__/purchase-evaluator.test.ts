import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Supabase client
const mockUser = { id: 'user-123', email: 'test@example.com' };
const mockSupabaseClient = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabaseClient)),
}));

// Shared mock service methods
const mockServiceMethods = {
  getEvaluations: vi.fn(),
  createEvaluation: vi.fn(),
  getEvaluation: vi.fn(),
  updateEvaluation: vi.fn(),
  deleteEvaluation: vi.fn(),
  updateItem: vi.fn(),
  allocateCosts: vi.fn(),
  runLookups: vi.fn(),
  calculateProfitability: vi.fn(),
  updateEvaluationSummary: vi.fn(),
};

vi.mock('@/lib/purchase-evaluator/evaluator.service', () => ({
  PurchaseEvaluatorService: function MockPurchaseEvaluatorService() {
    return mockServiceMethods;
  },
}));

vi.mock('@/lib/purchase-evaluator/parser', () => ({
  generateTemplate: vi.fn(() => 'Item Code,Condition\n75192,New'),
}));

describe('Purchase Evaluator API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });
  });

  // ============================================
  // GET /api/purchase-evaluator
  // ============================================

  describe('GET /api/purchase-evaluator', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const { GET } = await import('../purchase-evaluator/route');
      const response = await GET();

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should return evaluations for authenticated user', async () => {
      const mockEvaluations = [
        { id: 'eval-1', name: 'Evaluation 1', status: 'completed' },
        { id: 'eval-2', name: 'Evaluation 2', status: 'draft' },
      ];

      mockServiceMethods.getEvaluations.mockResolvedValue(mockEvaluations);

      const { GET } = await import('../purchase-evaluator/route');
      const response = await GET();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toHaveLength(2);
      expect(mockServiceMethods.getEvaluations).toHaveBeenCalledWith('user-123');
    });

    it('should return 500 on service error', async () => {
      mockServiceMethods.getEvaluations.mockRejectedValue(new Error('Database error'));

      const { GET } = await import('../purchase-evaluator/route');
      const response = await GET();

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal server error');
    });
  });

  // ============================================
  // POST /api/purchase-evaluator
  // ============================================

  describe('POST /api/purchase-evaluator', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const { POST } = await import('../purchase-evaluator/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator', {
        method: 'POST',
        body: JSON.stringify({
          source: 'csv_upload',
          defaultPlatform: 'amazon',
          items: [{ setNumber: '75192', condition: 'New' }],
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it('should create evaluation with valid input', async () => {
      const mockEvaluation = {
        id: 'eval-1',
        name: 'New Evaluation',
        source: 'csv_upload',
        defaultPlatform: 'amazon',
        status: 'draft',
      };

      mockServiceMethods.createEvaluation.mockResolvedValue(mockEvaluation);

      const { POST } = await import('../purchase-evaluator/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Evaluation',
          source: 'csv_upload',
          defaultPlatform: 'amazon',
          items: [{ setNumber: '75192', condition: 'New' }],
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.id).toBe('eval-1');
    });

    it('should return 400 for invalid source', async () => {
      const { POST } = await import('../purchase-evaluator/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator', {
        method: 'POST',
        body: JSON.stringify({
          source: 'invalid_source',
          defaultPlatform: 'amazon',
          items: [{ setNumber: '75192', condition: 'New' }],
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('should return 400 for invalid platform', async () => {
      const { POST } = await import('../purchase-evaluator/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator', {
        method: 'POST',
        body: JSON.stringify({
          source: 'csv_upload',
          defaultPlatform: 'invalid',
          items: [{ setNumber: '75192', condition: 'New' }],
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty items array', async () => {
      const { POST } = await import('../purchase-evaluator/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator', {
        method: 'POST',
        body: JSON.stringify({
          source: 'csv_upload',
          defaultPlatform: 'amazon',
          items: [],
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid item condition', async () => {
      const { POST } = await import('../purchase-evaluator/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator', {
        method: 'POST',
        body: JSON.stringify({
          source: 'csv_upload',
          defaultPlatform: 'amazon',
          items: [{ setNumber: '75192', condition: 'Invalid' }],
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should accept photo analysis fields', async () => {
      const mockEvaluation = {
        id: 'eval-1',
        source: 'photo_analysis',
        evaluationMode: 'max_bid',
        targetMarginPercent: 25,
      };

      mockServiceMethods.createEvaluation.mockResolvedValue(mockEvaluation);

      const { POST } = await import('../purchase-evaluator/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator', {
        method: 'POST',
        body: JSON.stringify({
          source: 'photo_analysis',
          defaultPlatform: 'ebay',
          evaluationMode: 'max_bid',
          targetMarginPercent: 25,
          photoAnalysisJson: { models: ['opus'] },
          listingDescription: 'eBay listing',
          items: [
            {
              setNumber: '75192',
              condition: 'New',
              itemType: 'set',
              boxCondition: 'Excellent',
              sealStatus: 'Factory Sealed',
              aiConfidenceScore: 0.92,
            },
          ],
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });
  });

  // ============================================
  // GET /api/purchase-evaluator/[id]
  // ============================================

  describe('GET /api/purchase-evaluator/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const { GET } = await import('../purchase-evaluator/[id]/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator/eval-1');

      const response = await GET(request, { params: Promise.resolve({ id: 'eval-1' }) });

      expect(response.status).toBe(401);
    });

    it('should return evaluation with items', async () => {
      const mockEvaluation = {
        id: 'eval-1',
        name: 'Test Evaluation',
        items: [{ id: 'item-1', setNumber: '75192' }],
      };

      mockServiceMethods.getEvaluation.mockResolvedValue(mockEvaluation);

      const { GET } = await import('../purchase-evaluator/[id]/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator/eval-1');

      const response = await GET(request, { params: Promise.resolve({ id: 'eval-1' }) });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.id).toBe('eval-1');
      expect(body.data.items).toHaveLength(1);
    });

    it('should return 404 when evaluation not found', async () => {
      mockServiceMethods.getEvaluation.mockResolvedValue(null);

      const { GET } = await import('../purchase-evaluator/[id]/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator/non-existent');

      const response = await GET(request, {
        params: Promise.resolve({ id: 'non-existent' }),
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Evaluation not found');
    });
  });

  // ============================================
  // PATCH /api/purchase-evaluator/[id]
  // ============================================

  describe('PATCH /api/purchase-evaluator/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const { PATCH } = await import('../purchase-evaluator/[id]/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator/eval-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: 'eval-1' }) });

      expect(response.status).toBe(401);
    });

    it('should update evaluation metadata', async () => {
      const mockUpdated = {
        id: 'eval-1',
        name: 'Updated Name',
        defaultPlatform: 'ebay',
        status: 'saved',
      };

      mockServiceMethods.updateEvaluation.mockResolvedValue(mockUpdated);

      const { PATCH } = await import('../purchase-evaluator/[id]/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator/eval-1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Updated Name',
          defaultPlatform: 'ebay',
          status: 'saved',
        }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: 'eval-1' }) });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.name).toBe('Updated Name');
    });

    it('should return 400 for invalid status', async () => {
      const { PATCH } = await import('../purchase-evaluator/[id]/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator/eval-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'invalid_status' }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: 'eval-1' }) });

      expect(response.status).toBe(400);
    });
  });

  // ============================================
  // DELETE /api/purchase-evaluator/[id]
  // ============================================

  describe('DELETE /api/purchase-evaluator/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      const { DELETE } = await import('../purchase-evaluator/[id]/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator/eval-1', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: Promise.resolve({ id: 'eval-1' }) });

      expect(response.status).toBe(401);
    });

    it('should delete evaluation', async () => {
      mockServiceMethods.deleteEvaluation.mockResolvedValue(undefined);

      const { DELETE } = await import('../purchase-evaluator/[id]/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator/eval-1', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: Promise.resolve({ id: 'eval-1' }) });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(mockServiceMethods.deleteEvaluation).toHaveBeenCalledWith('user-123', 'eval-1');
    });

    it('should return 500 on service error', async () => {
      mockServiceMethods.deleteEvaluation.mockRejectedValue(new Error('Delete failed'));

      const { DELETE } = await import('../purchase-evaluator/[id]/route');
      const request = new NextRequest('http://localhost/api/purchase-evaluator/eval-1', {
        method: 'DELETE',
      });

      const response = await DELETE(request, { params: Promise.resolve({ id: 'eval-1' }) });

      expect(response.status).toBe(500);
    });
  });

  // ============================================
  // GET /api/purchase-evaluator/template
  // ============================================

  describe('GET /api/purchase-evaluator/template', () => {
    it('should return CSV template', async () => {
      const { GET } = await import('../purchase-evaluator/template/route');
      const response = await GET();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/csv');
      expect(response.headers.get('Content-Disposition')).toContain(
        'purchase-evaluation-template.csv'
      );
    });
  });
});
