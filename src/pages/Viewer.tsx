import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const Viewer = () => {
  const [searchParams] = useSearchParams();
  const url = searchParams.get("url");

  useEffect(() => {
    if (url) {
      // Immediate redirect to the target URL
      console.log('Redirecting to:', url);
      window.location.replace(url);
    }
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

  // Show a brief loading message before redirect
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
};

export default Viewer;
