// apps/extension/postcss.config.js

export default {
  plugins: {
    '@tailwindcss/postcss': {
      content: [
        './src/content-ui/index.css',
        './src/content-ui/main.tsx',
        './src/content-ui/WordCard.tsx',
      ],
    },
    autoprefixer: {},
  },
};
