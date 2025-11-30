import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";

const Viewer = () => {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const url = searchParams.get("url");

  useEffect(() => {
    if (!url) {
      setError("No URL provided");
      setIsLoading(false);
      return;
    }

    // Validate URL
    try {
      new URL(url);
      setIsLoading(false);
    } catch {
      setError("Invalid URL format");
      setIsLoading(false);
    }
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading website...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden bg-background">
      {!iframeLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
          <div className="text-center space-y-4">
            <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto" />
            <p className="text-lg text-muted-foreground">Loading content...</p>
          </div>
        </div>
      )}
      <iframe
        src={url!}
        className="w-full h-full border-0"
        title="Website Viewer"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        onLoad={() => {
          console.log('Iframe loaded successfully');
          setIframeLoaded(true);
        }}
        onError={(e) => {
          console.error('Iframe load error:', e);
          setError('Failed to load website content');
        }}
      />
    </div>
  );
};

export default Viewer;
