/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // 与 apps/extension 视觉语言对齐：known 灰、learning 黄、unknown 蓝
        familiarity: {
          unknown: '#3b82f6',
          learning: '#f59e0b',
          known: '#9ca3af',
        },
      },
    },
  },
  plugins: [],
};
