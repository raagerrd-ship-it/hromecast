import { memo, useMemo } from "react";
import { RefreshCw, AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ActivityLogEntry {
  id: string;
  command_type: string;
  status: string;
  url: string;
  created_at: string;
  processed_at: string | null;
}

interface IPRecoveryStatusProps {
  activityLog: ActivityLogEntry[];
}

interface RecoveryInfo {
  mode: 'normal' | 'backoff' | 'maintenance';
  attempts: number;
  nextInterval: string;
  timestamp: Date;
}

export const IPRecoveryStatus = memo(({ activityLog }: IPRecoveryStatusProps) => {
  const recoveryInfo = useMemo((): RecoveryInfo | null => {
    // Find the most recent IP recovery related log
    const maintenanceLog = activityLog.find(log => log.command_type === 'ip_recovery_maintenance');
    const backoffLog = activityLog.find(log => log.command_type === 'ip_recovery_backoff');
    const successLog = activityLog.find(log => log.command_type === 'ip_recovery');
    const circuitClosedLog = activityLog.find(log => {
      if (log.command_type !== 'circuit_breaker') return false;
      try {
        const data = JSON.parse(log.url);
        return data.status === 'closed';
      } catch {
        return false;
      }
    });

    // If there's a successful recovery or circuit closed after the latest backoff/maintenance, recovery is complete
    const latestRecoveryTimestamp = maintenanceLog?.created_at || backoffLog?.created_at;
    
    if (latestRecoveryTimestamp) {
      const successTime = successLog?.created_at ? new Date(successLog.created_at) : null;
      const circuitClosedTime = circuitClosedLog?.created_at ? new Date(circuitClosedLog.created_at) : null;
      const recoveryTime = new Date(latestRecoveryTimestamp);
      
      // Check if success or circuit closed happened after the last backoff/maintenance
      if (successTime && successTime > recoveryTime) return null;
      if (circuitClosedTime && circuitClosedTime > recoveryTime) return null;
    }

    // Check for maintenance mode first (highest priority)
    if (maintenanceLog) {
      try {
        const data = JSON.parse(maintenanceLog.url);
        return {
          mode: 'maintenance',
          attempts: data.attempts || 0,
          nextInterval: data.interval || '1 hour',
          timestamp: new Date(maintenanceLog.created_at)
        };
      } catch {
        return {
          mode: 'maintenance',
          attempts: 0,
          nextInterval: '1 hour',
          timestamp: new Date(maintenanceLog.created_at)
        };
      }
    }

    // Check for backoff mode
    if (backoffLog) {
      try {
        const data = JSON.parse(backoffLog.url);
        return {
          mode: 'backoff',
          attempts: data.attempts || 0,
          nextInterval: data.nextInterval || 'unknown',
          timestamp: new Date(backoffLog.created_at)
        };
      } catch {
        return null;
      }
    }

    return null;
  }, [activityLog]);

  if (!recoveryInfo) return null;

  const isMaintenance = recoveryInfo.mode === 'maintenance';
  const timeSince = Math.round((Date.now() - recoveryInfo.timestamp.getTime()) / 60000);
  const timeDisplay = timeSince < 60 
    ? `${timeSince} min ago` 
    : `${Math.round(timeSince / 60)}h ago`;

  return (
    <div className={`rounded-xl border p-3 ${
      isMaintenance 
        ? 'bg-orange-500/10 border-orange-500/20' 
        : 'bg-blue-500/10 border-blue-500/20'
    }`}>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          {isMaintenance ? (
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          ) : (
            <RefreshCw className="h-4 w-4 text-blue-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${
            isMaintenance ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400'
          }`}>
            {isMaintenance ? 'Maintenance Mode' : 'IP Recovery Active'}
          </p>
          <p className="text-xs text-muted-foreground">
            {isMaintenance 
              ? `Device not found • Checking every hour`
              : `Attempt ${recoveryInfo.attempts} • Next in ${recoveryInfo.nextInterval}`
            }
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="outline" className={`text-[10px] ${
            isMaintenance 
              ? 'border-orange-500/30 text-orange-600 dark:text-orange-400' 
              : 'border-blue-500/30 text-blue-600 dark:text-blue-400'
          }`}>
            {recoveryInfo.attempts} attempts
          </Badge>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {timeDisplay}
          </span>
        </div>
      </div>
    </div>
  );
});

IPRecoveryStatus.displayName = 'IPRecoveryStatus';
