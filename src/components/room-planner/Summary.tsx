import { UserInfo, RoomStats as RoomStatsType } from '@/types/room';
import { RoomStats } from './RoomStats';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Send, Save, CheckCircle, FileText, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface SummaryProps {
  userInfo: UserInfo;
  setUserInfo: React.Dispatch<React.SetStateAction<UserInfo>>;
  stats: RoomStatsType;
  isSubmitted: boolean;
  isSaved: boolean;
  canSubmit: boolean;
  onPrev: () => void;
  onSave: () => void;
  onSubmit: () => void;
  isLoading?: boolean;
}

export function Summary({
  userInfo,
  setUserInfo,
  stats,
  isSubmitted,
  isSaved,
  canSubmit,
  onPrev,
  onSave,
  onSubmit,
  isLoading = false,
}: SummaryProps) {
  if (isSubmitted) {
    return (
      <div className="max-w-2xl mx-auto animate-fade-up">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-3xl md:text-4xl mb-3">Thank You!</h2>
          <p className="text-muted-foreground">
            Your room setup has been submitted. A confirmation email has been sent to {userInfo.email}.
          </p>
        </div>

        {/* Summary Card - Totals Only */}
        <div className="bg-card rounded-2xl shadow-elegant p-6 mb-6">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Housekeeping Setup Summary — Quinta do Amor
          </h3>

          <div className="space-y-3 mb-6">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Full Name</span>
              <span className="font-medium">{userInfo.fullName}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{userInfo.email}</span>
            </div>
            {userInfo.remarks && (
              <div className="py-2 border-b border-border">
                <span className="text-muted-foreground block mb-1">Remarks</span>
                <span className="font-medium">{userInfo.remarks}</span>
              </div>
            )}
          </div>

          {/* Totals Only */}
          <RoomStats stats={stats} />
        </div>

        <div className="text-center">
          <Button asChild variant="outline">
            <Link to="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl mb-3">Review & Submit</h2>
        <p className="text-muted-foreground">
          Review your room configuration before submitting.
        </p>
      </div>

      {/* User Info Summary */}
      <div className="bg-card rounded-2xl shadow-elegant p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">Your Information</h3>
        <div className="space-y-2">
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted-foreground">Full Name</span>
            <span className="font-medium">{userInfo.fullName}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{userInfo.email}</span>
          </div>
        </div>
      </div>

      {/* Room Configuration - Totals Only */}
      <div className="bg-card rounded-2xl shadow-elegant p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">Room Configuration</h3>
        <RoomStats stats={stats} />
      </div>

      {/* Remarks - ONLY place it appears */}
      <div className="bg-card rounded-2xl shadow-elegant p-6 mb-6">
        <Label htmlFor="remarks" className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-muted-foreground" />
          Remarks (optional)
        </Label>
        <Textarea
          id="remarks"
          placeholder="Any special requests or notes for the housekeeping team..."
          value={userInfo.remarks}
          onChange={(e) => setUserInfo(prev => ({ ...prev, remarks: e.target.value }))}
          rows={3}
        />
      </div>

      {/* Saved Confirmation */}
      {isSaved && (
        <div className="bg-success/10 rounded-2xl p-6 mb-6 border border-success/30">
          <h4 className="font-medium mb-2 text-success">Setup Saved!</h4>
          <p className="text-sm text-muted-foreground">
            Your progress has been saved. You can come back anytime by logging in.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-border">
        <Button variant="outline" onClick={onPrev} className="gap-2" disabled={isLoading}>
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        
        <div className="flex-1" />
        
        <Button
          variant="outline"
          onClick={onSave}
          disabled={!canSubmit || isLoading}
          className="gap-2"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {isSaved ? 'Saved' : 'Save Draft'}
        </Button>
        
        <Button onClick={onSubmit} disabled={!canSubmit || isLoading} className="gap-2">
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          Submit Final Setup
        </Button>
      </div>
    </div>
  );
}
