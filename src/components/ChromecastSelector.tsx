import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Monitor, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

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

    // Subscribe to realtime updates
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

  const formatLastSeen = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Chromecast Device
            </CardTitle>
            <CardDescription>
              Select which Chromecast to use for casting
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {chromecasts.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Monitor className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No Chromecasts discovered yet</p>
            <p className="text-xs mt-1">
              Start your bridge service to scan for devices
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="chromecast-select" className="text-sm font-medium mb-2 block">
                Available Devices ({chromecasts.length})
              </Label>
              <Select
                value={selectedChromecastId || "none"}
                onValueChange={(value) => onChromecastSelected(value === "none" ? null : value)}
              >
                <SelectTrigger id="chromecast-select" className="w-full">
                  <SelectValue placeholder="Select a Chromecast" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">Auto-select first device</span>
                  </SelectItem>
                  {chromecasts.map((chromecast) => (
                    <SelectItem key={chromecast.id} value={chromecast.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{chromecast.chromecast_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {chromecast.chromecast_host}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Selected Device Display */}
            {selectedChromecastId && (
              <div className="mt-4">
                {chromecasts
                  .filter((chromecast) => chromecast.id === selectedChromecastId)
                  .map((chromecast) => (
                    <div
                      key={chromecast.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-primary bg-primary/5"
                    >
                      <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="text-sm font-medium truncate flex-1">{chromecast.chromecast_name}</p>
                      <Badge variant="default" className="text-xs shrink-0">
                        Active
                      </Badge>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
