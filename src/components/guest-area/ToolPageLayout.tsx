import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GuestAreaHeader } from './GuestAreaHeader';

interface ToolPageLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function ToolPageLayout({ title, description, children }: ToolPageLayoutProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GuestAreaHeader />
      
      <main className="container mx-auto px-4 py-8 flex-1">
        <div className="mb-6">
          <Button asChild variant="ghost" size="sm" className="gap-2 mb-4">
            <Link to="/dashboard">
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </Button>
          
          <h1 className="text-3xl md:text-4xl mb-2">{title}</h1>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
        
        {children}
      </main>

      <footer className="border-t border-border py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Quinta do Amor © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
