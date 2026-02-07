import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import qdaLogo from '@/assets/qda-logo.png';

const Landing = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-8 animate-fade-up">
          <div className="flex flex-col items-center gap-4">
            <img 
              src={qdaLogo} 
              alt="Quinta do Amor" 
              className="h-24 w-auto"
            />
            <div>
              <h1 className="text-3xl md:text-4xl font-medium">Guest Area</h1>
              <p className="text-muted-foreground mt-2">Quinta do Amor</p>
            </div>
          </div>

          <p className="text-muted-foreground">
            Manage your stay at Quinta do Amor — rooms, transportation, food, and more.
          </p>

          <div className="flex flex-col gap-3">
            <Button asChild size="lg" className="w-full">
              <Link to="/auth?mode=signup">Create account</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link to="/auth?mode=login">Log in</Link>
            </Button>
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

export default Landing;