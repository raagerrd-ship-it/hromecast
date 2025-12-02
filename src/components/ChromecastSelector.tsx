import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tv, RefreshCw, Wifi } from "lucide-react";
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

export const ChromecastSelector = ({ 
  deviceId, 
  selectedChromecastId,
  onChromecastSelected 
}: ChromecastSelectorProps) => {
  const [chromecasts, setChromecasts] = useState<DiscoveredChromecast[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchChromecasts = async () => {
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
  };

  useEffect(() => {
    fetchChromecasts();

    const channel = supabase
      .channel('discovered_chromecasts_changes')
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
  }, [deviceId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchChromecasts();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const selectedDevice = chromecasts.find(c => c.id === selectedChromecastId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tv className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Device</span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 -m-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

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
          onValueChange={(value) => onChromecastSelected(value === "auto" ? null : value)}
        >
          <SelectTrigger className="h-14 rounded-xl bg-secondary/50 border-border">
            <SelectValue>
              {selectedDevice ? (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <Tv className="h-4 w-4 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium">{selectedDevice.chromecast_name}</p>
                    <p className="text-xs text-muted-foreground">Connected</p>
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
                <div className="flex items-center gap-2">
                  <span>{chromecast.chromecast_name}</span>
                  {chromecast.id === selectedChromecastId && (
                    <Badge variant="secondary" className="text-[10px] px-1.5">Active</Badge>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
};
