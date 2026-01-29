import { cn } from '@/lib/utils';

interface FloorPlanProps {
  className?: string;
}

export function FloorPlan({ className }: FloorPlanProps) {
  return (
    <div className={cn("rounded-2xl overflow-hidden border border-border bg-card", className)}>
      <div className="aspect-[4/3] bg-secondary flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-full bg-muted flex items-center justify-center">
            <svg
              className="w-8 h-8 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
          </div>
          <div>
            <p className="font-display text-lg font-medium text-foreground">Plan de la maison</p>
            <p className="text-sm text-muted-foreground">
              Uploadez votre plan via le chat
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
