import { Home } from 'lucide-react';

export function Header() {
  return (
    <header className="bg-card/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Home className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold">Room Planner</h1>
            <p className="text-xs text-muted-foreground">Configuration des chambres</p>
          </div>
        </div>
      </div>
    </header>
  );
}
