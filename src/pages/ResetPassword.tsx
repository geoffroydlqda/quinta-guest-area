import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, LockKeyhole } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import qdaLogo from '@/assets/qda-logo.png';

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isRecovered, setIsRecovered] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const hashParams = useMemo(() => new URLSearchParams(window.location.hash.replace(/^#/, '')), []);

  useEffect(() => {
    const type = hashParams.get('type');
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    if (type !== 'recovery' || !accessToken || !refreshToken) {
      setLinkError('This reset link is invalid or has expired.');
      setIsReady(true);
      return;
    }

    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          setLinkError('This reset link is invalid or has expired.');
          return;
        }

        setIsRecovered(true);
      })
      .finally(() => setIsReady(true));
  }, [hashParams]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password.length < 8) {
      toast({
        title: 'Weak password',
        description: 'Please use at least 8 characters.',
        variant: 'destructive',
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'Please enter the same password twice.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast({
        title: 'Password updated',
        description: 'Redirecting to your dashboard...',
      });

      navigate('/dashboard', { replace: true });
    } catch (error: any) {
      const message = error?.message?.toLowerCase().includes('expired')
        ? 'This reset link has expired. Please request a new one.'
        : error?.message?.toLowerCase().includes('weak')
          ? 'Please choose a stronger password.'
          : 'We could not update your password. Please try again.';

      toast({
        title: 'Password update failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isReady) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Checking your reset link...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="p-4">
        <Link to="/auth?mode=login" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-8 animate-fade-up">
          <div className="text-center">
            <img src={qdaLogo} alt="Quinta do Amor" className="h-16 w-auto mx-auto mb-4" />
            <h1 className="text-2xl font-semibold">Create a new password</h1>
            <p className="text-muted-foreground mt-2">
              Choose a new password to continue to your Guest Area.
            </p>
          </div>

          {linkError || !isRecovered ? (
            <div className="bg-card rounded-2xl shadow-elegant p-6 space-y-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-destructive mx-auto" />
              <p className="text-sm text-muted-foreground">{linkError ?? 'This reset link is no longer available.'}</p>
              <Button asChild className="w-full">
                <Link to="/forgot-password">Request a new reset link</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 bg-card rounded-2xl shadow-elegant p-6">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11"
                  autoComplete="new-password"
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Repeat your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-11"
                  autoComplete="new-password"
                  disabled={isSubmitting}
                />
              </div>

              <Button type="submit" size="lg" className="w-full gap-2" disabled={isSubmitting || !password || !confirmPassword}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                Save new password
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

export default ResetPassword;