import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import qdaLogo from '@/assets/qda-logo.png';
import { isAdminEmail } from '@/lib/admin';

const Auth = () => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') || 'login';
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      const next = searchParams.get('redirectTo');
      const fallback = isAdminEmail(user.email) ? '/admin' : '/dashboard';
      const target = next && next.startsWith('/') ? next : fallback;
      navigate(target, { replace: true, state: { from: location.pathname } });
    }
  }, [user, authLoading, navigate, searchParams, location.pathname]);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const next = searchParams.get('redirectTo');
      const redirectUri = next
        ? `${window.location.origin}/auth?redirectTo=${encodeURIComponent(next)}`
        : `${window.location.origin}/auth`;
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: redirectUri,
      });
      if (error) throw error;
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      toast({
        title: 'Error',
        description: 'Google sign-in failed. Please try again.',
        variant: 'destructive',
      });
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      toast({
        title: 'Missing fields',
        description: 'Please enter your email and password.',
        variant: 'destructive',
      });
      return;
    }

    if (mode === 'signup' && (!firstName.trim() || !lastName.trim())) {
      toast({
        title: 'Missing fields',
        description: 'Please enter your first and last name.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password.trim(),
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              full_name: `${firstName.trim()} ${lastName.trim()}`,
            },
          },
        });

        if (error) {
          // If user already exists, try logging in instead
          if (error.message?.includes('already registered') || error.message?.includes('already been registered')) {
            toast({
              title: 'Account exists',
              description: 'This email already has an account. Please log in instead.',
            });
            setIsLoading(false);
            return;
          }
          throw error;
        }

        toast({
          title: 'Account created',
          description: 'Welcome! Redirecting to your dashboard...',
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password.trim(),
        });

        if (error) throw error;

        toast({
          title: 'Welcome back',
          description: 'Redirecting to your dashboard...',
        });
      }
    } catch (error: any) {
      console.error('Auth error:', error);

      let errorMessage = 'Something went wrong. Please try again.';
      if (error.message?.includes('Invalid login credentials')) {
        errorMessage = 'Invalid email or password. Please try again.';
      } else if (error.message?.includes('Email rate limit')) {
        errorMessage = 'Too many attempts. Please wait a few minutes.';
      }

      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="p-4">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-8 animate-fade-up">
          <div className="text-center">
            <img src={qdaLogo} alt="Quinta do Amor" className="h-16 w-auto mx-auto mb-4" />
            <h1 className="text-2xl font-semibold">
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-muted-foreground mt-2">
              {mode === 'signup' ? 'Sign up to manage your stay' : 'Sign in to your Guest Area'}
            </p>
          </div>

          <div className="space-y-4">
            {/* Google Sign-In */}
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-3 h-12"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </Button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Email + Password Form */}
            <form onSubmit={handleEmailAuth} className="space-y-4 bg-card rounded-2xl shadow-elegant p-6">
              {mode === 'signup' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">
                      First name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      className="h-11"
                      disabled={isLoading}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">
                      Last name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      className="h-11"
                      disabled={isLoading}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11"
                  autoComplete="email"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  disabled={isLoading}
                />
                {mode === 'login' && (
                  <div className="flex justify-end">
                    <Link to="/forgot-password" className="text-sm text-primary hover:underline font-medium">
                      Forgot your password?
                    </Link>
                  </div>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full gap-2"
                disabled={isLoading || !email.trim() || !password.trim()}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                {mode === 'signup' ? 'Create account' : 'Sign in'}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {mode === 'signup' ? (
                  <>
                    Already have an account?{' '}
                    <Link to="/auth?mode=login" className="text-primary hover:underline font-medium">
                      Log in
                    </Link>
                  </>
                ) : (
                  <>
                    Don't have an account?{' '}
                    <Link to="/auth?mode=signup" className="text-primary hover:underline font-medium">
                      Create one
                    </Link>
                  </>
                )}
              </p>
            </form>
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Quinta do Amor © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
};

export default Auth;
