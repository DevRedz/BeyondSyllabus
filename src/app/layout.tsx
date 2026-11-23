import "./globals.css";
import Link from "next/link";
import AuthControls from "../components/auth-controls";
import { createClient } from "../lib/supabase/server";

export const metadata = {
  title: "Resume | Beyond Syllabus",
  description: "Build a resume from your saved course skills and projects.",
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
                <Link href="/">Resume</Link>
                <Link href="/skills">Course skills</Link>
                <Link href="/review">Syllabus review</Link>
                {user ? <Link href="/profile">Profile</Link> : null}
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
