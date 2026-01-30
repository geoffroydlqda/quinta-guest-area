import { UserInfo, RoomStats as RoomStatsType } from '@/types/room';
import { RoomStats } from './RoomStats';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Send, Save, CheckCircle, Copy, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface SummaryProps {
  userInfo: UserInfo;
  setUserInfo: React.Dispatch<React.SetStateAction<UserInfo>>;
  stats: RoomStatsType;
  isSubmitted: boolean;
  isSaved: boolean;
  editUrl: string | null;
  canSubmit: boolean;
  onPrev: () => void;
  onSave: () => void;
  onSubmit: () => void;
  onNewSetup: () => void;
}

export function Summary({
  userInfo,
  setUserInfo,
  stats,
  isSubmitted,
  isSaved,
  editUrl,
  canSubmit,
  onPrev,
  onSave,
  onSubmit,
  onNewSetup,
}: SummaryProps) {
  const copyEditUrl = () => {
    if (editUrl) {
      navigator.clipboard.writeText(editUrl);
      toast.success('Edit link copied to clipboard');
    }
  };

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

        {/* Edit Link */}
        {editUrl && (
          <div className="bg-card rounded-2xl shadow-elegant p-6 mb-6">
            <h4 className="font-medium mb-2">Your Edit Link</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Use this link to make changes to your room setup later.
            </p>
            <div className="flex gap-2">
              <code className="flex-1 p-3 rounded-lg bg-muted text-sm break-all">
                {editUrl}
              </code>
              <Button variant="outline" size="icon" onClick={copyEditUrl}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="text-center">
          <Button onClick={onNewSetup} variant="outline">
            Start New Setup
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

      {/* Edit Link (if saved) */}
      {isSaved && editUrl && (
        <div className="bg-success/10 rounded-2xl p-6 mb-6 border border-success/30">
          <h4 className="font-medium mb-2 text-success">Setup Saved!</h4>
          <p className="text-sm text-muted-foreground mb-3">
            Your edit link has been sent to {userInfo.email}. You can also copy it below.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 p-3 rounded-lg bg-card text-sm break-all">
              {editUrl}
            </code>
            <Button variant="outline" size="icon" onClick={copyEditUrl}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-border">
        <Button variant="outline" onClick={onPrev} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        
        <div className="flex-1" />
        
        <Button
          variant="outline"
          onClick={onSave}
          disabled={!canSubmit || isSaved}
          className="gap-2"
        >
          <Save className="w-4 h-4" />
          {isSaved ? 'Saved' : 'Save for Later'}
        </Button>
        
        <Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
          <Send className="w-4 h-4" />
          Submit Final Setup
        </Button>
      </div>
    </div>
  );
}
