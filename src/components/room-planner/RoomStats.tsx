import { RoomStats as RoomStatsType } from '@/types/room';
import { cn } from '@/lib/utils';

interface RoomStatsProps {
  stats: RoomStatsType;
  className?: string;
}

export function RoomStats({ stats, className }: RoomStatsProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {/* Summary grid - main stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-medium text-primary">{stats.kingsFixed}</div>
          <div className="text-xs text-muted-foreground">King (fixed)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-medium">{stats.queenSharedCount}</div>
          <div className="text-xs text-muted-foreground">Queen (shared)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-medium">{stats.twinsSharedCount}</div>
          <div className="text-xs text-muted-foreground">Twins (shared)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-medium">{stats.queenEnsuiteCount}</div>
          <div className="text-xs text-muted-foreground">Queen (en-suite)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-medium">{stats.twinsEnsuiteCount}</div>
          <div className="text-xs text-muted-foreground">Twins (en-suite)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-medium text-muted-foreground">{stats.notSetCount}</div>
          <div className="text-xs text-muted-foreground">Not set</div>
        </div>
      </div>
    </div>
  );
}
