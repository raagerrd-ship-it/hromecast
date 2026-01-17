import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const Viewer = () => {
  const [searchParams] = useSearchParams();
  const url = searchParams.get("url");

  useEffect(() => {
    if (url) {
      console.log('Viewer loading URL:', url);
      
      // Keep-alive ping every 10 seconds (reduced from 2s)
      const keepAlive = setInterval(() => {
        console.log('Keep-alive');
      }, 10000);
      
      // Auto-refresh every 45 minutes to clear memory on Chromecast
      const autoRefresh = setInterval(() => {
        console.log('Auto-refresh to clear memory');
        window.location.reload();
      }, 45 * 60 * 1000);
      
      return () => {
        clearInterval(keepAlive);
        clearInterval(autoRefresh);
      };
    }
  }, [url]);

  if (!url) {
    return <div>No URL provided</div>;
  }

  return (
    <iframe
      src={url}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        margin: 0,
        padding: 0
      }}
      title="Content"
    />
  );
};

export default Viewer;
