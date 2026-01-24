import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DiscoveredChromecast {
  id: string;
  chromecast_name: string;
  chromecast_host: string;
  chromecast_port: number;
  last_seen: string;
}

export function useChromecasts(deviceId: string) {
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
    
    // Wait for discovery to complete (mDNS takes ~8 seconds)
    setTimeout(async () => {
      await fetchChromecasts();
      setIsRefreshing(false);
    }, 10000);
  }, [fetchChromecasts, deviceId]);

  return {
    chromecasts,
    isRefreshing,
    handleRefresh,
  };
}
