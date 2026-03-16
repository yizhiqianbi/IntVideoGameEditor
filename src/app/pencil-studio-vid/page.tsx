"use client";

import { useEffect, useState } from "react";
import { EditorShell } from "@/components/editor/editor-shell";

export default function PencilStudioVidPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setMounted(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return <EditorShell />;
}
