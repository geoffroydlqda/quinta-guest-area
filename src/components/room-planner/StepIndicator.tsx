import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels: string[];
  onStepClick?: (step: number) => void;
}

export function StepIndicator({ currentStep, totalSteps, labels, onStepClick }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2 md:gap-4">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isCompleted = step < currentStep;
        const canClick = onStepClick && (isCompleted || step <= currentStep);

        return (
          <div key={step} className="flex items-center gap-2 md:gap-4">
            <button
              onClick={() => canClick && onStepClick(step)}
              disabled={!canClick}
              className={cn(
                "flex flex-col items-center gap-1.5 transition-all duration-300",
                canClick && "cursor-pointer hover:opacity-80",
                !canClick && "cursor-default"
              )}
            >
              <div
                className={cn(
                  "step-indicator",
                  isActive && "step-indicator-active",
                  isCompleted && "step-indicator-completed",
                  !isActive && !isCompleted && "step-indicator-pending"
                )}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : step}
              </div>
              <span
                className={cn(
                  "text-xs font-medium hidden md:block",
                  isActive && "text-foreground",
                  isCompleted && "text-success",
                  !isActive && !isCompleted && "text-muted-foreground"
                )}
              >
                {labels[i]}
              </span>
            </button>
            
            {step < totalSteps && (
              <div
                className={cn(
                  "w-8 md:w-16 h-0.5 transition-colors duration-300",
                  step < currentStep ? "bg-success" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
