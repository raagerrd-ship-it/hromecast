import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export function useDownloadBridge() {
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  const downloadBridge = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-bridge`);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chromecast-bridge.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Nedladdning startad",
        description: "Packa upp filen och följ instruktionerna.",
      });
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: "Nedladdning misslyckades",
        description: "Försök igen eller kontrollera anslutningen.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return { downloadBridge, isDownloading };
}
