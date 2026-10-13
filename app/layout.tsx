import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Зачарованная библиотека",
  description: "Личные книжные полки и читательский дневник",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Зачарованная библиотека",
    description: "Личные книжные полки и читательский дневник",
    images: [{ url: "/og.png", width: 1680, height: 945 }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        {children}
        <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async />
      </body>
    </html>
  );
}
