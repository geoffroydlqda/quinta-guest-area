import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import qdaLogo from '@/assets/qda-logo.png';

const ForgotPassword = () => {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim()) {
      toast({
        title: 'Missing email',
        description: 'Please enter your email address.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setIsSent(true);
      toast({
        title: 'Check your inbox',
        description: 'Password reset email sent.',
      });
    } catch (error: any) {
      const message = error?.message?.toLowerCase().includes('email')
        ? 'Please enter a valid email address.'
        : 'We could not send the reset email. Please try again.';

      toast({
        title: 'Reset failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

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
            <h1 className="text-2xl font-semibold">Reset your password</h1>
            <p className="text-muted-foreground mt-2">
              Enter the email you use for your Guest Area account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 bg-card rounded-2xl shadow-elegant p-6">
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
                disabled={isSubmitting || isSent}
              />
            </div>

            {isSent && (
              <p className="text-sm text-primary font-medium">Password reset email sent.</p>
            )}

            <Button type="submit" size="lg" className="w-full gap-2" disabled={isSubmitting || isSent || !email.trim()}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send reset email
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default ForgotPassword;