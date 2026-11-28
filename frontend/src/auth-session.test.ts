import { afterEach, describe, expect, it, vi } from 'vitest';

import { endSession, loadSession, restoreSession } from './auth-session';

const user = { id: 'test-user', email: 'teammate@example.com', username: 'teammate', displayName: null };
const claims = btoa(JSON.stringify({ iat: 1000, exp: 1900 })).replace(/=+$/, '');
const accessToken = `header.${claims}.signature`;
const cookieRequest = { method: 'POST', credentials: 'include' };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('browser session', () => {
  it('uses the access token lifetime to schedule renewal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ user })));

    await expect(loadSession(accessToken)).resolves.toEqual({
      user,
      accessToken,
      expiresAt: 2_700_000,
    });
  });

  it('shares one cookie rotation between concurrent restores', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ accessToken }))
      .mockResolvedValueOnce(Response.json({ user }));
    vi.stubGlobal('fetch', fetch);

    const first = restoreSession();
    expect(restoreSession()).toBe(first);
    await expect(first).resolves.toMatchObject({ user, accessToken });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/auth\/refresh$/), cookieRequest);
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringMatching(/\/users\/me$/), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  });

  it('treats an invalid refresh cookie as signed out and preserves availability errors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetch);

    await expect(restoreSession()).resolves.toBeNull();
    await expect(restoreSession()).rejects.toMatchObject({ status: 503 });
  });

  it('revokes the replacement cookie after a pending rotation', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ accessToken }))
      .mockResolvedValueOnce(Response.json({ user }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    const refresh = restoreSession();
    await endSession();
    await expect(refresh).resolves.toMatchObject({ accessToken });
    expect(fetch).toHaveBeenNthCalledWith(3, expect.stringMatching(/\/auth\/logout$/), cookieRequest);
  });
});
