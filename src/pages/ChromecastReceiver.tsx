import { useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    cast?: {
      framework?: {
        CastReceiverContext: {
          getInstance: () => {
            addCustomMessageListener: (
              namespace: string,
              listener: (event: { data?: { type?: string; url?: string } }) => void,
            ) => void;
            addEventListener: (eventType: unknown, listener: () => void) => void;
            start: (options?: unknown) => void;
          };
        };
        CastReceiverOptions: new () => {
          disableIdleTimeout?: boolean;
        };
        system: {
          EventType: {
            SENDER_DISCONNECTED: unknown;
          };
        };
      };
    };
  }
}

const RECEIVER_VERSION = "1.4.0";
const CAST_NAMESPACE = "urn:x-cast:com.website.cast";
const CAST_SDK_URL = "https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js";

type LogEntry = {
  id: string;
  level: "error" | "warn";
  message: string;
  time: string;
};

const ChromecastReceiver = () => {
  const [status, setStatus] = useState<{ text: string; type: "" | "connected" | "error" | "warning" }>({
    text: "Starting receiver...",
    type: "",
  });
  const [loading, setLoading] = useState(false);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [showStatus, setShowStatus] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const currentUrlRef = useRef<string | null>(null);
  const statusHideTimerRef = useRef<number | null>(null);

  const hasErrors = logs.length > 0;

  const log = useMemo(
    () => (level: "info" | "warn" | "error", message: string) => {
      console.log(`[${level.toUpperCase()}] ${message}`);

      if (level === "error" || level === "warn") {
        setLogs((prev) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            level,
            message,
            time: new Date().toLocaleTimeString("sv-SE"),
          },
          ...prev,
        ].slice(0, 20));
      }
    },
    [],
  );

  useEffect(() => {
    document.title = "Chromecast Website Receiver";
    document.documentElement.style.width = "100%";
    document.documentElement.style.height = "100%";
    document.documentElement.style.overflow = "hidden";
    document.body.style.width = "100%";
    document.body.style.height = "100%";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";
    document.body.style.background = "hsl(var(--background))";

    return () => {
      if (statusHideTimerRef.current) {
        window.clearTimeout(statusHideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      log("error", `${event.message} L${event.lineno}`);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      log("error", `Promise: ${String(event.reason)}`);
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [log]);

  useEffect(() => {
    const loadWebsite = (url: string) => {
      if (url === currentUrlRef.current) return;

      currentUrlRef.current = url;
      localStorage.setItem("lastUrl", url);
      setStatus({ text: "Loading...", type: "warning" });
      setShowStatus(true);
      setLoading(true);
      setIframeUrl(url);
    };

    const initializeReceiver = () => {
      try {
        const context = window.cast?.framework?.CastReceiverContext.getInstance();
        const castFramework = window.cast?.framework;

        if (!context || !castFramework) {
          throw new Error("Cast framework unavailable");
        }

        context.addCustomMessageListener(CAST_NAMESPACE, (event) => {
          if (event.data?.type === "LOAD_WEBSITE" && event.data.url) {
            loadWebsite(event.data.url);
          }
        });

        context.addEventListener(castFramework.system.EventType.SENDER_DISCONNECTED, () => {
          log("warn", "Sender disconnected");
        });

        const options = new castFramework.CastReceiverOptions();
        options.disableIdleTimeout = true;
        context.start(options);

        const savedUrl = localStorage.getItem("lastUrl");
        const testUrl = new URLSearchParams(window.location.search).get("url");

        if (testUrl) {
          loadWebsite(testUrl);
        } else if (savedUrl) {
          loadWebsite(savedUrl);
        } else {
          setStatus({ text: "Ready to cast...", type: "" });
          setShowStatus(true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", `INIT: ${message}`);
        setStatus({ text: `Init error: ${message}`, type: "error" });
        setShowStatus(true);
      }
    };

    log("info", `Receiver v${RECEIVER_VERSION} | ${window.innerWidth}x${window.innerHeight}`);

    if (window.cast?.framework) {
      initializeReceiver();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${CAST_SDK_URL}"]`);
    const script = existingScript ?? document.createElement("script");

    if (!existingScript) {
      script.src = CAST_SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }

    script.addEventListener("load", initializeReceiver);
    script.addEventListener("error", () => {
      log("error", "Failed to load Cast SDK");
      setStatus({ text: "Init error: Failed to load Cast SDK", type: "error" });
      setShowStatus(true);
    });

    return () => {
      script.removeEventListener("load", initializeReceiver);
    };
  }, [log]);

  const handleIframeLoad = () => {
    setStatus({ text: "Connected", type: "connected" });
    setLoading(false);
    setShowStatus(true);

    if (statusHideTimerRef.current) {
      window.clearTimeout(statusHideTimerRef.current);
    }

    statusHideTimerRef.current = window.setTimeout(() => {
      setShowStatus(false);
    }, 5000);
  };

  const handleIframeError = () => {
    log("error", "Iframe load failed");
    setStatus({ text: "Error loading website", type: "error" });
    setLoading(false);
    setShowStatus(true);
  };

  return (
    <main className="fixed inset-0 overflow-hidden bg-background text-foreground">
      {showStatus && (
        <div
          className={[
            "fixed left-5 top-5 z-[1000] max-w-[400px] rounded-lg px-5 py-3 text-[13px] shadow-lg",
            status.type === "connected" && "bg-primary text-primary-foreground",
            status.type === "error" && "bg-destructive text-destructive-foreground",
            status.type === "warning" && "bg-secondary text-secondary-foreground",
            !status.type && "bg-card text-card-foreground",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {status.text}
        </div>
      )}

      {loading && <div className="fixed left-1/2 top-1/2 z-[999] -translate-x-1/2 -translate-y-1/2 text-2xl">Loading website...</div>}

      {hasErrors && (
        <div className="fixed bottom-5 left-5 z-[1000] max-h-[200px] max-w-[500px] overflow-y-auto rounded-lg bg-card/95 px-4 py-3 font-mono text-[11px] text-card-foreground shadow-lg">
          {logs.map((entry) => (
            <div
              key={entry.id}
              className={[
                "my-0.5 opacity-90",
                entry.level === "error" && "text-destructive",
                entry.level === "warn" && "text-primary",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {entry.time} {entry.message}
            </div>
          ))}
        </div>
      )}

      <iframe
        title="Chromecast website content"
        src={iframeUrl ?? undefined}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        allow="autoplay"
        loading="eager"
        className="absolute inset-0 h-full w-full border-0"
        style={{
          display: iframeUrl ? "block" : "none",
          transform: "translate3d(0, 0, 0)",
          willChange: "transform",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          contain: "layout",
          overflow: "hidden",
        }}
      />
    </main>
  );
};

export default ChromecastReceiver;