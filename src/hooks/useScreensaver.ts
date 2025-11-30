import { useEffect, useCallback, useState, useRef } from "react";
import { ScreensaverConfig } from "@/components/ScreensaverSettings";

interface UseScreensaverProps {
  isConnected: boolean;
  isCasting: boolean;
  lastActivityTime: number;
  screensaverConfig: ScreensaverConfig;
  onStartScreensaver: (url: string) => Promise<void>;
  onLog?: (type: 'connection' | 'cast' | 'bridge' | 'error', message: string, details?: string) => void;
}

export const useScreensaver = ({
  isConnected,
  isCasting,
  lastActivityTime,
  screensaverConfig,
  onStartScreensaver,
  onLog,
}: UseScreensaverProps) => {
  const [isScreensaverActive, setIsScreensaverActive] = useState(false);
  const lastCastTimeRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null); // Use timeout instead of interval
  const MIN_CAST_INTERVAL_MS = 60000; // Minimum 60 seconds between casts

  // Schedule next check based on idle timeout
  const scheduleNextCheck = useCallback(() => {
    if (!screensaverConfig.enabled) return;
    
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityTime;
    const idleTimeoutMs = screensaverConfig.idleTimeout * 60 * 1000;
    const timeUntilCheck = Math.max(0, idleTimeoutMs - timeSinceLastActivity);

    console.log(`[Screensaver] ⏰ Scheduling next check in ${Math.floor(timeUntilCheck / 1000)}s`);
    
    timeoutRef.current = setTimeout(() => {
      checkIdleStatus();
    }, timeUntilCheck);
  }, [screensaverConfig.enabled, screensaverConfig.idleTimeout, lastActivityTime]);

  // Use ref to always get the latest values without causing re-renders
  const checkIdleStatus = useCallback(async () => {
    const now = Date.now();
    console.log('[Screensaver] checkIdleStatus called at', new Date().toISOString(), {
      enabled: screensaverConfig.enabled,
      url: screensaverConfig.url,
      isScreensaverActive,
      lastActivityTime: new Date(lastActivityTime).toISOString(),
      idleTimeout: screensaverConfig.idleTimeout,
      lastCastTime: lastCastTimeRef.current ? new Date(lastCastTimeRef.current).toISOString() : 'never'
    });

    // Check cooldown first - prevent re-casting too soon
    const timeSinceLastCast = now - lastCastTimeRef.current;
    if (lastCastTimeRef.current > 0 && timeSinceLastCast < MIN_CAST_INTERVAL_MS) {
      const remainingCooldown = Math.floor((MIN_CAST_INTERVAL_MS - timeSinceLastCast) / 1000);
      console.log(`[Screensaver] ⏸️  COOLDOWN ACTIVE - ${remainingCooldown}s remaining (last cast: ${new Date(lastCastTimeRef.current).toISOString()})`);
      onLog?.('connection', 'Screensaver cooldown active', `${remainingCooldown}s until next cast allowed`);
      return;
    }

    // If screensaver is already active, don't trigger again
    if (isScreensaverActive) {
      console.log('[Screensaver] Check skipped - already active (waiting for user activity)');
      return;
    }

    if (!screensaverConfig.enabled) {
      console.log('[Screensaver] Check skipped - disabled');
      return;
    }

    if (!screensaverConfig.url) {
      console.log('[Screensaver] Check failed - no URL');
      onLog?.('error', 'Screensaver check failed', 'No URL configured');
      return;
    }

    const idleTimeMs = now - lastActivityTime;
    const idleTimeoutMs = screensaverConfig.idleTimeout * 60 * 1000;
    const remainingMs = idleTimeoutMs - idleTimeMs;

    console.log('[Screensaver] Idle calculation', {
      idleTimeMs,
      idleTimeoutMs,
      remainingMs,
      remainingSeconds: Math.floor(remainingMs / 1000),
      shouldTrigger: remainingMs <= 0
    });

    // Log the check status
    if (remainingMs > 0) {
      onLog?.('connection', 'Screensaver idle check', `${Math.floor(remainingMs / 1000)}s until activation`);
    } else {
      console.log('[Screensaver] ⚡ TRIGGERING SCREENSAVER NOW ⚡');
      onLog?.('cast', 'Screensaver idle timeout reached', `Triggering after ${Math.floor(idleTimeMs / 1000)}s idle`);
      
      // Set cooldown IMMEDIATELY
      lastCastTimeRef.current = now;
      setIsScreensaverActive(true);
      
      try {
        console.log('[Screensaver] Calling onStartScreensaver with URL:', screensaverConfig.url);
        await onStartScreensaver(screensaverConfig.url);
        console.log('[Screensaver] ✅ Cast sent successfully');
        onLog?.('cast', 'Screensaver activated', `Next check in ${screensaverConfig.idleTimeout}m`);
        
        // Schedule next check after idle timeout period
        scheduleNextCheck();
      } catch (error) {
        console.error('[Screensaver] ❌ Cast failed:', error);
        onLog?.('error', 'Screensaver cast failed', String(error));
        setIsScreensaverActive(false);
        lastCastTimeRef.current = 0;
        // Retry after a short delay
        setTimeout(() => scheduleNextCheck(), 5000);
      }
    }
  }, [
    screensaverConfig.enabled,
    screensaverConfig.url,
    screensaverConfig.idleTimeout,
    isScreensaverActive,
    lastActivityTime,
    MIN_CAST_INTERVAL_MS,
    onStartScreensaver,
    onLog,
    scheduleNextCheck,
  ]);

  // Set up monitoring on mount and when settings change
  useEffect(() => {
    // Clear any existing timeout first
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!screensaverConfig.enabled) {
      onLog?.('connection', 'Screensaver monitoring disabled', 'Enable in settings to activate');
      return;
    }

    console.log('[Screensaver] 🚀 Starting monitoring - checking based on idle timeout');
    onLog?.('connection', 'Screensaver monitoring started', `Will check after ${screensaverConfig.idleTimeout}m idle`);

    // Schedule the first check
    scheduleNextCheck();

    return () => {
      console.log('[Screensaver] 🛑 Cleaning up monitoring');
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [screensaverConfig.enabled, screensaverConfig.idleTimeout, scheduleNextCheck]);

  // Reset and reschedule when user activity is detected
  useEffect(() => {
    if (isScreensaverActive) {
      const now = Date.now();
      const timeSinceActivity = now - lastActivityTime;
      
      // If activity occurred recently (within last 5 seconds), user is active again
      if (timeSinceActivity < 5000) {
        console.log('[Screensaver] User activity detected, resetting and rescheduling');
        setIsScreensaverActive(false);
        lastCastTimeRef.current = 0;
        onLog?.('connection', 'Screensaver deactivated', 'User activity detected');
        
        // Reschedule check from now
        scheduleNextCheck();
      }
    }
  }, [lastActivityTime, isScreensaverActive, onLog, scheduleNextCheck]);

  // Calculate status information
  const idleTimeMs = Date.now() - lastActivityTime;
  const idleTimeoutMs = screensaverConfig.idleTimeout * 60 * 1000;
  const timeUntilScreensaver = Math.max(0, idleTimeoutMs - idleTimeMs);
  const progressPercentage = Math.min(100, (idleTimeMs / idleTimeoutMs) * 100);

  return { 
    isScreensaverActive,
    idleTimeSeconds: Math.floor(idleTimeMs / 1000),
    timeUntilScreensaverSeconds: Math.floor(timeUntilScreensaver / 1000),
    progressPercentage: Math.round(progressPercentage),
  };
};
