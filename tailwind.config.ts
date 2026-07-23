import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gold: {
          50: "#fbf8ef",
          100: "#f5edd2",
          200: "#ebd9a3",
          300: "#dfbe6c",
          400: "#d4a544",
          500: "#c58f2f",
          600: "#a97125",
          700: "#875421",
          800: "#714421",
          900: "#61391f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
