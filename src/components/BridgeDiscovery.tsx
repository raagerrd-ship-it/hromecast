import { memo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ExternalLink, 
  RefreshCw, 
  Plus, 
  Trash2, 
  Wifi, 
  WifiOff,
  Search,
  Server,
  AlertTriangle
} from "lucide-react";
import { useLocalBridges, LocalBridge } from "@/hooks/use-local-bridges";
import { useLatestVersion } from "@/hooks/use-latest-version";

export const BridgeDiscovery = memo(() => {
  const { bridges, isScanning, addBridge, removeBridge, checkAllBridges, scanLocalhost } = useLocalBridges();
  const { version: latestVersion } = useLatestVersion();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newHost, setNewHost] = useState("");
  const [newPort, setNewPort] = useState("3000");

  const handleAddBridge = useCallback(() => {
    if (newHost.trim()) {
      addBridge(newHost.trim(), parseInt(newPort) || 3000);
      setNewHost("");
      setNewPort("3000");
      setShowAddForm(false);
    }
  }, [addBridge, newHost, newPort]);

  const handleScan = useCallback(async () => {
    await scanLocalhost();
    await checkAllBridges();
  }, [scanLocalhost, checkAllBridges]);

  const openBridge = useCallback((bridge: LocalBridge) => {
    window.open(`http://${bridge.host}:${bridge.port}`, "_blank");
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Lokala bridges</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={isScanning}
            className="h-8 gap-2 text-xs"
          >
            {isScanning ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Söker...</span>
              </>
            ) : (
              <>
                <Search className="h-3.5 w-3.5" />
                <span>Sök</span>
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            className="h-8 w-8 p-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Scanning indicator */}
      {isScanning && (
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
            <p className="text-sm font-medium text-primary">Söker efter bridges...</p>
            <p className="text-xs text-muted-foreground">Kontrollerar localhost:3000-3004</p>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-2">
              <Input
                placeholder="IP-adress eller hostname"
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Port"
                value={newPort}
                onChange={(e) => setNewPort(e.target.value)}
                className="w-20"
                type="number"
              />
              <Button onClick={handleAddBridge} size="sm">
                Lägg till
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              T.ex. 192.168.1.100 eller raspberrypi.local
            </p>
          </CardContent>
        </Card>
      )}

      {/* Bridge list */}
      {bridges.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 border border-border">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Server className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Inga bridges hittade</p>
            <p className="text-xs text-muted-foreground">
              Klicka "Sök" eller lägg till en manuellt
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {bridges.map((bridge) => (
            <div
              key={bridge.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                bridge.isOnline ? 'bg-primary/20' : 'bg-muted'
              }`}>
                {bridge.isOnline ? (
                  <Wifi className="h-5 w-5 text-primary" />
                ) : (
                  <WifiOff className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{bridge.name}</p>
                  {bridge.isOnline && bridge.version && (
                    <Badge 
                      variant={bridge.version === latestVersion ? "secondary" : "destructive"}
                      className="text-xs"
                    >
                      v{bridge.version}
                      {bridge.version !== latestVersion && (
                        <AlertTriangle className="h-3 w-3 ml-1" />
                      )}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {bridge.host}:{bridge.port}
                  {bridge.lastSeen && (
                      <span className="ml-2">
                        • Sedd {new Date(bridge.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {bridge.isOnline && bridge.version && bridge.version !== latestVersion && (
                      <span className="ml-2 text-destructive">
                        • Ny version tillgänglig (v{latestVersion})
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openBridge(bridge)}
                  className="h-8 w-8 p-0"
                  title="Öppna bridge"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeBridge(bridge.id)}
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                  title="Ta bort"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
});

BridgeDiscovery.displayName = "BridgeDiscovery";
