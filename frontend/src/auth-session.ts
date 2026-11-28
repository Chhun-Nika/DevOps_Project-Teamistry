import { ApiError, getProfile, refreshAccessToken, revokeSession } from './user-team-api';
import type { UserProfile } from './user-team-api';

export interface Session {
  accessToken: string;
  user: UserProfile;
  expiresAt: number | undefined;
}

function accessTokenLifetime(accessToken: string): number | undefined {
  const encoded = accessToken.split('.')[1];
  if (!encoded) return undefined;

  try {
    // Only used to schedule refresh. The API verifies the token on every protected request.
    const { iat, exp } = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
    if (Number.isFinite(iat) && Number.isFinite(exp) && exp > iat) {
      return Math.min((exp - iat) * 1000, 2_147_483_647);
    }
  } catch {
    return undefined;
  }
}

export async function loadSession(accessToken: string): Promise<Session> {
  const lifetime = accessTokenLifetime(accessToken);
  const expiresAt = lifetime === undefined ? undefined : Date.now() + lifetime;
  const { user } = await getProfile(accessToken);
  return { accessToken, user, expiresAt };
}

async function withRefreshCookie<T>(operation: () => Promise<T>): Promise<T> {
  // Same-origin tabs share the cookie. Avoid rotating it concurrently wherever Web Locks is available.
  const locks = globalThis.navigator?.locks;
  return locks ? await locks.request('teamisty-refresh-cookie', operation) : operation();
}

let restoring: Promise<Session | null> | undefined;

export function restoreSession(): Promise<Session | null> {
  restoring ??= withRefreshCookie(async () => {
    try {
      const { accessToken } = await refreshAccessToken();
      return await loadSession(accessToken);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  }).finally(() => { restoring = undefined; });

  return restoring;
}

export async function endSession() {
  // Wait for any rotation in this tab before sending logout with the replacement cookie.
  await restoring?.catch(() => undefined);
  try {
    await withRefreshCookie(revokeSession);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
}
