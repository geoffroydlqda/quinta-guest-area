import { RoomStats as RoomStatsType } from '@/types/room';
import { Bed, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoomStatsProps {
  stats: RoomStatsType;
  className?: string;
}

export function RoomStats({ stats, className }: RoomStatsProps) {
  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-3", className)}>
      <div className="bg-card rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-1">
          <Crown className="w-4 h-4 text-primary" />
          <span className="text-xs text-muted-foreground">Kings (fixed)</span>
        </div>
        <p className="text-2xl font-medium">{stats.kingsFixed}</p>
      </div>

      <div className="bg-card rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-1">
          <Bed className="w-4 h-4 text-room-queen" />
          <span className="text-xs text-muted-foreground">Queens</span>
        </div>
        <p className="text-2xl font-medium">{stats.queensCount}</p>
      </div>

      <div className="bg-card rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex">
            <Bed className="w-3 h-3 text-room-twin" />
            <Bed className="w-3 h-3 text-room-twin" />
          </div>
          <span className="text-xs text-muted-foreground">2 Twins</span>
        </div>
        <p className="text-2xl font-medium">{stats.twinsCount}</p>
      </div>

      <div className="bg-card rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-4 h-4 rounded border-2 border-muted-foreground/30" />
          <span className="text-xs text-muted-foreground">Unselected</span>
        </div>
        <p className="text-2xl font-medium">{stats.unselectedCount}</p>
      </div>
    </div>
  );
}
