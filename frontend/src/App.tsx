import { AutoHeight } from '@animate-ui/react/primitives/effects/auto-height';
import { Effect } from '@animate-ui/react/primitives/effects/effect';
import { useShouldReduceMotion } from '@animate-ui/react/utils/motion';
import { Eye, EyeOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, MouseEvent, ReactNode } from 'react';

import googleLogo from './assets/google-g.png';
import logo from './assets/logo.png';
import { loadSession } from './auth-session';
import { BoardPreview } from './BoardPreview';
import { googleSignInUrl, signIn, signUp } from './user-team-api';
import { useSession } from './use-session';

type FieldName = 'username' | 'email' | 'password';
type FieldErrors = Partial<Record<FieldName, string>>;

function Field({ name, label, error, children }: {
  name: FieldName;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={name} className="text-[15px] font-semibold">{label}</label>
      {children}
      {error && <p id={name + '-error'} role="alert" className="text-sm text-error">{error}</p>}
    </div>
  );
}

function PasswordField({ creatingAccount, error }: { creatingAccount: boolean; error?: string }) {
  const [visible, setVisible] = useState(false);
  const description = [creatingAccount && 'password-hint', error && 'password-error'].filter(Boolean).join(' ');

  return (
    <Field name="password" label="Password" error={error}>
      <div className="relative">
        <input
          id="password"
          name="password"
          placeholder="Enter your password"
          className="field-input field-input--password"
          type={visible ? 'text' : 'password'}
          autoComplete={creatingAccount ? 'new-password' : 'current-password'}
          aria-describedby={description || undefined}
          aria-invalid={error ? true : undefined}
          minLength={creatingAccount ? 8 : undefined}
          required
        />
        <button
          type="button"
          className="absolute inset-y-1 right-[3px] grid w-11 place-items-center rounded-control text-muted hover:text-ink"
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={22} strokeWidth={1.8} aria-hidden="true" /> : <Eye size={22} strokeWidth={1.8} aria-hidden="true" />}
        </button>
      </div>
      {creatingAccount && <p id="password-hint" className="text-sm text-hint">Use at least 8 characters.</p>}
    </Field>
  );
}

