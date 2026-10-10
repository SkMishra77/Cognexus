import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Cognexus",
    template: "%s · Cognexus",
  },
  description:
    "Upload a research paper and learn interactively with AI-generated summaries, visuals, and knowledge checks.",
  openGraph: {
    title: "Cognexus",
    description:
      "Upload a research paper and learn interactively with AI-generated summaries, visuals, and knowledge checks.",
    siteName: "Cognexus",
    type: "website",
  },
  other: {
    "theme-color": "#0a0a0a",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <ToastProvider>
          <ErrorBoundary>{children}</ErrorBoundary>
        </ToastProvider>
      </body>
    </html>
  );
}
