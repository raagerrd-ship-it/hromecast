import { useState, useEffect, useCallback } from "react";

export interface LocalBridge {
  id: string;
  name: string;
  host: string;
  port: number;
  lastSeen: string | null;
  isOnline: boolean;
}

const BRIDGES_KEY = "chromecast-bridges";
const DEFAULT_PORT = 3000;

export function useLocalBridges() {
  const [bridges, setBridges] = useState<LocalBridge[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(BRIDGES_KEY);
    if (saved) {
      try {
        setBridges(JSON.parse(saved));
      } catch (e) {
        console.error("Error parsing saved bridges:", e);
      }
    }
  }, []);

  // Save to localStorage
  const saveBridges = useCallback((newBridges: LocalBridge[]) => {
    localStorage.setItem(BRIDGES_KEY, JSON.stringify(newBridges));
    setBridges(newBridges);
  }, []);

  // Add a new bridge manually
  const addBridge = useCallback((host: string, port: number = DEFAULT_PORT, name?: string) => {
    const id = `${host}:${port}`;
    const existing = bridges.find(b => b.id === id);
    
    if (existing) {
      return existing;
    }

    const newBridge: LocalBridge = {
      id,
      name: name || `Bridge (${host})`,
      host,
      port,
      lastSeen: null,
      isOnline: false,
    };

    saveBridges([...bridges, newBridge]);
    return newBridge;
  }, [bridges, saveBridges]);

  // Remove a bridge
  const removeBridge = useCallback((id: string) => {
    saveBridges(bridges.filter(b => b.id !== id));
  }, [bridges, saveBridges]);

  // Check if a bridge is online
  const checkBridge = useCallback(async (bridge: LocalBridge): Promise<LocalBridge> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`http://${bridge.host}:${bridge.port}/api/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return {
          ...bridge,
          name: data.deviceId || bridge.name,
          lastSeen: new Date().toISOString(),
          isOnline: true,
        };
      }
    } catch (e) {
      // Bridge offline
    }

    return {
      ...bridge,
      isOnline: false,
    };
  }, []);

  // Check all bridges
  const checkAllBridges = useCallback(async () => {
    setIsScanning(true);
    
    const updated = await Promise.all(bridges.map(checkBridge));
    saveBridges(updated);
    
    setIsScanning(false);
  }, [bridges, checkBridge, saveBridges]);

  // Scan localhost for common ports
  const scanLocalhost = useCallback(async () => {
    setIsScanning(true);
    const commonPorts = [3000, 3001, 3002, 3003, 3004];
    const foundBridges: LocalBridge[] = [...bridges];

    for (const port of commonPorts) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(`http://localhost:${port}/api/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const id = `localhost:${port}`;
          
          if (!foundBridges.find(b => b.id === id)) {
            foundBridges.push({
              id,
              name: data.deviceId || `Bridge (localhost:${port})`,
              host: "localhost",
              port,
              lastSeen: new Date().toISOString(),
              isOnline: true,
            });
          } else {
            const idx = foundBridges.findIndex(b => b.id === id);
            if (idx !== -1) {
              foundBridges[idx] = {
                ...foundBridges[idx],
                name: data.deviceId || foundBridges[idx].name,
                lastSeen: new Date().toISOString(),
                isOnline: true,
              };
            }
          }
        }
      } catch (e) {
        // Port not responding
      }
    }

    saveBridges(foundBridges);
    setIsScanning(false);
  }, [bridges, saveBridges]);

  return {
    bridges,
    isScanning,
    addBridge,
    removeBridge,
    checkBridge,
    checkAllBridges,
    scanLocalhost,
  };
}
