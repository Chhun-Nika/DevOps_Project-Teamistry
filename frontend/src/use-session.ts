import { useEffect, useState } from 'react';

import { endSession, restoreSession } from './auth-session';
import type { Session } from './auth-session';

const googleCallbackPath = '/auth/google/callback';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    const expiresAt = session?.expiresAt;
    if (signingOut || (!checkingSession && expiresAt === undefined)) return;
    const delay = expiresAt === undefined ? 0 : Math.max(0, expiresAt - Date.now());

    let active = true;
    const fromGoogle = window.location.pathname === googleCallbackPath;
    const timer = window.setTimeout(async () => {
      try {
        const restored = await restoreSession();
        if (!active) return;
        setSession(restored);
        if (!restored && fromGoogle) setSessionError('Google sign-in could not be completed. Please try again.');
        else if (!restored && session) setSessionError('Your session expired. Sign in again to continue.');
        else setSessionError('');
      } catch {
        if (!active) return;
        setSession(null);
        setSessionError('Could not restore your session. Reload to try again, or sign in.');
      } finally {
        if (active) {
          if (fromGoogle) window.history.replaceState(null, '', '/');
          setCheckingSession(false);
        }
      }
    }, delay);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [checkingSession, session, signingOut]);

  function acceptSession(nextSession: Session) {
    setSession(nextSession);
    setSessionError('');
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSessionError('');
    try {
      await endSession();
      setSession(null);
    } catch {
      setSessionError('Could not sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }

  return { session, checkingSession, signingOut, sessionError, acceptSession, signOut };
}
