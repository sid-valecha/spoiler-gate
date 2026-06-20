import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Spoiler Gate",
  description: "Ask book questions without crossing your current page boundary.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
