/// <reference types="vite/client" />

declare module 'wink-lemmatizer' {
  interface Lemmatizer {
    adjective(word: string): string;
    noun(word: string): string;
    verb(word: string): string;
  }

  const lemmatizer: Lemmatizer;
  export default lemmatizer;
}
