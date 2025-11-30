/// <reference path="../types/chromecast.d.ts" />
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

declare global {
  interface Window {
    __onGCastApiAvailable: (isAvailable: boolean) => void;
    chrome: {
      cast: any;
    };
  }
}

interface ChromecastDevice {
  friendlyName: string;
  id: string;
}

export const useChromecast = () => {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<ChromecastDevice | null>(null);
  const [session, setSession] = useState<chrome.cast.Session | null>(null);
  const [isCasting, setIsCasting] = useState(false);
  const [lastActivityTime, setLastActivityTime] = useState(Date.now());
  const [shouldAutoConnect, setShouldAutoConnect] = useState(false);
  const { toast } = useToast();

  const LAST_DEVICE_KEY = 'chromecast-last-device';

  const sessionListener = useCallback((castSession: any) => {
    console.log('Session established:', castSession);
    setSession(castSession);
    setIsConnected(true);
    const device = {
      friendlyName: castSession.receiver.friendlyName,
      id: castSession.receiver.id || '',
    };
    setCurrentDevice(device);
    
    // Save the device for auto-reconnect
    localStorage.setItem(LAST_DEVICE_KEY, JSON.stringify(device));

    // Monitor session status but don't disconnect on every update
    // Only disconnect if the Chromecast device is truly unavailable
    castSession.addUpdateListener((isAlive: boolean) => {
      console.log('Session update - isAlive:', isAlive);
      if (!isAlive) {
        console.log('Session ended, but keeping connection state for monitoring');
        // Don't immediately disconnect - the device might still be available
        // Just mark that we're not actively controlling it
        setIsCasting(false);
      }
    });
  }, [LAST_DEVICE_KEY]);

  const receiverListener = useCallback(
    (availability: string) => {
      if (availability === 'available') {
        console.log('Chromecast devices available');
        setIsAvailable(true);
      } else {
        console.log('No Chromecast devices available');
        setIsAvailable(false);
      }
    },
    []
  );

  const initializeCastApi = useCallback(() => {
    console.log('initializeCastApi called');
    const cast = window.chrome?.cast;
    if (!cast) {
      console.log('Cast API not found on window.chrome');
      return;
    }

    console.log('Cast API found, initializing...');
    const applicationID = cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
    const sessionRequest = new cast.SessionRequest(applicationID);
    const apiConfig = new cast.ApiConfig(
      sessionRequest,
      sessionListener,
      receiverListener
    );

    cast.initialize(
      apiConfig,
      () => {
        console.log('Cast API initialized successfully');
        // Check for saved device and trigger auto-connect
        const savedDevice = localStorage.getItem(LAST_DEVICE_KEY);
        if (savedDevice) {
          console.log('Found saved device, will attempt auto-connect');
          setShouldAutoConnect(true);
        }
      },
      (error: any) => {
        console.error('Error initializing Cast API:', error);
        toast({
          title: 'Cast API Error',
          description: 'Failed to initialize Chromecast.',
          variant: 'destructive',
        });
      }
    );
  }, [sessionListener, receiverListener, toast, LAST_DEVICE_KEY]);

  useEffect(() => {
    console.log('Setting up Cast API callback');
    
    // Initialize Cast API
    window.__onGCastApiAvailable = (isAvailable) => {
      console.log('Cast API available callback called:', isAvailable);
      if (isAvailable) {
        initializeCastApi();
      }
    };

    // Check if Cast API is already available
    if (window.chrome?.cast) {
      console.log('Cast API already loaded, initializing...');
      initializeCastApi();
    }
  }, [initializeCastApi]);

  // Auto-connect to saved device
  useEffect(() => {
    if (shouldAutoConnect && isAvailable && !isConnected) {
      console.log('Attempting auto-connect to saved device');
      requestSession();
      setShouldAutoConnect(false);
    }
  }, [shouldAutoConnect, isAvailable, isConnected]);

  const requestSession = useCallback(() => {
    const cast = window.chrome?.cast;
    if (!isAvailable || !cast) {
      toast({
        title: 'Cast Not Available',
        description: 'Chromecast is not available. Check your network connection.',
        variant: 'destructive',
      });
      return;
    }

    cast.requestSession(
      (castSession: any) => {
        sessionListener(castSession);
        toast({
          title: 'Connected',
          description: `Connected to ${castSession.receiver.friendlyName}`,
        });
      },
      (error: any) => {
        console.error('Error requesting session:', error);
        if (error.code !== 'cancel') {
          toast({
            title: 'Connection Failed',
            description: 'Failed to connect to Chromecast device.',
            variant: 'destructive',
          });
        }
      }
    );
  }, [isAvailable, sessionListener, toast]);

  const loadMedia = useCallback(
    (url: string) => {
      if (!session) {
        toast({
          title: 'Not Connected',
          description: 'Connect to a Chromecast device first.',
          variant: 'destructive',
        });
        return;
      }

      const cast = window.chrome?.cast;
      if (!cast) {
        toast({
          title: 'Cast API Not Available',
          description: 'Chromecast API is not loaded.',
          variant: 'destructive',
        });
        return;
      }

      // Create media info for the viewer URL
      const mediaInfo = new cast.media.MediaInfo(url, 'text/html');
      const metadata = new cast.media.GenericMediaMetadata();
      metadata.title = 'Website Cast';
      mediaInfo.metadata = metadata;

      const loadRequest = new cast.media.LoadRequest(mediaInfo);

      session.loadMedia(
        loadRequest,
        () => {
          console.log('Media loaded successfully:', url);
          setIsCasting(true);
          setLastActivityTime(Date.now());
          toast({
            title: 'Casting Started',
            description: 'Website is now playing on your TV',
          });
        },
        (error) => {
          console.error('Error loading media:', error);
          toast({
            title: 'Cast Failed',
            description: 'Failed to start casting. Try reconnecting.',
            variant: 'destructive',
          });
        }
      );
    },
    [session, toast]
  );

  const stopCasting = useCallback(() => {
    if (session) {
      session.stop(
        () => {
          console.log('Session stopped - full disconnect');
          setIsConnected(false);
          setCurrentDevice(null);
          setSession(null);
          setIsCasting(false);
          // Clear saved device when manually disconnecting
          localStorage.removeItem(LAST_DEVICE_KEY);
          toast({
            title: 'Disconnected',
            description: 'Disconnected from Chromecast',
          });
        },
        (error) => {
          console.error('Error stopping session:', error);
          // Even if stop fails, clear the connection state
          setIsConnected(false);
          setCurrentDevice(null);
          setSession(null);
          setIsCasting(false);
          localStorage.removeItem(LAST_DEVICE_KEY);
        }
      );
    }
  }, [session, toast, LAST_DEVICE_KEY]);

  return {
    isAvailable,
    isConnected,
    currentDevice,
    isCasting,
    lastActivityTime,
    requestSession,
    loadMedia,
    stopCasting,
  };
};
