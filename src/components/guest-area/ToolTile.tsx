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
  not_set: 'bg-muted text-muted-foreground',
  draft: 'bg-amber-100 text-amber-800 border-amber-200',
  submitted: 'bg-green-100 text-green-800 border-green-200',
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
      <div className="bg-card rounded-2xl border border-border p-5 transition-all hover:shadow-md hover:border-primary/30 group h-full flex flex-col">
        <div className="flex items-start justify-between mb-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          <Badge 
            variant="outline" 
            className={`${statusColors[displayStatus]} text-xs`}
          >
            {statusLabel}
          </Badge>
        </div>
        
        <h3 className="text-lg font-medium mb-1 group-hover:text-primary transition-colors">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mb-3 flex-1">
          {description}
        </p>
        
        <div className="flex items-center text-sm text-primary font-medium mt-auto">
          {displayStatus === 'not_set' ? 'Set up' : 'View / Edit'}
          <ChevronRight className="w-4 h-4 ml-1" />
        </div>
      </div>
    </Link>
  );
}
