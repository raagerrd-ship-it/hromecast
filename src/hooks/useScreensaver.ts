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

  // Use ref to always get the latest values without causing re-renders
  const checkIdleStatus = useCallback(async () => {
    const now = Date.now();
    console.log('[Screensaver] checkIdleStatus called at', new Date().toISOString(), {
      enabled: screensaverConfig.enabled,
      url: screensaverConfig.url,
      isScreensaverActive,
      lastActivityTime: new Date(lastActivityTime).toISOString(),
      idleTimeout: screensaverConfig.idleTimeout,
      lastCastTime: lastCastTime ? new Date(lastCastTime).toISOString() : 'never'
    });

    // In bridge mode, we don't need to be connected to cast
    // The bridge service will handle the Chromecast connection
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
    
    // Check cooldown - prevent re-casting within check interval
    const timeSinceLastCast = now - lastCastTime;
    const cooldownMs = screensaverConfig.checkInterval * 1000;

    console.log('[Screensaver] Idle calculation', {
      idleTimeMs,
      idleTimeoutMs,
      remainingMs,
      remainingSeconds: Math.floor(remainingMs / 1000),
      shouldTrigger: remainingMs <= 0,
      timeSinceLastCast,
      cooldownMs,
      cooldownActive: lastCastTime > 0 && timeSinceLastCast < cooldownMs
    });

    // Log the check status
    if (remainingMs > 0) {
      onLog?.('connection', 'Screensaver idle check', `${Math.floor(remainingMs / 1000)}s until activation`);
    } else {
      // Check cooldown FIRST - prevent re-casting too soon
      if (lastCastTime > 0 && timeSinceLastCast < cooldownMs) {
        console.log('[Screensaver] Check skipped - cooldown active', Math.floor((cooldownMs - timeSinceLastCast) / 1000), 's remaining');
        return;
      }
      
      // Only trigger if not already active
      if (isScreensaverActive) {
        console.log('[Screensaver] Check skipped - already triggered and waiting');
        return;
      }
      
      console.log('[Screensaver] ⚡ TRIGGERING SCREENSAVER NOW ⚡');
      onLog?.('cast', 'Screensaver idle timeout reached', `Triggering after ${Math.floor(idleTimeMs / 1000)}s idle`);
      setIsScreensaverActive(true);
      setLastCastTime(now); // Record cast time
      
      try {
        console.log('[Screensaver] Calling onStartScreensaver with URL:', screensaverConfig.url);
        await onStartScreensaver(screensaverConfig.url);
        console.log('[Screensaver] ✅ onStartScreensaver completed successfully');
        onLog?.('cast', 'Screensaver activated', 'Cast command sent successfully');
        // Don't reset - stay active until user activity
      } catch (error) {
        console.error('[Screensaver] ❌ onStartScreensaver failed:', error);
        onLog?.('error', 'Screensaver cast failed', String(error));
        // Reset immediately on error so it can retry
        setIsScreensaverActive(false);
      }
    }
  }, [
    screensaverConfig.enabled,
    screensaverConfig.url,
    screensaverConfig.idleTimeout,
    screensaverConfig.checkInterval,
    isScreensaverActive,
    lastActivityTime,
    lastCastTime,
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
