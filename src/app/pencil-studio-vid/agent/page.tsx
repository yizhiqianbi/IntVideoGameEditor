"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { EditorShell } from "@/components/editor/editor-shell";

export default function PencilStudioVidAgentPage() {
  const { status } = useSession();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setMounted(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  if (status === "loading" || !mounted) {
    return null;
  }

  if (status === "unauthenticated") {
    return null;
  }

  return <EditorShell workspace="agent" />;
}