export function App() {
  const [creatingAccount, setCreatingAccount] = useState(() => window.location.pathname === '/sign-up');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [hasSwitchedForm, setHasSwitchedForm] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reduceMotion = useShouldReduceMotion();
  const { session, checkingSession, signingOut, sessionError, acceptSession, signOut } = useSession();
  const heading = creatingAccount ? 'Create your account' : 'Welcome back';
  const formError = error || (!creatingAccount && sessionError);
  const alternatePath = creatingAccount ? '/sign-in' : '/sign-up';
  const animateForm = hasSwitchedForm && !reduceMotion && !checkingSession && !session;

  const showAuthPage = useCallback((email = '') => {
    setHasSwitchedForm(true);
    setCreatingAccount(window.location.pathname === '/sign-up');
    setRegisteredEmail(email);
    setError('');
    setFieldErrors({});
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  useEffect(() => {
    const handleHistory = () => showAuthPage();
    window.addEventListener('popstate', handleHistory);
    return () => window.removeEventListener('popstate', handleHistory);
  }, [showAuthPage]);

  function switchAuthPage(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    if (pending || window.location.pathname === alternatePath) return;
    window.history.pushState(null, '', alternatePath);
    showAuthPage();
  }

  function clearFieldError(event: FormEvent<HTMLFormElement>) {
    if (event.target instanceof HTMLInputElement) {
      const name = event.target.name as FieldName;
      if (fieldErrors[name]) setFieldErrors(current => ({ ...current, [name]: undefined }));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const emailInput = form.elements.namedItem('email') as HTMLInputElement;
    const username = String(data.get('username') ?? '').trim();
    const email = emailInput.value.trim();
    const password = String(data.get('password') ?? '');
    const errors: FieldErrors = {};

    if (creatingAccount && (username.length < 3 || username.length > 30)) {
      errors.username = 'Enter a username between 3 and 30 characters.';
    }
    if (!email || emailInput.validity.typeMismatch) errors.email = 'Enter a valid email address.';
    if (creatingAccount && password.length < 8) errors.password = 'Enter at least 8 characters.';
    else if (!password) errors.password = 'Enter your password.';
    else if (new TextEncoder().encode(password).length > 72) errors.password = 'Use a password of 72 bytes or fewer.';

    setError('');
    setFieldErrors(errors);
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      const field = form.elements.namedItem(firstError);
      if (field instanceof HTMLInputElement) requestAnimationFrame(() => field.focus());
      return;
    }

    setPending(true);
    let createdEmail: string | undefined;
    try {
      if (creatingAccount) {
        const { user } = await signUp({ email, password, username });
        createdEmail = user.email;
      }

      const { accessToken } = await signIn({ email: createdEmail ?? email, password });
      const nextSession = await loadSession(accessToken);
      if (creatingAccount) {
        window.history.replaceState(null, '', '/sign-in');
        setCreatingAccount(false);
      }
      acceptSession(nextSession);
      setHasSwitchedForm(false);
      setRegisteredEmail('');
    } catch (error) {
      if (createdEmail !== undefined) {
        window.history.replaceState(null, '', '/sign-in');
        showAuthPage(createdEmail);
      } else {
        setError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      {!session && <BoardPreview />}
      <AutoHeight
        className="auth-card"
        deps={[creatingAccount, checkingSession, Boolean(session)]}
        initial={false}
        transition={{ duration: animateForm ? 0.22 : 0, ease: 'easeOut' }}
      >
        <section aria-labelledby="account-heading" className="grid gap-[22px]">
          <div className="flex items-center gap-2.5 text-xl font-bold">
            <span className="size-8 shrink-0 overflow-hidden rounded-[10px]" aria-hidden="true">
              <img src={logo} alt="" width="32" height="32" className="size-full scale-[2.1] object-cover" />
            </span>
            Teamisty
          </div>
          <Effect
            key={checkingSession ? 'checking' : session ? 'profile' : heading}
            className="grid gap-[22px]"
            fade={animateForm && { initialOpacity: 0.45 }}
            slide={animateForm && { direction: creatingAccount ? 'left' : 'right', offset: 12 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <h1 ref={headingRef} id="account-heading" aria-live="polite" tabIndex={-1} className="text-2xl leading-tight font-bold tracking-[-.02em] focus:outline-none">
              {checkingSession ? 'Checking your session' : session ? 'You’re signed in' : heading}
            </h1>

            {checkingSession ? null : session ? (
              <div className="grid gap-1">
                <p className="font-semibold">{session.user.displayName || session.user.username}</p>
                <p className="text-sm break-all text-muted">{session.user.email}</p>
                {sessionError && <p role="alert" className="mt-4 text-sm text-error">{sessionError}</p>}
                <button type="button" className="secondary-button mt-4" onClick={signOut} disabled={signingOut}>
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            ) : (
              <>
                <form className="auth-form" data-mode={creatingAccount ? 'sign-up' : 'sign-in'} onSubmit={submit} onInput={clearFieldError} aria-busy={pending} noValidate>
                  <div className="grid gap-4">
                    {registeredEmail && (
                      <p role="status" className="text-sm text-muted">Account created. Automatic sign-in failed. Sign in to continue.</p>
                    )}
                    {creatingAccount && (
                      <Field name="username" label="Username" error={fieldErrors.username}>
                        <input
                          id="username" name="username" className="field-input" placeholder="Enter your username"
                          autoComplete="username" minLength={3} maxLength={30} required
                          aria-invalid={fieldErrors.username ? true : undefined}
                          aria-describedby={fieldErrors.username ? 'username-error' : undefined}
                        />
                      </Field>
                    )}
                    <Field name="email" label="Email" error={fieldErrors.email}>
                      <input
                        id="email" name="email" className="field-input" type="email" placeholder="name@example.com"
                        autoComplete="email" maxLength={254} defaultValue={registeredEmail} required
                        aria-invalid={fieldErrors.email ? true : undefined}
                        aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                      />
                    </Field>
                    <PasswordField creatingAccount={creatingAccount} error={fieldErrors.password} />
                    {formError && <p role="alert" className="text-sm text-error">{formError}</p>}
                  </div>

                  <div className="grid gap-3">
                    <button type="submit" className="primary-button" disabled={pending}>
                      {creatingAccount ? (pending ? 'Creating account…' : 'Create account') : (pending ? 'Signing in…' : 'Sign in')}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={pending}
                      onClick={() => window.location.assign(googleSignInUrl)}
                    >
                      <img src={googleLogo} width="20" height="20" alt="" aria-hidden="true" className="size-5 object-contain" />
                      Continue with Google
                    </button>
                  </div>
                </form>
                <hr className="border-divider" />
                <p className="text-center text-[15px] text-muted">
                  {creatingAccount ? 'Already have an account?' : 'New to Teamisty?'}{' '}
                  <a
                    href={alternatePath}
                    onClick={switchAuthPage}
                    aria-disabled={pending || undefined}
                    className="rounded-sm font-semibold text-ink underline underline-offset-[3px]"
                  >
                    {creatingAccount ? 'Sign in' : 'Create an account'}
                  </a>
                </p>
              </>
            )}
          </Effect>
        </section>
      </AutoHeight>
    </main>
  );
}
