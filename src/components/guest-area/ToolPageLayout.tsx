import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GuestAreaHeader } from './GuestAreaHeader';
import { EditLockBanner } from './EditLockBanner';

interface ToolPageLayoutProps {
  title: string;
  description?: string;
  isLocked?: boolean;
  showOkButton?: boolean;
  children: React.ReactNode;
}

export function ToolPageLayout({ title, description, isLocked = false, showOkButton = true, children }: ToolPageLayoutProps) {
  const navigate = useNavigate();
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Sticky header with back button */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <GuestAreaHeader />
        <div className="container mx-auto px-4 py-3">
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link to="/dashboard">
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </div>
      
      <main className="container mx-auto px-4 py-8 flex-1">
        <div className="mb-6">
          <h1 className="text-3xl md:text-4xl mb-2">{title}</h1>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
        
        {isLocked && <EditLockBanner variant="tool" />}
        
        {children}
        
        {/* OK Button at bottom of page */}
        {showOkButton && (
          <div className="mt-8 flex justify-center">
            <Button 
              onClick={() => navigate('/dashboard')} 
              size="lg"
              className="min-w-32"
            >
              OK
            </Button>
          </div>
        )}
      </main>

      <footer className="border-t border-border py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Quinta do Amor © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}