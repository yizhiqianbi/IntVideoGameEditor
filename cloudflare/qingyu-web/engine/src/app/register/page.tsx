"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "../login/auth.module.css";

const LAST_ACCOUNT_STORAGE_KEY = "pencil-studio:last-account";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const rawValue = window.localStorage.getItem(LAST_ACCOUNT_STORAGE_KEY);

      if (!rawValue) {
        return;
      }

      const parsed = JSON.parse(rawValue) as { email?: string; name?: string };

      if (typeof parsed.email === "string") {
        setEmail(parsed.email);
      }

      if (typeof parsed.name === "string") {
        setName(parsed.name);
      }
    } catch {
      window.localStorage.removeItem(LAST_ACCOUNT_STORAGE_KEY);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      // Auto sign in after registration
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      setLoading(false);

      if (result?.error) {
        setError("Account created but sign-in failed. Please try logging in.");
        return;
      }

      window.localStorage.setItem(
        LAST_ACCOUNT_STORAGE_KEY,
        JSON.stringify({
          email: email.trim().toLowerCase(),
          name: name.trim(),
        }),
      );

      router.push("/pencil-studio-vid");
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Fun-X-Studio</h1>
        <p className={styles.subtitle}>Create your account</p>
        <p className={styles.bonus}>200 free credits to start</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && <p className={styles.error}>{error}</p>}

          <label className={styles.label}>
            Name (optional)
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
              placeholder="Your name"
            />
          </label>

          <label className={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              placeholder="you@example.com"
              required
            />
          </label>

          <label className={styles.label}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              placeholder="At least 6 characters"
              minLength={6}
              required
            />
          </label>

          <button type="submit" className={styles.button} disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className={styles.footer}>
          Already have an account?{" "}
          <Link href="/login" className={styles.link}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
