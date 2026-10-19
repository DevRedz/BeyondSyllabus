import "./globals.css";
import Link from "next/link";
import AuthControls from "../components/auth-controls";
import { createClient } from "../lib/supabase/server";

export const metadata = {
  title: "Syllabus Review | Beyond Syllabus",
  description: "Curate evidence-backed course skills and resume bullets.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && error.name !== "AuthSessionMissingError") {
    throw new Error(`Unable to verify the current user: ${error.message}`);
  }

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <div className="site-brand">
              <p className="brand-mark">Beyond Syllabus</p>
              <nav className="site-nav" aria-label="Main navigation">
                <Link href="/">Syllabus review</Link>
                <Link href="/skills">Course skills</Link>
              </nav>
            </div>
            <AuthControls email={user?.email ?? null} />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
