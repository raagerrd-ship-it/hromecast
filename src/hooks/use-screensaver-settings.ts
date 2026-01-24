import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScreensaverConfig } from "@/components/ScreensaverSettings";
import { useDebouncedValue } from "./use-debounced-value";

const SCREENSAVER_CONFIG_KEY = "chromecast-screensaver-config";

const DEFAULT_CONFIG: ScreensaverConfig = {
  enabled: false,
  url: "",
  idleTimeout: 5,
  checkInterval: 10,
};

export function useScreensaverSettings(deviceId: string) {
  const [isLoading, setIsLoading] = useState(true);
  const [screensaverConfig, setScreensaverConfig] = useState<ScreensaverConfig>(DEFAULT_CONFIG);
  const [selectedChromecastId, setSelectedChromecastId] = useState<string | null>(null);
  const [screensaverActive, setScreensaverActive] = useState(false);
  const hasInitializedRef = useRef(false);

  // Debounce settings to reduce DB writes
  const debouncedConfig = useDebouncedValue(screensaverConfig, 500);
  const debouncedChromecastId = useDebouncedValue(selectedChromecastId, 500);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('screensaver_settings')
          .select('*')
          .eq('device_id', deviceId)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading settings:', error);
          const saved = localStorage.getItem(SCREENSAVER_CONFIG_KEY);
          if (saved) {
            try {
              setScreensaverConfig(JSON.parse(saved));
            } catch (e) {
              console.error('Error parsing localStorage settings:', e);
            }
          }
        } else if (data) {
          setScreensaverConfig({
            enabled: data.enabled,
            url: data.url || "",
            idleTimeout: data.idle_timeout,
            checkInterval: data.check_interval,
          });
          setSelectedChromecastId(data.selected_chromecast_id || null);
          setScreensaverActive(data.screensaver_active || false);
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      } finally {
        setIsLoading(false);
        setTimeout(() => {
          hasInitializedRef.current = true;
        }, 600);
      }
    };

    loadSettings();

    // Realtime subscription for screensaver_active changes
    const channel = supabase
      .channel('screensaver_settings_realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'screensaver_settings'
        },
        (payload) => {
          if (payload.new && (payload.new as any).device_id === deviceId) {
            setScreensaverActive((payload.new as any).screensaver_active || false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId]);

  // Save settings with debounce
  useEffect(() => {
    if (isLoading || !hasInitializedRef.current) return;

    const saveSettings = async () => {
      try {
        console.log('💾 Saving settings:', { enabled: debouncedConfig.enabled, url: debouncedConfig.url });
        const { error } = await supabase
          .from('screensaver_settings')
          .upsert({
            device_id: deviceId,
            enabled: debouncedConfig.enabled,
            url: debouncedConfig.url,
            idle_timeout: debouncedConfig.idleTimeout,
            check_interval: debouncedConfig.checkInterval,
            selected_chromecast_id: debouncedChromecastId,
          }, {
            onConflict: 'device_id'
          });

        if (error) {
          console.error('Error saving settings:', error);
        } else {
          localStorage.setItem(SCREENSAVER_CONFIG_KEY, JSON.stringify(debouncedConfig));
        }
      } catch (error) {
        console.error('Error saving settings:', error);
      }
    };

    saveSettings();
  }, [debouncedConfig, debouncedChromecastId, deviceId, isLoading]);

  const handleConfigChange = useCallback((updates: Partial<ScreensaverConfig>) => {
    setScreensaverConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const handleChromecastSelected = useCallback((id: string | null) => {
    setSelectedChromecastId(id);
  }, []);

  return {
    isLoading,
    screensaverConfig,
    selectedChromecastId,
    screensaverActive,
    handleConfigChange,
    handleChromecastSelected,
  };
}
