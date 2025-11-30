import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Wifi, Cast, Play, Pause, Square, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CastInterfaceProps {
  onCast: (url: string) => void;
}

export const CastInterface = ({ onCast }: CastInterfaceProps) => {
  const [url, setUrl] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleConnect = () => {
    setIsLoading(true);
    // Simulate Chromecast connection
    setTimeout(() => {
      setIsConnected(true);
      setIsLoading(false);
      toast({
        title: "Connected",
        description: "Successfully connected to Chromecast device",
      });
    }, 1500);
  };

  const handleCast = () => {
    if (!url) {
      toast({
        title: "URL Required",
        description: "Please enter a website URL to cast",
        variant: "destructive",
      });
      return;
    }
    setIsCasting(true);
    onCast(url);
    toast({
      title: "Casting Started",
      description: `Now casting ${url}`,
    });
  };

  const handleStop = () => {
    setIsCasting(false);
    toast({
      title: "Casting Stopped",
      description: "Playback has been stopped",
    });
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Connection Status */}
      <Card className="p-6 border-border/50 backdrop-blur-sm bg-card/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isConnected ? 'bg-primary/20' : 'bg-muted'}`}>
              <Wifi className={`h-5 w-5 ${isConnected ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <h3 className="font-semibold">Chromecast Status</h3>
              <p className="text-sm text-muted-foreground">
                {isConnected ? "Connected to Living Room TV" : "Not Connected"}
              </p>
            </div>
          </div>
          <Button
            onClick={handleConnect}
            disabled={isConnected || isLoading}
            variant="outline"
            size="sm"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting
              </>
            ) : isConnected ? (
              "Connected"
            ) : (
              "Connect"
            )}
          </Button>
        </div>
      </Card>

      {/* URL Input */}
      <Card className="p-6 border-border/50 backdrop-blur-sm bg-card/80">
        <div className="space-y-4">
          <div>
            <label htmlFor="url" className="text-sm font-medium mb-2 block">
              Website URL
            </label>
            <Input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={!isConnected || isCasting}
              className="bg-background/50 border-border/50 focus:border-primary"
            />
          </div>
          <Button
            onClick={handleCast}
            disabled={!isConnected || isCasting}
            variant="cast"
            size="lg"
            className="w-full"
          >
            <Cast className="h-5 w-5" />
            Start Casting
          </Button>
        </div>
      </Card>

      {/* Playback Controls */}
      {isCasting && (
        <Card className="p-6 border-border/50 backdrop-blur-sm bg-card/80 animate-in fade-in slide-in-from-bottom-4">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <p className="text-sm font-medium">Now Casting</p>
            </div>
            <p className="text-sm text-muted-foreground truncate">{url}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="icon">
                <Play className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon">
                <Pause className="h-4 w-4" />
              </Button>
              <Button variant="destructive" size="icon" onClick={handleStop}>
                <Square className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
