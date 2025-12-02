import { ScreensaverSettings, ScreensaverConfig } from "@/components/ScreensaverSettings";
import { ChromecastSelector } from "@/components/ChromecastSelector";
import { Monitor, Play, Activity, CheckCircle, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

  // Calculate preview scale based on container width
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

  // Load settings from database on mount
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
          // Fall back to localStorage
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

    // Fetch activity log
    const fetchActivityLog = async () => {
      try {
        const deviceId = getOrCreateDeviceId();
        const { data, error } = await supabase
          .from('cast_commands')
          .select('*')
          .eq('device_id', deviceId)
          .order('created_at', { ascending: false })
          .limit(20);

        if (error) throw error;
        setActivityLog(data || []);
      } catch (error) {
        console.error('Error fetching activity log:', error);
      }
    };

    fetchActivityLog();

    // Subscribe to realtime updates for activity log
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

    // Subscribe to screensaver status changes
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
          console.log('Screensaver status update:', payload);
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

  // Save settings to database when changed
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
          // Also save to localStorage as backup
          localStorage.setItem(SCREENSAVER_CONFIG_KEY, JSON.stringify(screensaverConfig));
        }
      } catch (error) {
        console.error('Error saving settings:', error);
      }
    };

    saveSettings();
  }, [screensaverConfig, selectedChromecastId, isLoading]);

  const handleCast = async (url: string) => {
    try {
      console.log("Processing URL for casting:", url);
      
      // Call the render-website function to generate viewer URL
      const { data: renderData, error: renderError } = await supabase.functions.invoke('render-website', {
        body: { url, action: 'video' }
      });

      if (renderError) {
        console.error("Error from render function:", renderError);
        toast({
          title: "Rendering Failed",
          description: renderError.message || "Failed to prepare website for casting",
          variant: "destructive",
        });
        return null;
      }

      console.log("Render response:", renderData);
      
      // Queue cast command for bridge service
      const deviceId = getOrCreateDeviceId();
      const castUrl = renderData.videoUrl || renderData.viewerUrl;
      const { data: queueData, error: queueError } = await supabase.functions.invoke('queue-cast', {
        body: { 
          deviceId,
          url: castUrl,
          commandType: 'cast'
        }
      });

      if (queueError) {
        console.error("Error queueing cast command:", queueError);
        toast({
          title: "Queue Failed",
          description: "Failed to queue cast command",
          variant: "destructive",
        });
        return null;
      }

      toast({
        title: "Cast Queued",
        description: "Your local bridge will process this cast shortly",
      });

      console.log("Cast command queued:", queueData);
      
      // Return the cast URL for reference
      return castUrl;
      
    } catch (error) {
      console.error("Error processing website:", error);
      toast({
        title: "Processing Failed",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
      return null;
    }
  };

  const handleStartScreensaver = async (url: string) => {
    console.log("Starting screensaver with URL:", url);
    
    try {
      // First, render the website to get the viewer URL (wraps in iframe for Chromecast)
      const { data: renderData, error: renderError } = await supabase.functions.invoke('render-website', {
        body: { url, action: 'cast' }
      });

      if (renderError) {
        console.error("Error rendering screensaver:", renderError);
        toast({
          title: "Screensaver Failed",
          description: renderError.message || "Failed to prepare screensaver",
          variant: "destructive",
        });
        return;
      }

      console.log("Screensaver render response:", renderData);
      const viewerUrl = renderData.viewerUrl;
      
      // Queue the viewer URL (not the raw URL) for bridge service
      const deviceId = getOrCreateDeviceId();
      const { data: queueData, error: queueError } = await supabase.functions.invoke('queue-cast', {
        body: { 
          deviceId,
          url: viewerUrl, // Use viewer URL that wraps in iframe
          commandType: 'cast'
        }
      });

      if (queueError) {
        console.error("Error queueing screensaver command:", queueError);
        toast({
          title: "Screensaver Failed",
          description: "Failed to queue screensaver cast",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Screensaver Started",
        description: "Bridge will cast to Chromecast",
      });
    } catch (error) {
      console.error("Error processing screensaver:", error);
      toast({
        title: "Screensaver Failed",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-bg">
      <div className="container mx-auto px-4 py-8 md:py-12">
        {/* Header */}
        <header className="text-center mb-10 space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 shadow-lg shadow-primary/10 mb-2">
            <Monitor className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-primary bg-clip-text text-transparent tracking-tight">
            ChromeCast Screensaver
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Automatically cast content to your Chromecast when idle
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/5 text-primary/80 rounded-full text-sm border border-primary/10">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Bridge Service Required
          </div>
        </header>

        {/* Main Grid Layout */}
        <main className="max-w-5xl mx-auto">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left Column - Settings */}
            <div className="space-y-6">
              <ChromecastSelector
                deviceId={getOrCreateDeviceId()}
                selectedChromecastId={selectedChromecastId}
                onChromecastSelected={setSelectedChromecastId}
              />
              
              <ScreensaverSettings
                currentSettings={screensaverConfig}
                onSave={setScreensaverConfig}
              />
            </div>

            {/* Right Column - Preview & Activity */}
            <div className="space-y-6">
              {/* Cast Preview */}
              {screensaverConfig.enabled && screensaverConfig.url && (
                <Card className="overflow-hidden border-primary/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Monitor className="h-4 w-4 text-primary" />
                      Live Preview
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Exact TV output (1920×1080)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div 
                      ref={previewContainerRef}
                      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden ring-1 ring-border shadow-inner"
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
                          title="Cast Preview"
                          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          style={{ border: 'none' }}
                        />
                      </div>
                    </div>
                    
                    <Button 
                      onClick={() => handleStartScreensaver(screensaverConfig.url!)}
                      className="w-full gap-2"
                      size="sm"
                    >
                      <Play className="h-4 w-4" />
                      Test Cast Now
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Activity Log */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Activity className="h-4 w-4 text-primary" />
                        Activity Log
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Recent commands
                      </CardDescription>
                    </div>
                    {screensaverActive && (
                      <Badge className="gap-1 bg-green-500/10 text-green-500 border-green-500/20">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                        </span>
                        Active
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="h-72">
                    {activityLog.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <Activity className="h-10 w-10 mb-2 opacity-20" />
                        <p className="text-sm">No activity yet</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {activityLog.map((log) => (
                          <div
                            key={log.id}
                            className="flex items-start gap-2.5 p-2.5 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors"
                          >
                            <div className="mt-0.5">
                              {log.status === 'processed' ? (
                                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                              ) : log.status === 'failed' ? (
                                <XCircle className="h-3.5 w-3.5 text-red-500" />
                              ) : (
                                <Clock className="h-3.5 w-3.5 text-yellow-500" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium capitalize">
                                  {log.command_type}
                                </span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  {log.status}
                                </Badge>
                              </div>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {log.url}
                              </p>
                              <p className="text-[10px] text-muted-foreground/60">
                                {new Date(log.created_at).toLocaleString()}
                              </p>
                              {log.error_message && (
                                <p className="text-[10px] text-red-400">{log.error_message}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Index;
