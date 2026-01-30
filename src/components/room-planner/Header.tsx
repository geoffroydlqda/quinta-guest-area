import qdaLogo from '@/assets/qda-logo.png';

export function Header() {
  return (
    <header className="bg-card/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
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
