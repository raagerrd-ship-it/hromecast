import { useState, useEffect, useRef, RefObject } from "react";

export function usePreviewScale(): [number, RefObject<HTMLDivElement>] {
  const [previewScale, setPreviewScale] = useState(0.35);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateScale = () => {
      if (previewContainerRef.current) {
        const containerWidth = previewContainerRef.current.offsetWidth;
        setPreviewScale(containerWidth / 1920);
      }
    };
    
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return [previewScale, previewContainerRef];
}
