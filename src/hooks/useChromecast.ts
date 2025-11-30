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
  const { toast } = useToast();

  const sessionListener = useCallback((castSession: any) => {
    console.log('Session established:', castSession);
    setSession(castSession);
    setIsConnected(true);
    setCurrentDevice({
      friendlyName: castSession.receiver.friendlyName,
      id: castSession.receiver.id || '',
    });

    castSession.addUpdateListener((isAlive: boolean) => {
      if (!isAlive) {
        setIsConnected(false);
        setCurrentDevice(null);
        setSession(null);
      }
    });
  }, []);

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
  }, [sessionListener, receiverListener, toast]);

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
      const cast = window.chrome?.cast;
      if (!session || !cast) {
        toast({
          title: 'Not Connected',
          description: 'Please connect to a Chromecast device first.',
          variant: 'destructive',
        });
        return;
      }

      const mediaInfo = new cast.media.MediaInfo(url, 'text/html');
      mediaInfo.metadata = new cast.media.GenericMediaMetadata();
      mediaInfo.metadata.title = 'Website Cast';
      mediaInfo.metadata.subtitle = url;

      const request = new cast.media.LoadRequest(mediaInfo);

      session.loadMedia(
        request,
        (media: any) => {
          console.log('Media loaded successfully:', media);
          toast({
            title: 'Casting Started',
            description: `Now casting ${url}`,
          });
        },
        (error: any) => {
          console.error('Error loading media:', error);
          toast({
            title: 'Cast Failed',
            description: 'Unable to cast this content. The URL may not be compatible.',
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
          console.log('Session stopped');
          setIsConnected(false);
          setCurrentDevice(null);
          setSession(null);
          toast({
            title: 'Casting Stopped',
            description: 'Disconnected from Chromecast',
          });
        },
        (error) => {
          console.error('Error stopping session:', error);
        }
      );
    }
  }, [session, toast]);

  return {
    isAvailable,
    isConnected,
    currentDevice,
    requestSession,
    loadMedia,
    stopCasting,
  };
};
