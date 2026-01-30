import { UserInfo } from '@/types/room';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ArrowRight, User, Mail } from 'lucide-react';

interface UserFormProps {
  userInfo: UserInfo;
  setUserInfo: React.Dispatch<React.SetStateAction<UserInfo>>;
  isEmailValid: boolean;
  isNameValid: boolean;
  onNext: () => void;
}

export function UserForm({
  userInfo,
  setUserInfo,
  isEmailValid,
  isNameValid,
  onNext,
}: UserFormProps) {
  const handleChange = (field: keyof UserInfo, value: string) => {
    setUserInfo((prev) => ({ ...prev, [field]: value }));
  };

  const nameTouched = userInfo.fullName.length > 0;
  const emailTouched = userInfo.email.length > 0;
  const nameError = nameTouched && !isNameValid;
  const emailError = emailTouched && !isEmailValid;
  const canProceed = isEmailValid && isNameValid;

  return (
    <div className="max-w-md mx-auto animate-fade-up">
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl mb-3">Room Setup</h2>
        <p className="text-muted-foreground">
          Configure the bed setup for your stay at Quinta do Amor. You can save and come back later.
        </p>
      </div>

      <div className="bg-card rounded-2xl shadow-elegant p-6 md:p-8 space-y-6">
        {/* Full Name - Required */}
        <div className="space-y-2">
          <Label htmlFor="fullName" className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            Full Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="fullName"
            type="text"
            placeholder="Your full name"
            value={userInfo.fullName}
            onChange={(e) => handleChange('fullName', e.target.value)}
            className={`h-12 ${nameError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
          />
          {nameError && (
            <p className="text-sm text-destructive">Please enter your name</p>
          )}
        </div>

        {/* Email - Required */}
        <div className="space-y-2">
          <Label htmlFor="email" className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            Email Address <span className="text-destructive">*</span>
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="your@email.com"
            value={userInfo.email}
            onChange={(e) => handleChange('email', e.target.value)}
            className={`h-12 ${emailError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
          />
          {emailError && (
            <p className="text-sm text-destructive">Please enter a valid email address</p>
          )}
          <p className="text-xs text-muted-foreground">
            Required to save your progress and receive confirmation
          </p>
        </div>

        <div className="flex justify-end pt-4">
          <Button
            onClick={onNext}
            disabled={!canProceed}
            size="lg"
            className="gap-2"
          >
            Configure Rooms
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
