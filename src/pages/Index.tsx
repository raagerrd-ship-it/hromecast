import { CastInterface } from "@/components/CastInterface";
import { ScreensaverSettings, ScreensaverConfig } from "@/components/ScreensaverSettings";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useScreensaver } from "@/hooks/useScreensaver";
import { useChromecast } from "@/hooks/useChromecast";
import { Monitor, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const SCREENSAVER_CONFIG_KEY = "chromecast-screensaver-config";
const DEVICE_ID_KEY = "chromecast-device-id";

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
        <header className="text-center mb-12 space-y-4 relative">
          <div className="absolute top-0 right-0">
            <Button asChild variant="outline" size="sm">
              <Link to="/bridge" className="flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                Bridge Service
              </Link>
            </Button>
          </div>
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
