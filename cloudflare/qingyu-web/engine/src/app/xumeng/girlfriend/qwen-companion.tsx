"use client";
import CompanionPage from "./companion-page";

export default function QwenCompanion({ onBack }: { onBack?: () => void }) {
  return <CompanionPage variant="traveler" onBack={onBack} />;
}
