import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

// Public Sans for the interface, Newsreader for headings and for the agreements themselves.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Prelegal",
  description:
    "Draft a legal agreement from the Common Paper standard terms by chatting with an AI assistant. Drafts are saved to your account.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} ${newsreader.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
