import { ScreensaverSettings, ScreensaverConfig } from "@/components/ScreensaverSettings";
import { ChromecastSelector } from "@/components/ChromecastSelector";
import { Play, Activity, CheckCircle, XCircle, Clock, Tv, StopCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

const SCREENSAVER_CONFIG_KEY = "chromecast-screensaver-config";
const DEVICE_ID_KEY = "chromecast-device-id";

const getOrCreateDeviceId = () => {
  const deviceId = "device-1764517968693-qxx7xr08y";
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
};

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
  const previewContainerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const deviceId = getOrCreateDeviceId();
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
      }
    };

    loadSettings();

    const fetchActivityLog = async () => {
      try {
        const deviceId = getOrCreateDeviceId();
        const { data, error } = await supabase
          .from('cast_commands')
          .select('*')
          .eq('device_id', deviceId)
          .order('created_at', { ascending: false })
          .limit(10);

        if (error) throw error;
        setActivityLog(data || []);
      } catch (error) {
        console.error('Error fetching activity log:', error);
      }
    };

    fetchActivityLog();

    const activityChannel = supabase
      .channel('cast_commands_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cast_commands',
          filter: `device_id=eq.${getOrCreateDeviceId()}`
        },
        () => {
          fetchActivityLog();
        }
      )
      .subscribe();

    const statusChannel = supabase
      .channel('screensaver_status_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'screensaver_settings',
          filter: `device_id=eq.${getOrCreateDeviceId()}`
        },
        (payload) => {
          if (payload.new) {
            setScreensaverActive(payload.new.screensaver_active || false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(activityChannel);
      supabase.removeChannel(statusChannel);
    };
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const saveSettings = async () => {
      try {
        const deviceId = getOrCreateDeviceId();
        const { error } = await supabase
          .from('screensaver_settings')
          .upsert({
            device_id: deviceId,
            enabled: screensaverConfig.enabled,
            url: screensaverConfig.url,
            idle_timeout: screensaverConfig.idleTimeout,
            check_interval: screensaverConfig.checkInterval,
            selected_chromecast_id: selectedChromecastId,
          }, {
            onConflict: 'device_id'
          });

        if (error) {
          console.error('Error saving settings:', error);
        } else {
          localStorage.setItem(SCREENSAVER_CONFIG_KEY, JSON.stringify(screensaverConfig));
        }
      } catch (error) {
        console.error('Error saving settings:', error);
      }
    };

    saveSettings();
  }, [screensaverConfig, selectedChromecastId, isLoading]);

  const handleStartScreensaver = async (url: string) => {
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
      const deviceId = getOrCreateDeviceId();
      
      const { error: queueError } = await supabase.functions.invoke('queue-cast', {
        body: { 
          deviceId,
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
  };

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
              deviceId={getOrCreateDeviceId()}
              selectedChromecastId={selectedChromecastId}
              onChromecastSelected={setSelectedChromecastId}
            />
          </section>

          {/* Settings */}
          <section>
            <ScreensaverSettings
              currentSettings={screensaverConfig}
              onSave={setScreensaverConfig}
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
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                    style={{ border: 'none' }}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Activity */}
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
                    {activityLog.map((log, index) => {
                      const getIcon = () => {
                        if (log.command_type === 'screensaver_start') {
                          return log.status === 'failed' 
                            ? <XCircle className="h-4 w-4 text-destructive" />
                            : <Play className="h-4 w-4 text-primary" />;
                        }
                        if (log.command_type === 'screensaver_stop') {
                          return <StopCircle className="h-4 w-4 text-orange-500" />;
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
                        if (log.command_type === 'screensaver_start') return 'Screensaver started';
                        if (log.command_type === 'screensaver_stop') return 'Screensaver stopped';
                        if (log.command_type === 'cast') return 'Manual cast';
                        return log.command_type;
                      };

                      // Calculate duration for stop events
                      const getDuration = () => {
                        if (log.command_type !== 'screensaver_stop') return null;
                        // Find the most recent start before this stop
                        const startLog = activityLog.slice(index + 1).find(
                          l => l.command_type === 'screensaver_start' && l.status === 'completed'
                        );
                        if (!startLog) return null;
                        const startTime = new Date(startLog.created_at).getTime();
                        const stopTime = new Date(log.created_at).getTime();
                        const durationMs = stopTime - startTime;
                        const minutes = Math.floor(durationMs / 60000);
                        const hours = Math.floor(minutes / 60);
                        if (hours > 0) return `${hours}h ${minutes % 60}m`;
                        return `${minutes}m`;
                      };

                      const duration = getDuration();

                      return (
                        <div key={log.id} className="flex items-center gap-3 p-3">
                          <div className="flex-shrink-0">
                            {getIcon()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {getLabel()}
                              {duration && <span className="text-muted-foreground font-normal ml-1">({duration})</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {(() => {
                                const date = new Date(log.created_at);
                                const today = new Date();
                                const isToday = date.toDateString() === today.toDateString();
                                return isToday 
                                  ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                  : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                              })()}
                            </p>
                          </div>
                          <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${
                            log.status === 'failed' ? 'border-destructive/50 text-destructive' : ''
                          }`}>
                            {log.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          </section>

        </div>
      </main>

      {/* Bridge reminder */}
      <footer className="flex-shrink-0 px-4 py-3 sm:px-6 border-t border-border bg-card/50">
        <div className="max-w-lg mx-auto">
          <p className="text-xs text-center text-muted-foreground">
            Bridge service must be running on your network
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
