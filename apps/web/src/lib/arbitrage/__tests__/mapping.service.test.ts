import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MappingService } from '../mapping.service';

// Mock dependencies
vi.mock('../../bricklink/client', () => ({
  BrickLinkClient: vi.fn(),
  BrickLinkApiError: class BrickLinkApiError extends Error {
    code: number;
    constructor(message: string, code: number) {
      super(message);
      this.code = code;
      this.name = 'BrickLinkApiError';
    }
  },
}));

vi.mock('../../repositories', () => ({
  CredentialsRepository: class MockCredentialsRepository {
    getCredentials = vi.fn();
  },
}));

// Mock Supabase client factory
function createMockSupabaseClient() {
  const createChainableMock = () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.update = vi.fn().mockReturnValue(chain);
    chain.delete = vi.fn().mockReturnValue(chain);
    chain.upsert = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn();
    return chain;
  };

  const mockChain = createChainableMock();

  return {
    from: vi.fn().mockReturnValue(mockChain),
    auth: {
      getUser: vi.fn(),
    },
    _mockChain: mockChain,
    _createChain: createChainableMock,
  };
}

describe('MappingService', () => {
  let service: MappingService;
  let mockSupabase: ReturnType<typeof createMockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new MappingService(mockSupabase as any);
  });

  // ============================================
  // extractSetNumber
  // ============================================

  describe('extractSetNumber', () => {
    describe('standard format (XXXXX-1)', () => {
      it('should extract set number from standard format', () => {
        const result = service.extractSetNumber('LEGO Set 40585-1 Brand New');
        expect(result.setNumber).toBe('40585-1');
        expect(result.confidence).toBe('exact');
        expect(result.method).toBe('standard_format');
      });

      it('should extract 4-digit set number', () => {
        const result = service.extractSetNumber('LEGO 7191-1 X-wing Fighter');
        expect(result.setNumber).toBe('7191-1');
        expect(result.confidence).toBe('exact');
      });

      it('should extract 6-digit set number', () => {
        const result = service.extractSetNumber('LEGO 910007-1 Bricklink Designer');
        expect(result.setNumber).toBe('910007-1');
        expect(result.confidence).toBe('exact');
      });
    });

    describe('LEGO prefix format', () => {
      it('should extract set number after LEGO prefix', () => {
        const result = service.extractSetNumber('LEGO 75192 Millennium Falcon');
        expect(result.setNumber).toBe('75192-1');
        expect(result.confidence).toBe('exact');
        expect(result.method).toBe('lego_prefix');
      });

      it('should handle lowercase lego prefix', () => {
        const result = service.extractSetNumber('lego 40585 World of Wonders');
        expect(result.setNumber).toBe('40585-1');
        expect(result.confidence).toBe('exact');
      });
    });

    describe('Set prefix format', () => {
      it('should extract set number after "Set" prefix', () => {
        const result = service.extractSetNumber('Star Wars Set 75192 UCS Millennium Falcon');
        expect(result.setNumber).toBe('75192-1');
        expect(result.confidence).toBe('exact');
        expect(result.method).toBe('set_prefix');
      });

      it('should handle lowercase "set" prefix', () => {
        const result = service.extractSetNumber('Building Blocks set 10276');
        expect(result.setNumber).toBe('10276-1');
        expect(result.confidence).toBe('exact');
      });
    });

    describe('parentheses format', () => {
      it('should extract set number from parentheses', () => {
        const result = service.extractSetNumber('LEGO Star Wars Millennium Falcon (75192)');
        expect(result.setNumber).toBe('75192-1');
        expect(result.confidence).toBe('probable');
        expect(result.method).toBe('parentheses');
      });
    });

    describe('standalone 5-digit number', () => {
      it('should extract standalone 5-digit number', () => {
        const result = service.extractSetNumber('Brand New Building Blocks 40585 Sealed');
        expect(result.setNumber).toBe('40585-1');
        expect(result.confidence).toBe('probable');
        expect(result.method).toBe('standalone_number');
      });

      it('should not match 4-digit standalone numbers (too many false positives)', () => {
        // 4-digit numbers are more ambiguous (could be year, quantity, etc.)
        const result = service.extractSetNumber('Year 2024 Building Set');
        // Should match "2024" as 5-digit pattern won't match
        expect(result.setNumber).toBeNull();
      });
    });

    describe('no match cases', () => {
      it('should return null for null title', () => {
        const result = service.extractSetNumber(null);
        expect(result.setNumber).toBeNull();
        expect(result.confidence).toBeNull();
        expect(result.method).toBeNull();
      });

      it('should return null for empty title', () => {
        const result = service.extractSetNumber('');
        expect(result.setNumber).toBeNull();
      });

      it('should return null for title without set number', () => {
        const result = service.extractSetNumber('LEGO Star Wars Millennium Falcon');
        expect(result.setNumber).toBeNull();
      });

      it('should return null for title with only 3-digit numbers', () => {
        const result = service.extractSetNumber('LEGO Star Wars Set with 500 pieces');
        expect(result.setNumber).toBeNull();
      });
    });

    describe('priority order', () => {
      it('should prefer standard format over LEGO prefix', () => {
        const result = service.extractSetNumber('LEGO 75192 Star Wars 40585-1 Mixed');
        // Standard format (40585-1) should be found first since patterns are checked in order
        expect(result.setNumber).toBe('40585-1');
        expect(result.method).toBe('standard_format');
      });
    });
  });

  // ============================================
  // getMapping
  // ============================================

  describe('getMapping', () => {
    it('should return mapping when found', async () => {
      const chain = mockSupabase._createChain();
      chain.eq.mockReturnValueOnce(chain);
      chain.maybeSingle.mockResolvedValueOnce({
        data: {
          bricklink_set_number: '75192-1',
          match_confidence: 'exact',
          match_method: 'lego_prefix',
        },
        error: null,
      });
      mockSupabase.from.mockReturnValueOnce(chain);

      const result = await service.getMapping('user-123', 'B07FQ1XXYJ');

      expect(result).not.toBeNull();
      expect(result!.bricklinkSetNumber).toBe('75192-1');
      expect(result!.matchConfidence).toBe('exact');
      expect(result!.matchMethod).toBe('lego_prefix');
      expect(mockSupabase.from).toHaveBeenCalledWith('asin_bricklink_mapping');
    });

    it('should return null when mapping not found', async () => {
      const chain = mockSupabase._createChain();
      chain.eq.mockReturnValueOnce(chain);
      chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      mockSupabase.from.mockReturnValueOnce(chain);

      const result = await service.getMapping('user-123', 'B07FQ1XXYJ');

      expect(result).toBeNull();
    });

    it('should throw error on database error', async () => {
      const chain = mockSupabase._createChain();
      chain.eq.mockReturnValueOnce(chain);
      chain.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection failed' },
      });
      mockSupabase.from.mockReturnValueOnce(chain);

      await expect(service.getMapping('user-123', 'B07FQ1XXYJ')).rejects.toThrow(
        'Failed to get mapping'
      );
    });
  });

  // ============================================
  // deleteMapping
  // ============================================

  describe('deleteMapping', () => {
    it('should delete mapping successfully', async () => {
      const chain = mockSupabase._createChain();
      chain.eq.mockReturnValueOnce(chain);
      chain.eq.mockResolvedValueOnce({ error: null });
      mockSupabase.from.mockReturnValueOnce(chain);

      await expect(service.deleteMapping('user-123', 'B07FQ1XXYJ')).resolves.toBeUndefined();

      expect(mockSupabase.from).toHaveBeenCalledWith('asin_bricklink_mapping');
    });

    it('should throw error on delete failure', async () => {
      const chain = mockSupabase._createChain();
      chain.eq.mockReturnValueOnce(chain);
      chain.eq.mockResolvedValueOnce({ error: { message: 'Delete failed' } });
      mockSupabase.from.mockReturnValueOnce(chain);

      await expect(service.deleteMapping('user-123', 'B07FQ1XXYJ')).rejects.toThrow(
        'Failed to delete mapping'
      );
    });
  });
});

