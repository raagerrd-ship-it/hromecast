import { CastInterface } from "@/components/CastInterface";
import { ScreensaverSettings, ScreensaverConfig } from "@/components/ScreensaverSettings";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useScreensaver } from "@/hooks/useScreensaver";
import { useChromecast } from "@/hooks/useChromecast";
import { Monitor, Smartphone, Wifi, WifiOff, Play, Square, Settings, CheckCircle2, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Preferences } from '@capacitor/preferences';

const SCREENSAVER_CONFIG_KEY = "chromecast-screensaver-config";
const DEVICE_ID_KEY = "chromecast-device-id";

interface CommandStatus {
  id: string;
  url: string;
  status: string;
  created_at: string;
  error_message?: string;
}

const getOrCreateDeviceId = () => {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
};

const Index = () => {
  const { toast } = useToast();
  const chromecast = useChromecast();
  const [isLoading, setIsLoading] = useState(true);
  
  const [screensaverConfig, setScreensaverConfig] = useState<ScreensaverConfig>({
    enabled: false,
    url: "",
    idleTimeout: 5,
    checkInterval: 10,
  });

  // Bridge Service State
  const [isServiceActive, setIsServiceActive] = useState(false);
  const [bridgeDeviceId, setBridgeDeviceId] = useState("");
  const [recentCommands, setRecentCommands] = useState<CommandStatus[]>([]);
  const [isBridgeConfigured, setIsBridgeConfigured] = useState(false);
  const [pollInterval, setPollInterval] = useState<number | null>(null);

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
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
    loadBridgeConfiguration();
  }, []);

  // Load bridge configuration
  const loadBridgeConfiguration = async () => {
    try {
      const { value: savedDeviceId } = await Preferences.get({ key: 'bridge_device_id' });
      if (savedDeviceId) {
        setBridgeDeviceId(savedDeviceId);
        setIsBridgeConfigured(true);
      }
    } catch (error) {
      console.error('Error loading bridge configuration:', error);
    }
  };

  const saveBridgeConfiguration = async () => {
    try {
      await Preferences.set({ key: 'bridge_device_id', value: bridgeDeviceId });
      setIsBridgeConfigured(true);
      toast({
        title: "Configuration Saved",
        description: "Bridge settings have been saved",
      });
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast({
        title: "Save Failed",
        description: "Failed to save configuration",
        variant: "destructive",
      });
    }
  };

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
  }, [screensaverConfig, isLoading]);

  const handleCast = async (url: string) => {
    try {
      console.log("Processing URL for casting:", url);
      
      // Call the render-website function to generate a video
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
    
    // Queue screensaver cast through bridge service (same as regular casts)
    await handleCast(url);
  };

  // Fetch recent commands for bridge
  const fetchRecentCommands = async () => {
    if (!bridgeDeviceId) return;

    try {
      const { data, error } = await supabase
        .from('cast_commands')
        .select('id, url, status, created_at, error_message')
        .eq('device_id', bridgeDeviceId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setRecentCommands(data || []);
    } catch (error) {
      console.error('Error fetching commands:', error);
    }
  };

  // Process pending commands for bridge
  const processPendingCommands = async () => {
    if (!bridgeDeviceId || !isServiceActive) return;

    try {
      const { data: commands, error } = await supabase
        .from('cast_commands')
        .select('*')
        .eq('device_id', bridgeDeviceId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;

      if (commands && commands.length > 0) {
        const command = commands[0];
        
        toast({
          title: "Processing Cast",
          description: `Casting: ${command.url.substring(0, 50)}...`,
        });

        await supabase
          .from('cast_commands')
          .update({ status: 'processing' })
          .eq('id', command.id);

        setTimeout(async () => {
          await supabase
            .from('cast_commands')
            .update({ 
              status: 'completed',
              processed_at: new Date().toISOString()
            })
            .eq('id', command.id);

          toast({
            title: "Cast Complete",
            description: "Video is now playing",
          });

          fetchRecentCommands();
        }, 2000);
      }
    } catch (error) {
      console.error('Error processing commands:', error);
    }
  };

  // Start bridge service
  const startBridgeService = () => {
    if (!bridgeDeviceId) {
      toast({
        title: "Configuration Required",
        description: "Please enter a device ID first",
        variant: "destructive",
      });
      return;
    }

    setIsServiceActive(true);
    
    const interval = window.setInterval(() => {
      processPendingCommands();
      fetchRecentCommands();
    }, 5000);
    
    setPollInterval(interval);

    const channel = supabase
      .channel('cast_commands_mobile')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'cast_commands',
          filter: `device_id=eq.${bridgeDeviceId}`
        },
        () => {
          processPendingCommands();
          fetchRecentCommands();
        }
      )
      .subscribe();

    toast({
      title: "Bridge Service Started",
      description: "Listening for cast commands",
    });

    fetchRecentCommands();
  };

  // Stop bridge service
  const stopBridgeService = () => {
    setIsServiceActive(false);
    
    if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }

    toast({
      title: "Bridge Service Stopped",
      description: "No longer listening for commands",
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'processing':
        return <Clock className="h-4 w-4 text-blue-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/10 text-green-500';
      case 'failed':
        return 'bg-red-500/10 text-red-500';
      case 'processing':
        return 'bg-blue-500/10 text-blue-500';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const screensaverStatus = useScreensaver({
    isConnected: chromecast.isConnected,
    isCasting: chromecast.isCasting,
    lastActivityTime: chromecast.lastActivityTime,
    screensaverConfig,
    onStartScreensaver: handleStartScreensaver,
  });

  // Force re-render every second to update idle time display
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!chromecast.isConnected || !screensaverConfig.enabled) {
      return;
    }

    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [chromecast.isConnected, screensaverConfig.enabled]);

  return (
    <div className="min-h-screen bg-gradient-bg">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <header className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-primary/10 mb-4">
            <Monitor className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-5xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            ChromeCast Portal
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Cast any website to your Chromecast from a remote server. Enter a URL and stream it directly to your TV.
          </p>
        </header>

        {/* Main Interface */}
        <main className="space-y-6">
          <ConnectionStatus 
            isConnected={chromecast.isConnected}
            deviceName={chromecast.currentDevice?.friendlyName}
            hasAutoConnect={chromecast.isAvailable && !chromecast.isConnected}
            screensaverEnabled={screensaverConfig.enabled}
            idleTimeSeconds={screensaverStatus.idleTimeSeconds}
            timeUntilScreensaverSeconds={screensaverStatus.timeUntilScreensaverSeconds}
            checkIntervalSeconds={screensaverStatus.checkIntervalSeconds}
          />
          
          <CastInterface onCast={handleCast} chromecast={chromecast} />
          
          <ScreensaverSettings
            currentSettings={screensaverConfig}
            onSave={setScreensaverConfig}
          />

          {/* Bridge Service Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                Bridge Service
                {isServiceActive && (
                  <Badge className="ml-2 bg-green-500/10 text-green-500">
                    Active
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Turn this device into a local bridge server for Chromecast control
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isBridgeConfigured && (
                <div className="space-y-3">
                  <Label htmlFor="bridge-device-id">Bridge Device ID</Label>
                  <Input
                    id="bridge-device-id"
                    value={bridgeDeviceId}
                    onChange={(e) => setBridgeDeviceId(e.target.value)}
                    placeholder="Enter a unique device ID"
                  />
                  <Button onClick={saveBridgeConfiguration} className="w-full">
                    <Settings className="h-4 w-4 mr-2" />
                    Save Configuration
                  </Button>
                </div>
              )}

              {isBridgeConfigured && (
                <>
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <span className="text-sm">Device ID: {bridgeDeviceId}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsBridgeConfigured(false)}
                    >
                      Change
                    </Button>
                  </div>

                  <div className="flex gap-3">
                    {!isServiceActive ? (
                      <Button onClick={startBridgeService} className="flex-1">
                        <Play className="h-4 w-4 mr-2" />
                        Start Bridge
                      </Button>
                    ) : (
                      <Button onClick={stopBridgeService} variant="destructive" className="flex-1">
                        <Square className="h-4 w-4 mr-2" />
                        Stop Bridge
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Recent Commands Log */}
          {isBridgeConfigured && recentCommands.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Command Log</CardTitle>
                <CardDescription>
                  Recent cast commands processed by this bridge
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recentCommands.map((command) => (
                    <div
                      key={command.id}
                      className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
                    >
                      {getStatusIcon(command.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {command.url}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(command.created_at).toLocaleTimeString()}
                        </p>
                        {command.error_message && (
                          <p className="text-xs text-red-500 mt-1">
                            {command.error_message}
                          </p>
                        )}
                      </div>
                      <Badge className={getStatusColor(command.status)}>
                        {command.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </main>

        {/* Info Cards */}
        <div className="mt-16 grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <div className="p-6 rounded-lg bg-card/50 border border-border/50 backdrop-blur-sm">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center mb-4">
              <span className="text-primary font-bold">1</span>
            </div>
            <h3 className="font-semibold mb-2">Connect Device</h3>
            <p className="text-sm text-muted-foreground">
              Connect to your Chromecast device on the same network
            </p>
          </div>
          <div className="p-6 rounded-lg bg-card/50 border border-border/50 backdrop-blur-sm">
            <div className="h-10 w-10 rounded-lg bg-secondary/20 flex items-center justify-center mb-4">
              <span className="text-secondary font-bold">2</span>
            </div>
            <h3 className="font-semibold mb-2">Enter URL</h3>
            <p className="text-sm text-muted-foreground">
              Paste the website URL you want to cast
            </p>
          </div>
          <div className="p-6 rounded-lg bg-card/50 border border-border/50 backdrop-blur-sm">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center mb-4">
              <span className="text-primary font-bold">3</span>
            </div>
            <h3 className="font-semibold mb-2">Start Casting</h3>
            <p className="text-sm text-muted-foreground">
              Watch the website render in real-time on your TV
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
