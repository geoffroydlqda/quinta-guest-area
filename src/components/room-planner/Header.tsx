import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import qdaLogo from '@/assets/qda-logo.png';

interface HeaderProps {
  showBackToDashboard?: boolean;
}

export function Header({ showBackToDashboard }: HeaderProps) {
  return (
    <header className="bg-card/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {showBackToDashboard && (
            <Link 
              to="/dashboard" 
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mr-2"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
          )}
          <img 
            src={qdaLogo} 
            alt="Quinta do Amor" 
            className="h-12 w-auto"
          />
        </div>
        <div className="text-right">
          <h1 className="text-xl font-medium">Room Setup</h1>
          <p className="text-xs text-muted-foreground">Quinta do Amor</p>
        </div>
      </div>
    </header>
  );
}
