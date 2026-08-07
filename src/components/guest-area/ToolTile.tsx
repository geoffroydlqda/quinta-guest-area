import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { BedDouble, Car, Utensils, FileText, ChevronRight } from 'lucide-react';
import type { ToolStatus } from '@/types/guest';

interface ToolTileProps {
  title: string;
  description: string;
  icon: 'room' | 'transport' | 'food' | 'docs';
  status: ToolStatus | boolean;
  href: string;
  disabled?: boolean;
}

const icons = {
  room: BedDouble,
  transport: Car,
  food: Utensils,
  docs: FileText,
};

const statusLabels: Record<ToolStatus, string> = {
  not_set: 'Not set',
  draft: 'Draft',
  submitted: 'Submitted',
};

const docsStatusLabels: Record<ToolStatus, string> = {
  not_set: 'Not viewed',
  draft: 'Viewed',
  submitted: 'Viewed',
};

const statusColors: Record<ToolStatus, string> = {
  not_set: 'bg-muted text-muted-foreground border-transparent',
  draft: 'bg-amber-50 text-amber-800 border-transparent',
  submitted: 'bg-[#EAF6DF] text-[#35532A] border-transparent',
};

export function ToolTile({ title, description, icon, status, href, disabled }: ToolTileProps) {
  const Icon = icons[icon];
  
  // Handle boolean (for docs) or ToolStatus
  const displayStatus: ToolStatus = typeof status === 'boolean' 
    ? (status ? 'submitted' : 'not_set')
    : status;
  
  // Use special labels for docs tool
  const statusLabel = icon === 'docs' 
    ? docsStatusLabels[displayStatus]
    : statusLabels[displayStatus];
  
  return (
    <Link 
      to={disabled ? '#' : href}
      className={`block h-full ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <div className="guest-card p-5 transition-all hover:shadow-md hover:border-[#CAE8BD] group h-full flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <div className="w-11 h-11 rounded-xl bg-[#EAF6DF] flex items-center justify-center">
            <Icon className="w-5 h-5 text-[#35532A]" />
          </div>
          <Badge
            variant="outline"
            className={`${statusColors[displayStatus]} rounded-full px-2.5 text-[11px] font-medium`}
          >
            {statusLabel}
          </Badge>
        </div>

        <h3 className="text-base font-semibold tracking-tight mb-1 group-hover:text-[#35532A] transition-colors">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mb-4 flex-1">
          {description}
        </p>

        <div className="flex items-center text-sm text-[#35532A] font-medium mt-auto">
          {displayStatus === 'not_set' ? 'Set up' : 'View / Edit'}
          <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}
