import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const Viewer = () => {
  const [searchParams] = useSearchParams();
  const url = searchParams.get("url");

  useEffect(() => {
    if (url) {
      console.log('Viewer loading URL:', url);
      // Keep-alive ping
      const keepAlive = setInterval(() => {
        console.log('Keep-alive');
      }, 2000);
      
      return () => clearInterval(keepAlive);
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
