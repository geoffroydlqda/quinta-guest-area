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
          <div className="text-2xl font-semibold text-primary">{stats.kingsFixed}</div>
          <div className="text-xs text-muted-foreground font-medium">King (fixed)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-semibold">{stats.queenSharedCount}</div>
          <div className="text-xs text-muted-foreground font-medium">King size bed (shared bathroom)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-semibold">{stats.twinsSharedCount}</div>
          <div className="text-xs text-muted-foreground font-medium">Twins (shared bathroom)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-semibold">{stats.queenEnsuiteCount}</div>
          <div className="text-xs text-muted-foreground font-medium">King size bed (en-suite bathroom)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-semibold">{stats.twinsEnsuiteCount}</div>
          <div className="text-xs text-muted-foreground font-medium">Twins (en-suite bathroom)</div>
        </div>
        <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
          <div className="text-2xl font-semibold text-muted-foreground">{stats.notSetCount}</div>
          <div className="text-xs text-muted-foreground font-medium">Not set</div>
        </div>
      </div>
    </div>
  );
}
