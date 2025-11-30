import { useEffect, useCallback, useState } from "react";
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
  const [lastCastTime, setLastCastTime] = useState<number>(0);
  const MIN_CAST_INTERVAL_MS = 60000; // Minimum 60 seconds between casts

  // Use ref to always get the latest values without causing re-renders
  const checkIdleStatus = useCallback(async () => {
    const now = Date.now();
    console.log('[Screensaver] checkIdleStatus called at', new Date().toISOString(), {
      enabled: screensaverConfig.enabled,
      url: screensaverConfig.url,
      isScreensaverActive,
      lastActivityTime: new Date(lastActivityTime).toISOString(),
      idleTimeout: screensaverConfig.idleTimeout
    });

    // Check cooldown first - prevent re-casting too soon
    const timeSinceLastCast = now - lastCastTime;
    if (lastCastTime > 0 && timeSinceLastCast < MIN_CAST_INTERVAL_MS) {
      const remainingCooldown = Math.floor((MIN_CAST_INTERVAL_MS - timeSinceLastCast) / 1000);
      console.log(`[Screensaver] ⏸️  COOLDOWN ACTIVE - ${remainingCooldown}s remaining (last cast: ${new Date(lastCastTime).toISOString()})`);
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
      console.log(`[Screensaver] Setting cooldown timer for ${MIN_CAST_INTERVAL_MS / 1000}s`);
      onLog?.('cast', 'Screensaver idle timeout reached', `Triggering after ${Math.floor(idleTimeMs / 1000)}s idle`);
      
      // Set active AND cooldown BEFORE calling to prevent multiple triggers
      setIsScreensaverActive(true);
      setLastCastTime(now);
      
      try {
        console.log('[Screensaver] Calling onStartScreensaver with URL:', screensaverConfig.url);
        await onStartScreensaver(screensaverConfig.url);
        console.log('[Screensaver] ✅ onStartScreensaver completed successfully');
        console.log(`[Screensaver] 🔒 Cooldown active until: ${new Date(now + MIN_CAST_INTERVAL_MS).toISOString()}`);
        onLog?.('cast', 'Screensaver activated', `Cast sent - 60s cooldown active`);
      } catch (error) {
        console.error('[Screensaver] ❌ onStartScreensaver failed:', error);
        onLog?.('error', 'Screensaver cast failed', String(error));
        // Reset on error so it can retry
        setIsScreensaverActive(false);
        setLastCastTime(0);
      }
    }
  }, [
    screensaverConfig.enabled,
    screensaverConfig.url,
    screensaverConfig.idleTimeout,
    isScreensaverActive,
    lastActivityTime,
    lastCastTime,
    MIN_CAST_INTERVAL_MS,
    onStartScreensaver,
    onLog,
  ]);

  useEffect(() => {
    if (!screensaverConfig.enabled) {
      onLog?.('connection', 'Screensaver monitoring disabled', 'Enable in settings to activate');
      return;
    }

    // Log monitoring start
    console.log('[Screensaver] 🚀 Setting up monitoring', screensaverConfig);
    onLog?.('connection', 'Screensaver monitoring started', `Checking every ${screensaverConfig.checkInterval}s, timeout: ${screensaverConfig.idleTimeout}m`);

    // Check at the configured interval
    const intervalMs = screensaverConfig.checkInterval * 1000;
    const interval = setInterval(() => {
      console.log('[Screensaver] ⏰ Running periodic check via interval');
      checkIdleStatus();
    }, intervalMs);

    // Run check immediately on start
    console.log('[Screensaver] 🎬 Running initial check');
    checkIdleStatus();

    return () => {
      console.log('[Screensaver] 🛑 Cleaning up monitoring');
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screensaverConfig.enabled, screensaverConfig.checkInterval, screensaverConfig.idleTimeout, screensaverConfig.url]);

  // Reset screensaver when user activity is detected (lastActivityTime changes)
  useEffect(() => {
    if (isScreensaverActive) {
      const now = Date.now();
      const timeSinceActivity = now - lastActivityTime;
      
      // If activity occurred recently (within last 5 seconds), user is active again
      if (timeSinceActivity < 5000) {
        console.log('[Screensaver] User activity detected, resetting screensaver');
        setIsScreensaverActive(false);
        setLastCastTime(0); // Reset cooldown on user activity
        onLog?.('connection', 'Screensaver deactivated', 'User activity detected');
      }
    }
  }, [lastActivityTime, isScreensaverActive, onLog]);

  // Calculate status information
  const idleTimeMs = Date.now() - lastActivityTime;
  const idleTimeoutMs = screensaverConfig.idleTimeout * 60 * 1000;
  const timeUntilScreensaver = Math.max(0, idleTimeoutMs - idleTimeMs);

  return { 
    isScreensaverActive,
    idleTimeSeconds: Math.floor(idleTimeMs / 1000),
    timeUntilScreensaverSeconds: Math.floor(timeUntilScreensaver / 1000),
    checkIntervalSeconds: screensaverConfig.checkInterval,
  };
};
