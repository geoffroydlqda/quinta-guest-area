import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { isAdminEmail } from '@/lib/admin';
import { loadPricing } from '@/lib/pricing';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasResolvedInitialSession = useRef(false);

  useEffect(() => {
    // Set up auth state listener BEFORE checking session
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);
        // Identité STABLE du user (2 sept 2026) : au retour sur l'onglet,
        // Supabase émet TOKEN_REFRESHED avec un NOUVEL objet user — même id,
        // référence différente. Tous les useEffect qui dépendent de `user`
        // rechargeaient alors leurs données (perte des formulaires en cours,
        // ex. Add passenger dans Transportation). On garde l'ancienne
        // référence tant que l'utilisateur connecté est le même.
        setUser((prev) => (prev && newSession?.user && prev.id === newSession.user.id ? prev : newSession?.user ?? null));

        if (event !== 'INITIAL_SESSION' || hasResolvedInitialSession.current) {
          setIsLoading(false);
        }

        // Tarifs : pricing_settings est réservé aux connectés — si le premier
        // chargement (avant login) n'a rien ramené, on recharge maintenant.
        if (event === 'SIGNED_IN') {
          loadPricing();
        }

        // On sign-in (including OAuth callback), ensure profile exists — skip for admins
        if (event === 'SIGNED_IN' && newSession?.user && !isAdminEmail(newSession.user.email)) {
          // Use setTimeout to avoid blocking the auth state change
          setTimeout(async () => {
            try {
              await supabase.functions.invoke('ensure-guest-profile', {
                body: { metadata: newSession.user.user_metadata },
              });
            } catch (err) {
              console.error('Failed to ensure profile on sign-in:', err);
            }
          }, 0);
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      hasResolvedInitialSession.current = true;
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
