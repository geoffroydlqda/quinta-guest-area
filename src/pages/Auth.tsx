import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2 } from 'lucide-react';
import qdaLogo from '@/assets/qda-logo.png';

const Auth = () => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') || 'login';
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [existingAccountMessage, setExistingAccountMessage] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/dashboard');
    }
  }, [user, authLoading, navigate]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) {
      toast({
        title: 'Email required',
        description: 'Please enter your email address.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setExistingAccountMessage(false);

    try {
      // signInWithOtp works for both new and existing users
      // It sends a magic link regardless of whether the account exists
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          // shouldCreateUser: true ensures new accounts are created automatically
          shouldCreateUser: true,
        },
      });

      if (error) {
        // Handle specific error cases
        if (error.message.includes('Email rate limit exceeded')) {
          toast({
            title: 'Too many requests',
            description: 'Please wait a few minutes before trying again.',
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }
        
        // For any other error, still try to be helpful
        throw error;
      }

      // Check if this was a signup attempt with existing email
      // Note: signInWithOtp doesn't tell us if user exists, so we show a unified message
      if (mode === 'signup') {
        // For signup mode, we show a message that works for both cases
        setExistingAccountMessage(true);
      }

      setEmailSent(true);
      toast({
        title: 'Check your email',
        description: 'We sent you a magic link to sign in.',
      });
    } catch (error: any) {
      console.error('Auth error:', error);
      
      // Provide user-friendly error messages
      let errorMessage = 'Something went wrong. Please try again.';
      
      if (error.message?.includes('Invalid email')) {
        errorMessage = 'Please enter a valid email address.';
      } else if (error.message?.includes('network')) {
        errorMessage = 'Network error. Please check your connection.';
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

  if (emailSent) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center space-y-6 animate-fade-up">
            <div className="flex flex-col items-center gap-4">
              <img src={qdaLogo} alt="Quinta do Amor" className="h-16 w-auto" />
              <span className="text-2xl md:text-[28px]" role="img" aria-label="Love letter">💌</span>
            </div>
            
            <div>
              <h1 className="text-2xl font-medium">Check your email</h1>
              <p className="text-muted-foreground mt-2">
                We sent a magic link to <strong>{email}</strong>
              </p>
              {existingAccountMessage && mode === 'signup' && (
                <p className="text-sm text-muted-foreground mt-3 bg-muted/50 rounded-lg p-3">
                  If this email already has an account, we've sent you a login link instead.
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-4">
                Click the link in your email to sign in. You can close this tab.
              </p>
            </div>

            <Button 
              variant="ghost" 
              onClick={() => {
                setEmailSent(false);
                setExistingAccountMessage(false);
              }}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Use a different email
            </Button>
          </div>
        </main>
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
            <h1 className="text-2xl font-medium">
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-muted-foreground mt-2">
              Enter your email to {mode === 'signup' ? 'get started' : 'sign in'}
            </p>
          </div>

          <form onSubmit={handleMagicLink} className="space-y-6 bg-card rounded-2xl shadow-elegant p-6 md:p-8">
            <div className="space-y-2">
              <Label htmlFor="email">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12"
                autoComplete="email"
                disabled={isLoading}
              />
            </div>

            <Button 
              type="submit" 
              size="lg" 
              className="w-full"
              disabled={isLoading || !email.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Sending link...
                </>
              ) : (
                'Send magic link'
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              {mode === 'signup' ? (
                <>
                  Already have an account?{' '}
                  <Link to="/auth?mode=login" className="text-primary hover:underline">
                    Log in
                  </Link>
                </>
              ) : (
                <>
                  Don't have an account?{' '}
                  <Link to="/auth?mode=signup" className="text-primary hover:underline">
                    Create one
                  </Link>
                </>
              )}
            </p>
          </form>
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
