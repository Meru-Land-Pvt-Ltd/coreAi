import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff9ec",
          100: "#fff0c7",
          200: "#ffd983",
          300: "#ffc15a",
          400: "#ffac3a",
          500: "#ff9521",
          600: "#f17316",
          700: "#c25114",
          800: "#9b4117",
          900: "#7d3716"
        }
      }
    }
  },
  plugins: [],
};

export default config;
