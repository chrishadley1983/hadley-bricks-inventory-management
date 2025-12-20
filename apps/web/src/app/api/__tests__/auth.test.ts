import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { POST as registerPost } from '../auth/register/route';
import { POST as loginPost } from '../auth/login/route';

describe('Auth API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should return 400 for invalid email', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signUp: vi.fn(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'invalid-email',
          password: 'password123',
        }),
      });

      const response = await registerPost(request);
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should return 400 for short password', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signUp: vi.fn(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'short',
        }),
      });

      const response = await registerPost(request);
      expect(response.status).toBe(400);
    });

    it('should return 201 on successful registration', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signUp: vi.fn().mockResolvedValue({
            data: {
              user: { id: 'user-123', email: 'test@example.com' },
              session: null, // Email confirmation required
            },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
          businessName: 'Test Business',
        }),
      });

      const response = await registerPost(request);
      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json.message).toContain('check your email');
    });

    it('should return 400 when registration fails', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signUp: vi.fn().mockResolvedValue({
            data: { user: null, session: null },
            error: { message: 'User already exists' },
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'existing@example.com',
          password: 'password123',
        }),
      });

      const response = await registerPost(request);
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return 400 for invalid email', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signInWithPassword: vi.fn(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'invalid-email',
          password: 'password123',
        }),
      });

      const response = await loginPost(request);
      expect(response.status).toBe(400);
    });

    it('should return 401 for invalid credentials', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { user: null, session: null },
            error: { message: 'Invalid login credentials' },
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'wrongpassword',
        }),
      });

      const response = await loginPost(request);
      expect(response.status).toBe(401);
    });

    it('should return 200 on successful login', async () => {
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: {
              user: { id: 'user-123', email: 'test@example.com' },
              session: { access_token: 'test-token' },
            },
            error: null,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      const response = await loginPost(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.user).toBeDefined();
      expect(json.session).toBeDefined();
    });
  });
});
