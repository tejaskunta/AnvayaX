"use client";

/* Demo sign-in: pick one of three personas, each with a different access
 * surface. No passwords — this exists so the walkthrough can show how the
 * product looks through an Admin's, a site supervisor's, and an HSE
 * analyst's eyes. Replace with Clerk/Auth.js when real auth lands. */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { ROLES, type Role } from "@/lib/auth";

const ORDER: Role[] = ["admin", "supervisor", "hse"];

export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (role: Role) => {
    setBusy(role);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(`login -> ${res.status}`);
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md">
        <header className="text-center">
          <h1 className="page-title text-center">
            Anvaya<span className="text-[var(--accent)]">X</span>
          </h1>
          <p className="mt-1 text-sm text-[var(--dim)]">
            SIF precursor intelligence · sign in to the demo
          </p>
        </header>

        <div className="panel mt-6 divide-y divide-[var(--line)]">
          {ORDER.map((role) => {
            const def = ROLES[role];
            return (
              <button
                key={role}
                type="button"
                onClick={() => signIn(role)}
                disabled={busy !== null}
                className="group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-[var(--ink-850)] disabled:opacity-50"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-[var(--line-strong)] font-display text-sm font-bold text-[var(--brand)]"
                  aria-hidden
                >
                  {def.label.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-sm font-semibold text-[var(--chalk)]">
                    {busy === role ? "signing in..." : def.label}
                  </span>
                  <span className="block text-xs leading-5 text-[var(--faint)]">{def.blurb}</span>
                </span>
                <span className="text-xs text-[var(--faint)] group-hover:text-[var(--dim)]" aria-hidden>
                  →
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <p className="panel mt-4 border-[var(--tier-asif)] p-3 text-sm text-[var(--tier-asif)]">
            {error}
          </p>
        )}

        <p className="mt-5 text-center text-xs leading-5 text-[var(--faint)]">
          Demo build — role choice is stored in a cookie, not a session.
          <br />
          Swap <span className="font-mono">lib/auth.ts</span> for Clerk when real accounts land.
        </p>
      </div>
    </div>
  );
}
