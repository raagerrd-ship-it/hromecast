import React, { useMemo, memo } from "react";
import { Activity, CheckCircle, XCircle, Clock, Play, StopCircle, RotateCcw, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ActivityLogEntry {
  id: string;
  command_type: string;
  status: string;
  url: string;
  created_at: string;
  processed_at: string | null;
}

interface ActivityLogProps {
  activityLog: ActivityLogEntry[];
  screensaverActive: boolean;
}

// Helper functions outside component to avoid recreation
const isStatusCheckLog = (log: ActivityLogEntry): boolean => {
  if (log.command_type === 'idle_check') return true;
  if (log.command_type !== 'bridge_log') return false;
  try {
    const data = JSON.parse(log.url);
    const msg = data.message || '';
    return msg.includes('Checking idle') || 
           msg.includes(': idle') || 
           msg.includes(': busy') || 
           msg.includes(': screensaver active');
  } catch {
    return false;
  }
};

const formatTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return isToday 
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const cleanDeviceName = (name: string): string => {
  return name.replace(/([A-Za-z]+(?:-[A-Za-z]+)*)-[a-f0-9]{20,}/gi, (m: string, n: string) => n.replace(/-/g, ' '));
};

// Memoized log item component - receives logIndex as prop to avoid O(n) indexOf
const ActivityLogItem = memo(({ log, allLogs, logIndex }: { log: ActivityLogEntry; allLogs: ActivityLogEntry[]; logIndex: number }) => {
  const getIcon = () => {
    if (log.command_type === 'circuit_breaker') {
      return log.status === 'failed'
        ? <Zap className="h-4 w-4 text-destructive" />
        : <Zap className="h-4 w-4 text-primary" />;
    }
    if (log.command_type === 'screensaver_start') {
      return log.status === 'failed' 
        ? <XCircle className="h-4 w-4 text-destructive" />
        : <Play className="h-4 w-4 text-primary" />;
    }
    if (log.command_type === 'screensaver_resumed') {
      return <RotateCcw className="h-4 w-4 text-primary" />;
    }
    if (log.command_type === 'screensaver_stop') {
      return <StopCircle className="h-4 w-4 text-orange-500" />;
    }
    if (log.command_type === 'bridge_start') {
      return <Activity className="h-4 w-4 text-primary" />;
    }
    if (log.command_type === 'bridge_stop') {
      return <Activity className="h-4 w-4 text-muted-foreground" />;
    }
    if (log.command_type === 'bridge_log') {
      return log.status === 'failed'
        ? <XCircle className="h-4 w-4 text-destructive" />
        : <Activity className="h-4 w-4 text-muted-foreground" />;
    }
    if (log.status === 'completed' || log.status === 'processed') {
      return <CheckCircle className="h-4 w-4 text-primary" />;
    }
    if (log.status === 'failed') {
      return <XCircle className="h-4 w-4 text-destructive" />;
    }
    return <Clock className="h-4 w-4 text-yellow-500" />;
  };

  const getLabel = () => {
    if (log.command_type === 'circuit_breaker') {
      try {
        const data = JSON.parse(log.url);
        if (data.status === 'open') {
          return `Circuit breaker opened (${data.failures} failures)`;
        }
        return 'Circuit breaker closed';
      } catch {
        return 'Circuit breaker';
      }
    }
    if (log.command_type === 'screensaver_start') return 'Screensaver started';
    if (log.command_type === 'screensaver_resumed') return 'Screensaver resumed';
    if (log.command_type === 'screensaver_stop') return 'Screensaver stopped';
    if (log.command_type === 'bridge_start') return 'Bridge started';
    if (log.command_type === 'bridge_stop') return 'Bridge stopped';
    if (log.command_type === 'bridge_log') {
      try {
        const data = JSON.parse(log.url);
        let message = data.message || 'Bridge log';
        return cleanDeviceName(message);
      } catch {
        return 'Bridge log';
      }
    }
    if (log.command_type === 'cast') return 'Manual cast';
    return log.command_type;
  };

  const getDuration = () => {
    if (log.command_type !== 'screensaver_start' && log.command_type !== 'screensaver_resumed') return null;
    // Use passed logIndex instead of indexOf (O(1) vs O(n))
    const stopLog = allLogs.slice(0, logIndex).reverse().find(
      (l) => l.command_type === 'screensaver_stop' && l.status === 'completed'
    );
    if (!stopLog) return null;
    const startTime = new Date(log.created_at).getTime();
    const stopTime = new Date(stopLog.created_at).getTime();
    const durationMs = stopTime - startTime;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  };

  const duration = getDuration();

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="flex-shrink-0">
        {getIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {getLabel()}
          {duration && <span className="text-muted-foreground font-normal ml-1">({duration})</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(log.created_at)}
        </p>
      </div>
      <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${
        log.status === 'failed' ? 'border-destructive/50 text-destructive' : ''
      }`}>
        {log.status}
      </Badge>
    </div>
  );
});

ActivityLogItem.displayName = 'ActivityLogItem';

// Memoized idle group component
const IdleGroupItem = memo(({ logs }: { logs: ActivityLogEntry[] }) => {
  const firstLog = logs[logs.length - 1]; // oldest (array is desc)
  const lastLog = logs[0]; // newest
  
  const lastTime = formatTime(lastLog.processed_at || lastLog.created_at);
  
  // Get firstCheckTime from log data if available
  let firstTime = formatTime(firstLog.created_at);
  let checkCount = logs.length;
  let deviceName = 'device';
  let lastStatus = '';
  
  try {
    const data = JSON.parse(lastLog.url);
    if (data.firstCheckTime) {
      firstTime = formatTime(data.firstCheckTime);
    }
    if (data.checkCount && typeof data.checkCount === 'number') {
      checkCount = data.checkCount;
    }
    const message = data.message || '';
    const deviceMatch = message.match(/Device\s+([^:]+):\s*(.+)/) || 
                       message.match(/Checking idle:\s*([^(]+)/);
    if (deviceMatch) {
      deviceName = cleanDeviceName(deviceMatch[1].trim());
      lastStatus = deviceMatch[2]?.trim() || '';
    }
  } catch {}
  
  const timeDisplay = firstTime === lastTime ? firstTime : `${firstTime} → ${lastTime}`;
  const label = lastStatus ? `${deviceName}: ${lastStatus}` : `Checking ${deviceName}`;
  
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="flex-shrink-0">
        <Activity className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-muted-foreground">{timeDisplay}</p>
      </div>
      <Badge variant="outline" className="text-[10px] flex-shrink-0">
        {checkCount}x
      </Badge>
    </div>
  );
});

IdleGroupItem.displayName = 'IdleGroupItem';

interface GroupedLogItem {
  type: 'single' | 'idle_group';
  log?: ActivityLogEntry;
  logs?: ActivityLogEntry[];
  logIndex?: number; // Track original index for duration calculation
}

export const ActivityLog = memo(({ activityLog, screensaverActive }: ActivityLogProps) => {
  // Memoize the grouping logic - only recalculate when activityLog changes
  const groupedLogs = useMemo((): GroupedLogItem[] => {
    const result: GroupedLogItem[] = [];
    let currentIdleGroup: ActivityLogEntry[] = [];
    
    activityLog.forEach((log, index) => {
      if (isStatusCheckLog(log)) {
        currentIdleGroup.push(log);
      } else {
        if (currentIdleGroup.length > 0) {
          result.push({ type: 'idle_group', logs: [...currentIdleGroup] });
          currentIdleGroup = [];
        }
        result.push({ type: 'single', log, logIndex: index });
      }
    });
    
    if (currentIdleGroup.length > 0) {
      result.push({ type: 'idle_group', logs: currentIdleGroup });
    }
    
    return result;
  }, [activityLog]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Activity</span>
        </div>
        {screensaverActive && (
          <Badge className="gap-1.5 bg-primary/10 text-primary border-0 text-xs">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            Live
          </Badge>
        )}
      </div>
      
      <div className="rounded-2xl bg-secondary/30 border border-border overflow-hidden">
        {activityLog.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Activity className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No activity yet</p>
          </div>
        ) : (
          <ScrollArea className="h-48">
            <div className="divide-y divide-border">
              {groupedLogs.map((item, index) => {
                if (item.type === 'idle_group' && item.logs) {
                  return <IdleGroupItem key={`idle-group-${index}`} logs={item.logs} />;
                }
                if (item.log) {
                  return <ActivityLogItem key={item.log.id} log={item.log} allLogs={activityLog} logIndex={item.logIndex ?? 0} />;
                }
                return null;
              })}
              {activityLog.length >= 50 && (
                <div className="flex items-center justify-center p-2 text-xs text-muted-foreground border-t border-border">
                  Visar senaste 50 loggar
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </section>
  );
});

ActivityLog.displayName = 'ActivityLog';
