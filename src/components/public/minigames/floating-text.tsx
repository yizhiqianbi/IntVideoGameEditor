"use client";

import { useEffect } from "react";
import styles from "./floating-text.module.css";

type FloatingTextProps = {
  text: string;
  x: number;
  y: number;
  onComplete?: () => void;
};

export function FloatingText({ text, x, y, onComplete }: FloatingTextProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete?.();
    }, 800);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className={`${styles.float} ${styles.floatUp}`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
    >
      {text}
    </div>
  );
}
