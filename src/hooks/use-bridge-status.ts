import { useState, useEffect, useMemo } from "react";

interface ActivityLogEntry {
  command_type: string;
  url: string;
  processed_at: string | null;
}

interface BridgeStatus {
  isOnline: boolean;
  timeStr: string | undefined;
  hasActivity: boolean;
  version: string;
}

export function useBridgeStatus(activityLog: ActivityLogEntry[]): BridgeStatus {
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return useMemo(() => {
    const latestActivity = activityLog.length > 0 && activityLog[0].processed_at 
      ? new Date(activityLog[0].processed_at) 
      : null;
    const isOnline = latestActivity && (currentTime - latestActivity.getTime()) < 300000;
    const timeStr = latestActivity?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Extract version from bridge_log
    let version = '';
    const bridgeStartLog = activityLog.find(log => {
      if (log.command_type === 'bridge_log' && log.url) {
        try {
          const parsed = JSON.parse(log.url);
          return parsed.message?.includes('Bridge v');
        } catch {
          return log.url.includes('Bridge v');
        }
      }
      return false;
    });
    
    if (bridgeStartLog?.url) {
      try {
        const parsed = JSON.parse(bridgeStartLog.url);
        const match = parsed.message?.match(/Bridge v([\d.]+)/);
        if (match) version = match[1];
      } catch {
        const match = bridgeStartLog.url.match(/Bridge v([\d.]+)/);
        if (match) version = match[1];
      }
    }
    
    return { isOnline: !!isOnline, timeStr, hasActivity: !!latestActivity, version };
  }, [activityLog, currentTime]);
}
