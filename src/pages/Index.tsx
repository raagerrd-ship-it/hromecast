import { ScreensaverSettings, ScreensaverConfig } from "@/components/ScreensaverSettings";
import { ChromecastSelector } from "@/components/ChromecastSelector";
import { Play, Activity, CheckCircle, XCircle, Clock, Tv, StopCircle, RotateCcw } from "lucide-react";
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
  const [lastBridgeActivity, setLastBridgeActivity] = useState<Date | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Update current time every 10 seconds for footer status
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

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
          if (data.last_idle_check) {
            setLastBridgeActivity(new Date(data.last_idle_check));
          }
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const fetchActivityLog = async () => {
      try {
        const deviceId = getOrCreateDeviceId();
        const { data, error } = await supabase
          .from('cast_commands')
          .select('*')
          .eq('device_id', deviceId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        setActivityLog(data || []);
      } catch (error) {
        console.error('Error fetching activity log:', error);
      }
    };

    loadSettings();
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
            if (payload.new.last_idle_check) {
              setLastBridgeActivity(new Date(payload.new.last_idle_check));
            }
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
                    loading="lazy"
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
                    {(() => {
                      // Group consecutive idle check logs
                      const groupedLogs: any[] = [];
                      let currentIdleGroup: any[] = [];
                      
                      const isStatusCheckLog = (log: any) => {
                        if (log.command_type !== 'bridge_log') return false;
                        try {
                          const data = JSON.parse(log.url);
                          const msg = data.message || '';
                          // Match idle checks and status messages
                          return msg.includes('Checking idle') || 
                                 msg.includes(': idle') || 
                                 msg.includes(': busy') || 
                                 msg.includes(': screensaver active');
                        } catch {
                          return false;
                        }
                      };
                      
                      activityLog.forEach((log) => {
                        if (isStatusCheckLog(log)) {
                          currentIdleGroup.push(log);
                        } else {
                          if (currentIdleGroup.length > 0) {
                            groupedLogs.push({ type: 'idle_group', logs: [...currentIdleGroup] });
                            currentIdleGroup = [];
                          }
                          groupedLogs.push({ type: 'single', log });
                        }
                      });
                      if (currentIdleGroup.length > 0) {
                        groupedLogs.push({ type: 'idle_group', logs: currentIdleGroup });
                      }
                      
                      return groupedLogs.map((item, index) => {
                        if (item.type === 'idle_group') {
                          const logs = item.logs;
                          const firstLog = logs[logs.length - 1]; // oldest (array is desc)
                          const lastLog = logs[0]; // newest
                          
                          const formatTime = (dateStr: string) => {
                            const date = new Date(dateStr);
                            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          };
                          
                          const lastTime = formatTime(lastLog.processed_at || lastLog.created_at);
                          
                          // If this group covers all 50 logs, the start time is truncated - only show latest time
                          const isFullyTruncated = logs.length >= 50;
                          let timeDisplay = lastTime;
                          if (!isFullyTruncated) {
                            const firstTime = formatTime(firstLog.processed_at || firstLog.created_at);
                            timeDisplay = firstTime === lastTime ? firstTime : `${firstTime} → ${lastTime}`;
                          }
                          
                          // Get device name and status from message
                          let deviceName = 'device';
                          let lastStatus = '';
                          try {
                            const data = JSON.parse(lastLog.url);
                            const message = data.message || '';
                            // Match "Device X: status" or "Checking idle: X (ip)"
                            const deviceMatch = message.match(/Device\s+([^:]+):\s*(.+)/) || 
                                               message.match(/Checking idle:\s*([^(]+)/);
                            if (deviceMatch) {
                              deviceName = deviceMatch[1].trim()
                                .replace(/([A-Za-z]+(?:-[A-Za-z]+)*)-[a-f0-9]{20,}/gi, (m: string, name: string) => name.replace(/-/g, ' '));
                              lastStatus = deviceMatch[2]?.trim() || '';
                            }
                          } catch {}
                          
                          const label = lastStatus ? `${deviceName}: ${lastStatus}` : `Checking ${deviceName}`;
                          
                          return (
                            <div key={`idle-group-${index}`} className="flex items-center gap-3 p-3">
                              <div className="flex-shrink-0">
                                <Activity className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {label}
                                </p>
                                <p className="text-xs text-muted-foreground">{timeDisplay}</p>
                              </div>
                              <Badge variant="outline" className="text-[10px] flex-shrink-0">
                                {logs.length}x
                              </Badge>
                            </div>
                          );
                        }
                        
                        const log = item.log;
                        
                        const getIcon = () => {
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
                          if (log.command_type === 'screensaver_start') return 'Screensaver started';
                          if (log.command_type === 'screensaver_resumed') return 'Screensaver resumed';
                          if (log.command_type === 'screensaver_stop') return 'Screensaver stopped';
                          if (log.command_type === 'bridge_start') return 'Bridge started';
                          if (log.command_type === 'bridge_stop') return 'Bridge stopped';
                          if (log.command_type === 'bridge_log') {
                            try {
                              const data = JSON.parse(log.url);
                              let message = data.message || 'Bridge log';
                              message = message.replace(/([A-Za-z]+(?:-[A-Za-z]+)*)-[a-f0-9]{20,}/gi, (match: string, name: string) => {
                                return name.replace(/-/g, ' ');
                              });
                              return message;
                            } catch {
                              return 'Bridge log';
                            }
                          }
                          if (log.command_type === 'cast') return 'Manual cast';
                          return log.command_type;
                        };

                        const getDuration = () => {
                          if (log.command_type !== 'screensaver_start' && log.command_type !== 'screensaver_resumed') return null;
                          const stopLog = activityLog.slice(0, activityLog.indexOf(log)).reverse().find(
                            (l: any) => l.command_type === 'screensaver_stop' && l.status === 'completed'
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
                      });
                    })()}
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

        </div>
      </main>

      {/* Bridge status */}
      <footer className="flex-shrink-0 px-4 py-3 sm:px-6 border-t border-border bg-card/50">
        <div className="max-w-lg mx-auto flex items-center justify-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${
            lastBridgeActivity && (currentTime - lastBridgeActivity.getTime()) < 300000
              ? 'bg-primary'
              : 'bg-muted-foreground/50'
          }`} />
          <p className="text-xs text-muted-foreground">
            {lastBridgeActivity 
              ? `Bridge ${(currentTime - lastBridgeActivity.getTime()) < 300000 ? 'online' : 'offline'} · ${lastBridgeActivity.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'No bridge connection'}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
