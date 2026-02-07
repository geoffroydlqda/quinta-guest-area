import { AlertTriangle, AlertCircle } from 'lucide-react';

interface RoomConfigWarningProps {
  totalConfigured: number;
  targetTotal: number;
}

export function RoomConfigWarning({ totalConfigured, targetTotal }: RoomConfigWarningProps) {
  const difference = targetTotal - totalConfigured;

  if (difference === 0) {
    return null;
  }

  const isOverConfigured = difference < 0;

  return (
    <div className={`rounded-xl p-4 ${isOverConfigured ? 'bg-destructive text-destructive-foreground' : 'bg-destructive/10 border border-destructive/30'}`}>
      <div className="flex items-start gap-3">
        {isOverConfigured ? (
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
        )}
        <div>
          {isOverConfigured ? (
            <p className="font-medium">
              Configuration error: Too many rooms configured. Please reduce your selection.
            </p>
          ) : (
            <>
              <p className="font-medium text-destructive">
                {difference} bedroom{difference !== 1 ? 's have' : ' has'} not been configured.
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                If they're not configured before your stay, they'll be set up randomly.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
