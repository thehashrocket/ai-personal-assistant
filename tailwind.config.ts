import { type Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";

export default {
  content: ["./src/**/*.tsx"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", ...fontFamily.sans],
      },
    },
  },
  darkMode: 'media', // Enable dark mode based on system preferences
  plugins: [require("@tailwindcss/typography"), require('daisyui')],
} satisfies Config;