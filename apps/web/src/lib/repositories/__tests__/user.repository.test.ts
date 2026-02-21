import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserRepository } from '../user.repository';

// Mock Supabase client factory
const createMockClient = () => {
  const mockProfiles: Record<string, unknown>[] = [];
  let currentUserId: string | null = null;

  const createBuilder = () => {
    const currentFilters: Record<string, unknown> = {};

    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn((data) => {
        const items = Array.isArray(data) ? data : [data];
        mockProfiles.push(...items);
        return builder;
      }),
      update: vi.fn((data) => {
        const id = currentFilters['id'];
        const profile = mockProfiles.find((p) => p.id === id);
        if (profile) {
          Object.assign(profile, data);
        }
        return builder;
      }),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn((col, val) => {
        currentFilters[col] = val;
        return builder;
      }),
      single: vi.fn(() => {
        const item = mockProfiles.find((p: Record<string, unknown>) => {
          if (currentFilters['id']) return p.id === currentFilters['id'];
          return true;
        });
        return Promise.resolve({
          data: item || null,
          error: item ? null : { code: 'PGRST116', message: 'Not found' },
        });
      }),
    };

    return builder;
  };

  return {
    from: vi.fn(() => createBuilder()),
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({
          data: {
            user: currentUserId ? { id: currentUserId, email: 'test@example.com' } : null,
          },
          error: currentUserId ? null : { message: 'Not authenticated' },
        })
      ),
    },
    _mockProfiles: mockProfiles,
    _addProfile: (profile: Record<string, unknown>) => mockProfiles.push(profile),
    _clearProfiles: () => (mockProfiles.length = 0),
    _setCurrentUser: (userId: string | null) => {
      currentUserId = userId;
    },
  };
};

describe('UserRepository', () => {
  let repository: UserRepository;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repository = new UserRepository(mockClient as any);
  });

  describe('getCurrentProfile', () => {
    it('should return null when no user is authenticated', async () => {
      mockClient._setCurrentUser(null);

      const result = await repository.getCurrentProfile();

      expect(result).toBeNull();
    });

    it('should return the current user profile when authenticated', async () => {
      const userId = 'user-123';
      mockClient._setCurrentUser(userId);
      mockClient._addProfile({
        id: userId,
        email: 'test@example.com',
        business_name: 'Hadley Bricks',
        home_postcode: 'SW1A 1AA',
      });

      const result = await repository.getCurrentProfile();

      expect(result).toBeTruthy();
      expect(result?.id).toBe(userId);
      expect(result?.business_name).toBe('Hadley Bricks');
    });

    it('should return null when profile does not exist', async () => {
      mockClient._setCurrentUser('user-456');

      const result = await repository.getCurrentProfile();

      expect(result).toBeNull();
    });
  });

  describe('updateCurrentProfile', () => {
    it('should throw error when no user is authenticated', async () => {
      mockClient._setCurrentUser(null);

      await expect(repository.updateCurrentProfile({ business_name: 'New Name' })).rejects.toThrow(
        'No authenticated user'
      );
    });

    it('should update the current user profile', async () => {
      const userId = 'user-123';
      mockClient._setCurrentUser(userId);
      mockClient._addProfile({
        id: userId,
        email: 'test@example.com',
        business_name: 'Old Name',
      });

      await repository.updateCurrentProfile({ business_name: 'New Name' });

      expect(mockClient.from).toHaveBeenCalledWith('profiles');
    });
  });

  describe('updateBusinessName', () => {
    it('should update the business name for current user', async () => {
      const userId = 'user-123';
      mockClient._setCurrentUser(userId);
      mockClient._addProfile({
        id: userId,
        email: 'test@example.com',
        business_name: 'Old Business',
      });

      await expect(repository.updateBusinessName('New Business')).resolves.toBeDefined();
    });

    it('should throw when no user is authenticated', async () => {
      mockClient._setCurrentUser(null);

      await expect(repository.updateBusinessName('New Business')).rejects.toThrow(
        'No authenticated user'
      );
    });
  });

  describe('updateHomePostcode', () => {
    it('should update the home postcode for current user', async () => {
      const userId = 'user-123';
      mockClient._setCurrentUser(userId);
      mockClient._addProfile({
        id: userId,
        email: 'test@example.com',
        home_postcode: 'SW1A 1AA',
      });

      await expect(repository.updateHomePostcode('EC1A 1BB')).resolves.toBeDefined();
    });

    it('should throw when no user is authenticated', async () => {
      mockClient._setCurrentUser(null);

      await expect(repository.updateHomePostcode('EC1A 1BB')).rejects.toThrow(
        'No authenticated user'
      );
    });
  });

  describe('inherited BaseRepository methods', () => {
    describe('findById', () => {
      it('should find a profile by ID', async () => {
        const profileId = 'profile-123';
        mockClient._addProfile({
          id: profileId,
          email: 'test@example.com',
          business_name: 'Test Business',
        });

        const result = await repository.findById(profileId);

        expect(result).toBeTruthy();
        expect(result?.id).toBe(profileId);
        expect(mockClient.from).toHaveBeenCalledWith('profiles');
      });

      it('should return null when profile not found', async () => {
        const result = await repository.findById('non-existent');

        expect(result).toBeNull();
      });
    });
  });
});
