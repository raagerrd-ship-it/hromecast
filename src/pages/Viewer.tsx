import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const Viewer = () => {
  const [searchParams] = useSearchParams();
  const [countdown, setCountdown] = useState(3);
  const url = searchParams.get("url");

  useEffect(() => {
    if (!url) return;

    console.log('Viewer loaded with URL:', url);

    // Countdown before redirect
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          console.log('Redirecting to:', url);
          window.location.replace(url);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [url]);

  if (!url) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">No URL provided</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="text-6xl font-bold text-primary">{countdown}</div>
        <p className="text-xl text-muted-foreground">Loading content...</p>
      </div>
    </div>
  );
};

export default Viewer;
