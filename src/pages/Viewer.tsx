import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle } from "lucide-react";

const Viewer = () => {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const url = searchParams.get("url");

  useEffect(() => {
    if (!url) {
      setError("No URL provided");
      return;
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      setError("Invalid URL format");
    }

    // Keep-alive mechanism to prevent Chromecast timeout
    const keepAlive = setInterval(() => {
      console.log('Keep-alive:', new Date().toISOString());
    }, 3000);

    return () => {
      clearInterval(keepAlive);
    };
  }, [url]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold">Error Loading Website</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden bg-background">
      <iframe
        src={url!}
        className="w-full h-full border-0"
        title="Website Viewer"
        loading="eager"
        onLoad={() => console.log('Iframe loaded')}
        onError={(e) => console.error('Iframe error:', e)}
      />
    </div>
  );
};

export default Viewer;
