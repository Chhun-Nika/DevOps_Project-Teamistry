import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProfile, signIn, signUp } from './user-team-api';

const credentials = { email: 'teammate@example.com', password: 'example-password' };
const user = { id: 'test-user', email: credentials.email, username: 'teammate', displayName: null };

afterEach(() => vi.unstubAllGlobals());

describe('User & Team account requests', () => {
  it('creates an account with the signup payload', async () => {
    const signup = { ...credentials, username: user.username };
    const createdUser = { ...user, displayName: user.username };
    const fetch = vi.fn().mockResolvedValue(Response.json({ user: createdUser }, { status: 201 }));
    vi.stubGlobal('fetch', fetch);

    await expect(signUp(signup)).resolves.toEqual({ user: createdUser });
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/signup$/), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signup),
    });
  });

  it('accepts the login cookie and authorizes profile lookup with the access token', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ accessToken: 'example-token' }))
      .mockResolvedValueOnce(Response.json({ user }));
    vi.stubGlobal('fetch', fetch);

    const { accessToken } = await signIn(credentials);
    await expect(getProfile(accessToken)).resolves.toEqual({ user });
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/auth\/login$/), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringMatching(/\/users\/me$/), {
      headers: { Authorization: 'Bearer example-token' },
    });
  });

  it('surfaces duplicate-account and invalid-credentials errors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        error: { code: 'ACCOUNT_CONFLICT', message: 'Username or email is already registered.' },
      }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
      }, { status: 401 }));
    vi.stubGlobal('fetch', fetch);

    await expect(signUp({ ...credentials, username: user.username })).rejects.toThrow('Username or email is already registered.');
    await expect(signIn(credentials)).rejects.toThrow('Email or password is incorrect.');
  });
});
