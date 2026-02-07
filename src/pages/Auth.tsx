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

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (error) throw error;

      setEmailSent(true);
      toast({
        title: 'Check your email',
        description: 'We sent you a magic link to sign in.',
      });
    } catch (error: any) {
      console.error('Auth error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong. Please try again.',
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
              <p className="text-sm text-muted-foreground mt-4">
                Click the link in your email to sign in. You can close this tab.
              </p>
            </div>

            <Button 
              variant="ghost" 
              onClick={() => setEmailSent(false)}
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