// ============================================
// Set number extraction patterns - comprehensive tests
// ============================================

describe('Set Number Extraction Patterns', () => {
  let service: MappingService;

  beforeEach(() => {
    const mockSupabase = createMockSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new MappingService(mockSupabase as any);
  });

  describe('Amazon product titles', () => {
    it('should extract from "LEGO Star Wars 75192 Millennium Falcon"', () => {
      const result = service.extractSetNumber('LEGO Star Wars 75192 Millennium Falcon');
      expect(result.setNumber).toBe('75192-1');
    });

    it('should extract from "LEGO Ideas 21327 Typewriter Building Set"', () => {
      const result = service.extractSetNumber('LEGO Ideas 21327 Typewriter Building Set');
      expect(result.setNumber).toBe('21327-1');
    });

    it('should extract from "LEGO Creator Expert 10276 Colosseum"', () => {
      const result = service.extractSetNumber('LEGO Creator Expert 10276 Colosseum');
      expect(result.setNumber).toBe('10276-1');
    });

    it('should extract from "LEGO 40585 World of Wonders"', () => {
      const result = service.extractSetNumber('LEGO 40585 World of Wonders');
      expect(result.setNumber).toBe('40585-1');
    });

    it('should extract from title with additional text', () => {
      const result = service.extractSetNumber(
        'LEGO Star Wars 75192 Millennium Falcon Ultimate Collector Series Building Set for Adults (7,541 Pieces)'
      );
      expect(result.setNumber).toBe('75192-1');
    });
  });

  describe('BrickLink-style titles', () => {
    it('should extract from "Set 40585-1"', () => {
      const result = service.extractSetNumber('Set 40585-1');
      expect(result.setNumber).toBe('40585-1');
    });

    it('should extract from "40585-1 World of Wonders"', () => {
      const result = service.extractSetNumber('40585-1 World of Wonders');
      expect(result.setNumber).toBe('40585-1');
    });
  });

  describe('edge cases', () => {
    it('should handle set number at end of title', () => {
      const result = service.extractSetNumber('Star Wars Millennium Falcon - LEGO 75192');
      expect(result.setNumber).toBe('75192-1');
    });

    it('should handle multiple numbers (picks first valid)', () => {
      const result = service.extractSetNumber('LEGO 75192 with 7541 pieces');
      expect(result.setNumber).toBe('75192-1');
    });

    it('should not confuse piece count with set number', () => {
      // "7541" could be mistaken for a set number, but LEGO prefix should win
      const result = service.extractSetNumber('LEGO 75192 Millennium Falcon 7541 pcs');
      expect(result.setNumber).toBe('75192-1');
    });
  });
});
