import {ClerkProvider, SignIn, SignUp, UserButton, useAuth} from '@clerk/react';
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router';
import {AccountGate} from './account-gate';

const linkStyle =
  'rounded-full px-4 py-2 text-sm font-semibold transition-colors hover:bg-parchment/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-leaf aria-[current=page]:bg-leaf aria-[current=page]:text-forest';
function ProtectedShell() {
  const {isLoaded, isSignedIn, userId, sessionId, getToken, signOut} =
    useAuth();
  const location = useLocation();
  if (!isLoaded)
    return (
      <p role="status" className="p-6">
        Loading your session…
      </p>
    );
  if (!isSignedIn)
    return (
      <Navigate
        to={`/sign-in?returnTo=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  return (
    <div className="mx-auto w-full max-w-240 px-5 py-7 sm:px-10 sm:py-10">
      <a
        href="#main-content"
        className="sr-only rounded bg-leaf p-3 text-forest focus:not-sr-only"
      >
        Skip to content
      </a>
      <header className="flex flex-wrap items-center justify-between gap-5 border-b border-outline/50 pb-6">
        <NavLink
          to="/"
          className="text-lg font-bold tracking-wide text-leaf focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-leaf"
        >
          Chronostasis
        </NavLink>
        <div className="flex items-center gap-5">
          <nav aria-label="Main navigation" className="flex gap-1">
            <NavLink to="/" end className={linkStyle}>
              Focus
            </NavLink>
            <NavLink to="/inventory" className={linkStyle}>
              Inventory
            </NavLink>
          </nav>
          <UserButton />
        </div>
      </header>
      <main id="main-content" className="py-3 wrap-anywhere" tabIndex={-1}>
        <AccountGate
          key={`${userId}:${sessionId}`}
          getToken={getToken}
          signInAgain={() => signOut({redirectUrl: '/sign-in'})}
        >
          <Outlet />
        </AccountGate>
      </main>
      <footer className="mt-16 border-t border-outline/40 pt-5 text-sm text-parchment/65">
        A little space for what matters.
      </footer>
    </div>
  );
}
function Focus() {
  return (
    <>
      <p className="mt-7 text-sm font-semibold tracking-[0.12em] text-leaf uppercase">
        One quiet moment
      </p>
      <h1 className="mt-4 max-w-140 text-[clamp(2.5rem,9vw,4.5rem)] leading-[1.1] font-bold tracking-tight text-balance">
        Make room for focus.
      </h1>
      <p className="mt-6 max-w-125 text-lg text-parchment/80">
        Finish a focus session. Open a chest. Collect a little wonder.
      </p>
      <section
        aria-labelledby="focus-heading"
        className="mt-10 rounded-3xl border border-outline bg-parchment/5 p-6 sm:p-8"
      >
        <span className="rounded-full border border-outline px-3 py-1 text-xs font-semibold text-leaf">
          Coming soon
        </span>
        <h2 id="focus-heading" className="mt-5 text-2xl font-semibold">
          Your next focus session
        </h2>
        <p className="mt-3 max-w-125 text-parchment/75">
          The timer and chest rewards are still taking shape. Your account is
          ready for the journey.
        </p>
      </section>
    </>
  );
}
function Inventory() {
  return (
    <>
      <p className="mt-7 text-sm font-semibold tracking-[0.12em] text-leaf uppercase">
        Small treasures
      </p>
      <h1 className="mt-4 text-[clamp(2.5rem,9vw,4.5rem)] leading-[1.1] font-bold tracking-tight">
        Your inventory
      </h1>
      <section
        aria-labelledby="collection-heading"
        className="mt-10 rounded-3xl border border-outline bg-parchment/5 p-6 sm:p-8"
      >
        <span className="rounded-full border border-outline px-3 py-1 text-xs font-semibold text-leaf">
          Coming soon
        </span>
        <h2 id="collection-heading" className="mt-5 text-2xl font-semibold">
          Your collection starts here.
        </h2>
        <p className="mt-3 max-w-125 text-parchment/75">
          Collected items will appear here once focus sessions and rewards are
          available.
        </p>
      </section>
    </>
  );
}
function AuthPage({signUp = false}: {signUp?: boolean}) {
  const {isLoaded, isSignedIn} = useAuth();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') === '/inventory' ? '/inventory' : '/';
  if (!isLoaded)
    return (
      <p role="status" className="p-6">
        Loading sign-in…
      </p>
    );
  if (isSignedIn) return <Navigate to={returnTo} replace />;
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-120 flex-col justify-center px-5 py-10">
      <p className="text-sm font-bold tracking-[0.12em] text-leaf uppercase">
        Chronostasis
      </p>
      <h1 className="mt-4 text-4xl leading-tight font-bold text-balance">
        A little space for focus.
      </h1>
      <p className="mt-4 mb-8 text-parchment/75">
        {signUp
          ? 'Create an account to begin your collection.'
          : 'Sign in to keep your progress close.'}
      </p>
      {signUp ? (
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          forceRedirectUrl={returnTo}
        />
      ) : (
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          forceRedirectUrl={returnTo}
        />
      )}
    </main>
  );
}
export function App() {
  const navigate = useNavigate();
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey)
    return (
      <main className="mx-auto max-w-160 p-6">
        <h1 className="text-2xl font-bold">Sign-in needs configuration</h1>
        <p className="mt-4">
          Set VITE_CLERK_PUBLISHABLE_KEY in your local environment and restart
          the development server.
        </p>
      </main>
    );
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      routerPush={to => {
        void navigate(to);
      }}
      routerReplace={to => {
        void navigate(to, {replace: true});
      }}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
      appearance={{
        variables: {
          colorPrimary: '#17251f',
          colorBackground: '#f2f5ee',
          colorForeground: '#17251f',
        },
        elements: {
          rootBox: 'w-full',
          cardBox: 'w-full max-w-full',
          card: 'w-full shadow-none',
        },
      }}
    >
      <Routes>
        <Route path="/sign-in/*" element={<AuthPage />} />
        <Route path="/sign-up/*" element={<AuthPage signUp />} />
        <Route element={<ProtectedShell />}>
          <Route index element={<Focus />} />
          <Route path="inventory" element={<Inventory />} />
        </Route>
        <Route
          path="*"
          element={
            <main className="mx-auto max-w-160 p-6">
              <h1 className="text-3xl font-bold">Page not found</h1>
              <NavLink to="/" className="mt-5 inline-block underline">
                Back to Focus
              </NavLink>
            </main>
          }
        />
      </Routes>
    </ClerkProvider>
  );
}
