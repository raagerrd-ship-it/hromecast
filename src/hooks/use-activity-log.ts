import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ActivityLogEntry {
  id: string;
  device_id: string;
  command_type: string;
  url: string;
  status: string;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

export function useActivityLog(deviceId: string) {
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);

  const fetchActivityLog = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('cast_commands')
        .select('*')
        .eq('device_id', deviceId)
        .order('processed_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setActivityLog(data || []);
    } catch (error) {
      console.error('Error fetching activity log:', error);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchActivityLog();

    // Realtime subscription
    const channel = supabase
      .channel('activity_log_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cast_commands'
        },
        (payload) => {
          if (payload.new && (payload.new as any).device_id === deviceId) {
            console.log('🔔 Realtime event:', payload.eventType);
            fetchActivityLog();
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Activity log subscription:', status);
      });

    // Backup polling every 15 seconds
    const pollInterval = setInterval(() => {
      console.log('⏰ Polling activity log...');
      fetchActivityLog();
    }, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [deviceId, fetchActivityLog]);

  return { activityLog, refetch: fetchActivityLog };
}
