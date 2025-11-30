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

interface ActivityLog {
  id: string;
  timestamp: Date;
  type: 'connection' | 'cast' | 'bridge' | 'error';
  message: string;
  details?: string;
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
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  // Helper function to add activity log
  const addActivityLog = (type: ActivityLog['type'], message: string, details?: string) => {
    const newLog: ActivityLog = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      type,
      message,
      details,
    };
    setActivityLogs(prev => [newLog, ...prev].slice(0, 50)); // Keep last 50 logs
  };

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
      let deviceId = savedDeviceId;
      
      if (!deviceId) {
        // Generate a random device ID
        deviceId = `bridge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await Preferences.set({ key: 'bridge_device_id', value: deviceId });
        addActivityLog('bridge', 'Generated new bridge device ID', deviceId);
      }
      
      setBridgeDeviceId(deviceId);
      setIsBridgeConfigured(true);
      
      // Auto-start bridge service after configuration is loaded
      setTimeout(() => {
        if (deviceId) {
          setIsServiceActive(true);
          addActivityLog('bridge', 'Bridge service auto-started', `Device ID: ${deviceId}`);
        }
      }, 1500);
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
      addActivityLog('cast', 'Preparing to cast URL', url);
      
      // Call the render-website function to generate a video
      const { data: renderData, error: renderError } = await supabase.functions.invoke('render-website', {
        body: { url, action: 'video' }
      });

      if (renderError) {
        console.error("Error from render function:", renderError);
        addActivityLog('error', 'Failed to render website', renderError.message);
        toast({
          title: "Rendering Failed",
          description: renderError.message || "Failed to prepare website for casting",
          variant: "destructive",
        });
        return null;
      }

      console.log("Render response:", renderData);
      addActivityLog('cast', 'Website rendered successfully', `Viewer URL: ${renderData.viewerUrl}`);
      
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
        addActivityLog('error', 'Failed to queue cast command', queueError.message);
        toast({
          title: "Queue Failed",
          description: "Failed to queue cast command",
          variant: "destructive",
        });
        return null;
      }

      addActivityLog('cast', 'Cast queued successfully', `Command ID: ${queueData.id}`);
      toast({
        title: "Cast Queued",
        description: "Your local bridge will process this cast shortly",
      });

      console.log("Cast command queued:", queueData);
      
      // Return the cast URL for reference
      return castUrl;
      
    } catch (error) {
      console.error("Error processing website:", error);
      addActivityLog('error', 'Unexpected error occurred', String(error));
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
        
        addActivityLog('bridge', 'Processing cast command', command.url);
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

          addActivityLog('bridge', 'Cast completed successfully', command.url);
          toast({
            title: "Cast Complete",
            description: "Video is now playing",
          });

          fetchRecentCommands();
        }, 2000);
      }
    } catch (error) {
      console.error('Error processing commands:', error);
      addActivityLog('error', 'Failed to process bridge command', String(error));
    }
  };

  // Start bridge service and set up polling
  useEffect(() => {
    if (!isServiceActive || !bridgeDeviceId) return;

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

    fetchRecentCommands();

    return () => {
      if (interval) clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [isServiceActive, bridgeDeviceId]);

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
    addActivityLog('bridge', 'Bridge service started', `Device ID: ${bridgeDeviceId}`);

    toast({
      title: "Bridge Service Started",
      description: "Listening for cast commands",
    });
  };

  // Stop bridge service
  const stopBridgeService = () => {
    setIsServiceActive(false);
    addActivityLog('bridge', 'Bridge service stopped');
    
    if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }

    toast({
      title: "Bridge Service Stopped",
      description: "No longer listening for commands",
    });
  };

  // Track connection state changes
  useEffect(() => {
    if (chromecast.isConnected && chromecast.currentDevice) {
      addActivityLog('connection', 'Connected to Chromecast', chromecast.currentDevice.friendlyName);
    } else if (!chromecast.isConnected && activityLogs.length > 0 && activityLogs[0].type === 'connection') {
      addActivityLog('connection', 'Disconnected from Chromecast');
    }
  }, [chromecast.isConnected, chromecast.currentDevice]);

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

  const getLogIcon = (type: ActivityLog['type']) => {
    switch (type) {
      case 'connection':
        return <Wifi className="h-4 w-4 text-blue-500" />;
      case 'cast':
        return <Monitor className="h-4 w-4 text-green-500" />;
      case 'bridge':
        return <Smartphone className="h-4 w-4 text-purple-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getLogColor = (type: ActivityLog['type']) => {
    switch (type) {
      case 'connection':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'cast':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'bridge':
        return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
      case 'error':
        return 'bg-red-500/10 text-red-500 border-red-500/20';
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
            lastSavedDeviceName={
              !chromecast.isConnected && localStorage.getItem('chromecast-last-device')
                ? JSON.parse(localStorage.getItem('chromecast-last-device') || '{}').friendlyName
                : undefined
            }
            onReconnect={chromecast.requestSession}
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
                {isServiceActive ? (
                  <Badge className="ml-2 bg-green-500/10 text-green-500">
                    Active
                  </Badge>
                ) : (
                  <Badge className="ml-2 bg-muted text-muted-foreground">
                    Stopped
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Automatically processes cast commands from the main interface
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Device ID</p>
                  <p className="text-sm font-mono">{bridgeDeviceId}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const newId = `bridge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    setBridgeDeviceId(newId);
                    await Preferences.set({ key: 'bridge_device_id', value: newId });
                    addActivityLog('bridge', 'Generated new device ID', newId);
                    toast({
                      title: "New Device ID",
                      description: "Bridge will restart with new ID",
                    });
                  }}
                >
                  Regenerate
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

        {/* Activity Log */}
        <div className="mt-16 max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Activity Log
              </CardTitle>
              <CardDescription>
                Real-time log of connections, casts, and bridge activity
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activityLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">No activity yet</p>
                  <p className="text-xs mt-1">Connect to a Chromecast or start casting to see logs</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {activityLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border ${getLogColor(log.type)}`}
                    >
                      {getLogIcon(log.type)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{log.message}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {log.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        {log.details && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {log.details}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Index;
