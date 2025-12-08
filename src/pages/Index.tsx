import { ScreensaverSettings, ScreensaverConfig } from "@/components/ScreensaverSettings";
import { ChromecastSelector } from "@/components/ChromecastSelector";
import { ActivityLog } from "@/components/ActivityLog";
import { Play, Tv } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const SCREENSAVER_CONFIG_KEY = "chromecast-screensaver-config";

// Memoized device ID - only created once
const DEVICE_ID = "device-1764517968693-qxx7xr08y";

// Debounce helper
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

const Index = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  
  const [screensaverConfig, setScreensaverConfig] = useState<ScreensaverConfig>({
    enabled: false,
    url: "",
    idleTimeout: 5,
    checkInterval: 10,
  });
  
  const [selectedChromecastId, setSelectedChromecastId] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<any[]>([]);
  const [screensaverActive, setScreensaverActive] = useState(false);
  const [previewScale, setPreviewScale] = useState(0.35);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Debounce settings to reduce DB writes (500ms delay)
  const debouncedConfig = useDebouncedValue(screensaverConfig, 500);
  const debouncedChromecastId = useDebouncedValue(selectedChromecastId, 500);

  // Memoized fetch function - also returns latest activity time for bridge status
  const fetchActivityLog = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('cast_commands')
        .select('*')
        .eq('device_id', DEVICE_ID)
        .order('processed_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setActivityLog(data || []);
    } catch (error) {
      console.error('Error fetching activity log:', error);
    }
  }, []);

  // Update current time every 10 seconds for footer status
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Preview scale calculation
  useEffect(() => {
    const updateScale = () => {
      if (previewContainerRef.current) {
        const containerWidth = previewContainerRef.current.offsetWidth;
        setPreviewScale(containerWidth / 1920);
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [screensaverConfig.enabled, screensaverConfig.url]);

  // Initial load and realtime subscriptions
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('screensaver_settings')
          .select('*')
          .eq('device_id', DEVICE_ID)
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
      }
    };

    loadSettings();
    fetchActivityLog();

    // Combined realtime subscription for both tables
    const activityChannel = supabase
      .channel('index_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cast_commands'
          // Removed filter - Supabase Realtime has issues with text filters on UPDATE
        },
        (payload) => {
          // Only process events for our device
          if (payload.new && (payload.new as any).device_id === DEVICE_ID) {
            console.log('🔔 Realtime event:', payload.eventType, payload);
            fetchActivityLog();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'screensaver_settings'
        },
        (payload) => {
          if (payload.new && (payload.new as any).device_id === DEVICE_ID) {
            setScreensaverActive((payload.new as any).screensaver_active || false);
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime subscription status:', status);
      });

    // Backup polling every 15 seconds in case realtime misses updates
    const pollInterval = setInterval(() => {
      console.log('⏰ Polling activity log...');
      fetchActivityLog();
    }, 15000);

    return () => {
      supabase.removeChannel(activityChannel);
      clearInterval(pollInterval);
    };
  }, [fetchActivityLog]);

  // Save settings with debounce
  useEffect(() => {
    if (isLoading) return;

    const saveSettings = async () => {
      try {
        const { error } = await supabase
          .from('screensaver_settings')
          .upsert({
            device_id: DEVICE_ID,
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
  }, [debouncedConfig, debouncedChromecastId, isLoading]);

  // Memoized handler
  const handleStartScreensaver = useCallback(async (url: string) => {
    try {
      const { data: renderData, error: renderError } = await supabase.functions.invoke('render-website', {
        body: { url, action: 'cast' }
      });

      if (renderError) {
        toast({
          title: "Failed",
          description: renderError.message || "Could not start cast",
          variant: "destructive",
        });
        return;
      }

      const viewerUrl = renderData.viewerUrl;
      
      const { error: queueError } = await supabase.functions.invoke('queue-cast', {
        body: { 
          deviceId: DEVICE_ID,
          url: viewerUrl,
          commandType: 'cast'
        }
      });

      if (queueError) {
        toast({
          title: "Failed",
          description: "Could not queue cast",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Cast started",
        description: "Sending to your TV",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Something went wrong",
        variant: "destructive",
      });
    }
  }, [toast]);

  // Memoized config change handler
  const handleConfigChange = useCallback((config: ScreensaverConfig) => {
    setScreensaverConfig(config);
  }, []);

  // Memoized chromecast selection handler
  const handleChromecastSelected = useCallback((id: string | null) => {
    setSelectedChromecastId(id);
  }, []);

  // Bridge status based on latest cast_commands activity (more reliable than last_idle_check)
  const bridgeStatus = useMemo(() => {
    // Find the most recent processed_at from activity log
    const latestActivity = activityLog.length > 0 && activityLog[0].processed_at 
      ? new Date(activityLog[0].processed_at) 
      : null;
    const isOnline = latestActivity && (currentTime - latestActivity.getTime()) < 300000; // 5 min
    const timeStr = latestActivity?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { isOnline, timeStr, hasActivity: !!latestActivity };
  }, [activityLog, currentTime]);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col safe-top safe-bottom">
      {/* Header */}
      <header className="flex-shrink-0 px-4 pt-6 pb-4 sm:px-6 sm:pt-8">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-primary/20 flex items-center justify-center">
              <Tv className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Screensaver</h1>
              <p className="text-xs text-muted-foreground">Auto-cast when idle</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 pb-4 sm:px-6 overflow-auto">
        <div className="max-w-lg mx-auto space-y-6">
          
          {/* Device Selection */}
          <section>
            <ChromecastSelector
              deviceId={DEVICE_ID}
              selectedChromecastId={selectedChromecastId}
              onChromecastSelected={handleChromecastSelected}
            />
          </section>

          {/* Settings */}
          <section>
            <ScreensaverSettings
              currentSettings={screensaverConfig}
              onSave={handleConfigChange}
              isActive={screensaverActive}
            />
          </section>

          {/* Preview */}
          {screensaverConfig.enabled && screensaverConfig.url && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Preview</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">1920×1080</span>
                  <button
                    onClick={() => handleStartScreensaver(screensaverConfig.url!)}
                    className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                    title="Test cast"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div 
                ref={previewContainerRef}
                className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden ring-1 ring-border"
              >
                <div 
                  className="absolute top-0 left-0"
                  style={{
                    width: '1920px',
                    height: '1080px',
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top left',
                  }}
                >
                  <iframe
                    src={screensaverConfig.url}
                    width="1920"
                    height="1080"
                    title="Preview"
                    loading="lazy"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                    style={{ border: 'none' }}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Activity */}
          <ActivityLog activityLog={activityLog} screensaverActive={screensaverActive} />

        </div>
      </main>

      {/* Bridge status */}
      <footer className="flex-shrink-0 px-4 py-3 sm:px-6 border-t border-border bg-card/50">
        <div className="max-w-lg mx-auto flex items-center justify-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${
            bridgeStatus.isOnline ? 'bg-primary' : 'bg-muted-foreground/50'
          }`} />
          <p className="text-xs text-muted-foreground">
            {bridgeStatus.hasActivity 
              ? `Bridge ${bridgeStatus.isOnline ? 'online' : 'offline'} · ${bridgeStatus.timeStr}`
              : 'No bridge activity'}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
