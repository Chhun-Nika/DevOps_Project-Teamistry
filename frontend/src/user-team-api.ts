export interface UserProfile {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
}

interface Credentials {
  email: string;
  password: string;
}

interface SignupInput extends Credentials {
  username: string;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');

export const googleSignInUrl = `${apiBaseUrl}/auth/google`;

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request(path: string, options?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, options);
  } catch {
    throw new Error('Could not reach Teamisty. Check your connection and try again.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    const message = body?.error?.message;
    throw new ApiError(response.status, typeof message === 'string' ? message : 'The request failed. Please try again.');
  }

  return response;
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await request(path, options);
  return response.json();
}

function postJson<T>(path: string, body: Credentials | SignupInput): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function signUp(input: SignupInput) {
  return postJson<{ user: UserProfile }>('/auth/signup', input);
}

export function signIn(input: Credentials) {
  return postJson<{ accessToken: string }>('/auth/login', input);
}

export function getProfile(accessToken: string) {
  return requestJson<{ user: UserProfile }>('/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

const sessionRequest = { method: 'POST', credentials: 'include' } as const;

export function refreshAccessToken() {
  return requestJson<{ accessToken: string }>('/auth/refresh', sessionRequest);
}

export async function revokeSession() {
  await request('/auth/logout', sessionRequest);
}
