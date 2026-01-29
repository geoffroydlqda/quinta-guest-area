import { RoomStats as RoomStatsType } from '@/types/room';
import { Crown, Bed, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoomStatsProps {
  stats: RoomStatsType;
  className?: string;
}

export function RoomStats({ stats, className }: RoomStatsProps) {
  const statItems = [
    { label: 'Kings (fixes)', value: stats.kingsFixed, icon: Crown, color: 'text-accent' },
    { label: 'Queens', value: stats.queensCount, icon: Bed, color: 'text-room-queen' },
    { label: '2 Twins', value: stats.twinsCount, icon: Bed, color: 'text-room-twin' },
    { label: 'Occupants', value: stats.totalOccupants, icon: Users, color: 'text-foreground' },
  ];

  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-3", className)}>
      {statItems.map((item) => (
        <div
          key={item.label}
          className="bg-card rounded-xl p-4 border border-border flex items-center gap-3"
        >
          <div className={cn("p-2 rounded-lg bg-secondary", item.color)}>
            <item.icon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-2xl font-display font-bold">{item.value}</p>
            <p className="text-xs text-muted-foreground">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
