import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "var(--ink-950)",
          900: "var(--ink-900)",
          850: "var(--ink-850)",
          800: "var(--ink-800)",
        },
        line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
        chalk: "var(--chalk)",
        dim: "var(--dim)",
        faint: "var(--faint)",
        tier: {
          nm: "var(--tier-nm)",
          rec: "var(--tier-rec)",
          psif: "var(--tier-psif)",
          asif: "var(--tier-asif)",
        },
        caution: "var(--caution)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
