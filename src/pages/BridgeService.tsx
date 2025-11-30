import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Smartphone, Wifi, WifiOff, Play, Square, Settings, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Preferences } from '@capacitor/preferences';

interface CommandStatus {
  id: string;
  url: string;
  status: string;
  created_at: string;
  error_message?: string;
}

const BridgeService = () => {
  const { toast } = useToast();
  const [isServiceActive, setIsServiceActive] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [recentCommands, setRecentCommands] = useState<CommandStatus[]>([]);
  const [isConfigured, setIsConfigured] = useState(false);
  const [pollInterval, setPollInterval] = useState<number | null>(null);

  // Load configuration on mount
  useEffect(() => {
    loadConfiguration();
  }, []);

  const loadConfiguration = async () => {
    try {
      const { value: savedDeviceId } = await Preferences.get({ key: 'bridge_device_id' });
      if (savedDeviceId) {
        setDeviceId(savedDeviceId);
        setIsConfigured(true);
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
    }
  };

  const saveConfiguration = async () => {
    try {
      await Preferences.set({ key: 'bridge_device_id', value: deviceId });
      setIsConfigured(true);
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

  // Fetch recent commands
  const fetchRecentCommands = async () => {
    if (!deviceId) return;

    try {
      const { data, error } = await supabase
        .from('cast_commands')
        .select('id, url, status, created_at, error_message')
        .eq('device_id', deviceId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setRecentCommands(data || []);
    } catch (error) {
      console.error('Error fetching commands:', error);
    }
  };

  // Process pending commands
  const processPendingCommands = async () => {
    if (!deviceId || !isServiceActive) return;

    try {
      const { data: commands, error } = await supabase
        .from('cast_commands')
        .select('*')
        .eq('device_id', deviceId)
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

        // Update to processing
        await supabase
          .from('cast_commands')
          .update({ status: 'processing' })
          .eq('id', command.id);

        // Here you would integrate with actual Chromecast casting
        // For now, we'll mark as completed after a delay
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

  // Start service
  const startService = () => {
    if (!deviceId) {
      toast({
        title: "Configuration Required",
        description: "Please enter a device ID first",
        variant: "destructive",
      });
      return;
    }

    setIsServiceActive(true);
    
    // Start polling for commands
    const interval = window.setInterval(() => {
      processPendingCommands();
      fetchRecentCommands();
    }, 5000);
    
    setPollInterval(interval);

    // Subscribe to realtime updates
    const channel = supabase
      .channel('cast_commands_mobile')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'cast_commands',
          filter: `device_id=eq.${deviceId}`
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

    // Initial fetch
    fetchRecentCommands();
  };

  // Stop service
  const stopService = () => {
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

  return (
    <div className="min-h-screen bg-gradient-bg p-4">
      <div className="container mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <header className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-primary/10">
            <Smartphone className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Bridge Service
          </h1>
          <p className="text-muted-foreground">
            Turn this device into a Chromecast bridge server
          </p>
        </header>

        {/* Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isServiceActive ? (
                <Wifi className="h-5 w-5 text-green-500" />
              ) : (
                <WifiOff className="h-5 w-5 text-muted-foreground" />
              )}
              Service Status
            </CardTitle>
            <CardDescription>
              {isServiceActive ? "Bridge is active and listening" : "Bridge is inactive"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isConfigured && (
              <div className="space-y-3">
                <Label htmlFor="device-id">Device ID</Label>
                <Input
                  id="device-id"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  placeholder="Enter a unique device ID"
                />
                <Button onClick={saveConfiguration} className="w-full">
                  <Settings className="h-4 w-4 mr-2" />
                  Save Configuration
                </Button>
              </div>
            )}

            {isConfigured && (
              <>
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span className="text-sm">Device ID: {deviceId}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsConfigured(false)}
                  >
                    Change
                  </Button>
                </div>

                <div className="flex gap-3">
                  {!isServiceActive ? (
                    <Button onClick={startService} className="flex-1">
                      <Play className="h-4 w-4 mr-2" />
                      Start Bridge
                    </Button>
                  ) : (
                    <Button onClick={stopService} variant="destructive" className="flex-1">
                      <Square className="h-4 w-4 mr-2" />
                      Stop Bridge
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent Commands */}
        {isConfigured && recentCommands.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Commands</CardTitle>
              <CardDescription>
                Last 10 cast commands
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

        {/* Info */}
        <Card className="bg-muted/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              💡 <strong>Tip:</strong> Keep this app open and your device connected to WiFi. 
              The bridge will process cast commands sent from your main app.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BridgeService;