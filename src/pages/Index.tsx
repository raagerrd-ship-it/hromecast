import { ScreensaverSettings, ScreensaverConfig } from "@/components/ScreensaverSettings";
import { ChromecastSelector } from "@/components/ChromecastSelector";
import { Monitor, Play, Activity, CheckCircle, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
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

        // Check if screensaver is currently active
        const activeCommand = data?.find(
          (cmd) => cmd.status === 'processed' && cmd.command_type === 'cast'
        );
        setScreensaverActive(!!activeCommand);
      } catch (error) {
        console.error('Error fetching activity log:', error);
      }
    };

    fetchActivityLog();

    // Subscribe to realtime updates
    const channel = supabase
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

    return () => {
      supabase.removeChannel(channel);
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
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <header className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-primary/10 mb-4">
            <Monitor className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-5xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            ChromeCast Screensaver
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Automatically cast content to your Chromecast when idle. Configure your screensaver settings below.
          </p>
          <div className="inline-block px-4 py-2 bg-blue-500/10 text-blue-500 rounded-lg border border-blue-500/20">
            <p className="text-sm font-medium">
              💡 Make sure your Bridge Service is running on your local network
            </p>
          </div>
        </header>

        {/* Main Interface */}
        <main className="space-y-6 max-w-3xl mx-auto">
          <ChromecastSelector
            deviceId={getOrCreateDeviceId()}
            selectedChromecastId={selectedChromecastId}
            onChromecastSelected={setSelectedChromecastId}
          />
          
          <ScreensaverSettings
            currentSettings={screensaverConfig}
            onSave={setScreensaverConfig}
          />

          {/* Cast Preview */}
          {screensaverConfig.enabled && screensaverConfig.url && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Monitor className="h-5 w-5" />
                  Cast Preview
                </CardTitle>
                <CardDescription>
                  Live preview of what will be cast to your Chromecast
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden border">
                  <iframe
                    src={screensaverConfig.url}
                    className="w-full h-full"
                    title="Cast Preview"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    style={{
                      border: 'none',
                      transform: 'scale(1)',
                      transformOrigin: 'top left'
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Preview format: 16:9 (1920×1080 TV format)
                </p>
                
                <div className="flex justify-center">
                  <Button 
                    onClick={() => handleStartScreensaver(screensaverConfig.url!)}
                    className="gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Test Cast Now
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Activity Log */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Activity Log
                  </CardTitle>
                  <CardDescription>
                    Recent cast commands and screensaver status
                  </CardDescription>
                </div>
                {screensaverActive && (
                  <Badge variant="default" className="gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Screensaver Active
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                {activityLog.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No activity yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activityLog.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30"
                      >
                        <div className="mt-0.5">
                          {log.status === 'processed' ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : log.status === 'failed' ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <Clock className="h-4 w-4 text-yellow-500" />
                          )}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium capitalize">
                              {log.command_type}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {log.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {log.url}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(log.created_at).toLocaleString()}
                          </p>
                          {log.error_message && (
                            <p className="text-xs text-red-500">{log.error_message}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default Index;
