import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import qdaLogo from '@/assets/qda-logo.png';

interface GuestAreaHeaderProps {
  showLogout?: boolean;
}

export function GuestAreaHeader({ showLogout = true }: GuestAreaHeaderProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <header className="bg-card/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={qdaLogo} alt="Quinta do Amor" className="h-12 w-auto" />
          <div className="hidden sm:block">
            <h1 className="text-lg font-medium leading-tight">Guest Area</h1>
            <p className="text-sm text-muted-foreground">Quinta do Amor</p>
          </div>
        </div>
        
        {showLogout && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
