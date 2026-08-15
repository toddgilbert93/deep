import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "3DUI",
  description: "CSS 3D UI element library",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-neutral-950 text-neutral-100">
      {children}
    </div>
  );
}
