import { useState, useEffect, useCallback, memo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tv, RefreshCw, Wifi, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface DiscoveredChromecast {
  id: string;
  chromecast_name: string;
  chromecast_host: string;
  chromecast_port: number;
  last_seen: string;
}

interface ChromecastSelectorProps {
  deviceId: string;
  selectedChromecastId?: string | null;
  onChromecastSelected: (chromecastId: string | null) => void;
}

// Shorten device names by removing the hash suffix
const shortenName = (name: string) => {
  const withoutHash = name.replace(/-[a-f0-9]{20,}$/i, '');
  return withoutHash.replace(/-/g, ' ');
};

export const ChromecastSelector = memo(({ 
  deviceId, 
  selectedChromecastId,
  onChromecastSelected 
}: ChromecastSelectorProps) => {
  const [chromecasts, setChromecasts] = useState<DiscoveredChromecast[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchChromecasts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('discovered_chromecasts')
        .select('*')
        .eq('device_id', deviceId)
        .order('last_seen', { ascending: false });

      if (error) throw error;
      setChromecasts(data || []);
    } catch (error) {
      console.error('Error fetching chromecasts:', error);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchChromecasts();

    const channel = supabase
      .channel('chromecasts_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'discovered_chromecasts',
          filter: `device_id=eq.${deviceId}`
        },
        () => {
          fetchChromecasts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId, fetchChromecasts]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    
    // Send force_discovery command to bridge
    try {
      await supabase.from('cast_commands').insert({
        device_id: deviceId,
        command_type: 'force_discovery',
        url: 'discovery',
        status: 'pending'
      });
      console.log('🔍 Force discovery command sent');
    } catch (error) {
      console.error('Error sending discovery command:', error);
    }
    
    // Wait for discovery to complete (mDNS takes ~8 seconds), then refresh
    setTimeout(async () => {
      await fetchChromecasts();
      setIsRefreshing(false);
    }, 10000);
  }, [fetchChromecasts, deviceId]);

  const handleValueChange = useCallback((value: string) => {
    onChromecastSelected(value === "auto" ? null : value);
  }, [onChromecastSelected]);

  const selectedDevice = chromecasts.find(c => c.id === selectedChromecastId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tv className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Device</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="h-8 gap-2 text-xs"
        >
          {isRefreshing ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Scanning...</span>
            </>
          ) : (
            <>
              <Search className="h-3.5 w-3.5" />
              <span>Scan network</span>
            </>
          )}
        </Button>
      </div>

      {/* Scanning indicator */}
      {isRefreshing && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Wifi className="h-4 w-4 text-primary" />
            </div>
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-primary">Scanning network...</p>
            <p className="text-xs text-muted-foreground">Looking for Chromecast devices</p>
          </div>
        </div>
      )}

      {chromecasts.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 border border-border">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Wifi className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No devices found</p>
            <p className="text-xs text-muted-foreground">Start bridge service to scan</p>
          </div>
        </div>
      ) : (
        <Select
          value={selectedChromecastId || "auto"}
          onValueChange={handleValueChange}
        >
          <SelectTrigger className="h-14 rounded-xl bg-secondary/50 border-border">
            <SelectValue>
              {selectedDevice ? (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <Tv className="h-4 w-4 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium">{shortenName(selectedDevice.chromecast_name)}</p>
                    <p className="text-xs text-muted-foreground">{selectedDevice.chromecast_host}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <Tv className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm text-muted-foreground">Auto-select device</span>
                </div>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="auto" className="rounded-lg">
              <span className="text-muted-foreground">Auto-select first device</span>
            </SelectItem>
            {chromecasts.map((chromecast) => (
              <SelectItem key={chromecast.id} value={chromecast.id} className="rounded-lg">
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-2">
                    <span>{shortenName(chromecast.chromecast_name)}</span>
                    {chromecast.id === selectedChromecastId && (
                      <Badge variant="secondary" className="text-[10px] px-1.5">Active</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{chromecast.chromecast_host}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
});

ChromecastSelector.displayName = 'ChromecastSelector';
