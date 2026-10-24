import { useState, useCallback, useEffect, useRef } from 'react';

export function useResizer(
  initialWidth: number,
  minWidth: number,
  maxWidth: number,
  direction: 'left' | 'right'
) {
  const [width, setWidth] = useState(initialWidth);
  const [collapsed, setCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(initialWidth);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    setIsDragging(true);
  }, [width]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      let newWidth: number;
      if (direction === 'right') {
        newWidth = startWidthRef.current + delta;
      } else {
        newWidth = startWidthRef.current - delta;
      }
      setWidth(Math.min(Math.max(newWidth, minWidth), maxWidth));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, minWidth, maxWidth, direction]);

  const effectiveWidth = collapsed ? 0 : width;

  return { width: effectiveWidth, startDrag, isDragging, collapsed, toggleCollapse };
}
