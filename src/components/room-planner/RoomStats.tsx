import { RoomStats as RoomStatsType } from '@/types/room';
import { cn } from '@/lib/utils';

interface RoomStatsProps {
  stats: RoomStatsType;
  className?: string;
}

export function RoomStats({ stats, className }: RoomStatsProps) {
  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-3", className)}>
      <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
        <div className="text-2xl font-medium text-primary">{stats.kingsFixed}</div>
        <div className="text-xs text-muted-foreground">King (fixed)</div>
      </div>
      <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
        <div className="text-2xl font-medium">{stats.queensCount}</div>
        <div className="text-xs text-muted-foreground">Queen</div>
      </div>
      <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
        <div className="text-2xl font-medium">{stats.twinsCount}</div>
        <div className="text-xs text-muted-foreground">2 Twins</div>
      </div>
      <div className="bg-card rounded-xl p-4 text-center shadow-sm border border-border">
        <div className="text-2xl font-medium text-muted-foreground">{stats.notSetCount}</div>
        <div className="text-xs text-muted-foreground">Not set</div>
      </div>
    </div>
  );
}
