import type { CookieOptions } from 'express';

export class AuthConfigurationError extends Error {}

export function isTrustedAuthOrigin(origin: string | undefined): boolean {
  if (!origin || !/^https?:\/\//.test(origin)) return false;

  const allowed = (process.env.AUTH_TRUSTED_ORIGINS ?? '').split(',').map(value => value.trim());
  return allowed.includes(origin);
}

export function refreshCookieOptions(): CookieOptions {
  const path = process.env.AUTH_REFRESH_COOKIE_PATH ?? '/auth';
  const sameSite = process.env.AUTH_REFRESH_COOKIE_SAME_SITE ?? 'lax';
  if ((path !== '/auth' && path !== '/api/auth') || (sameSite !== 'lax' && sameSite !== 'none')) {
    throw new AuthConfigurationError('Invalid refresh cookie path or SameSite configuration');
  }
  return { path, sameSite, httpOnly: true, secure: true };
}
