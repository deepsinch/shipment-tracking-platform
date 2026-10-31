// Vitest runs outside the React Server Components environment, where importing the real
// `server-only` package throws. Tests are server code, so an empty module is correct here.
export {};
