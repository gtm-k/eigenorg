import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["www/pkg/**", "www/vendor/**", "node_modules/**", "target/**"],
  },
  {
    files: ["www/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        console: "readonly",
        WebAssembly: "readonly",
        Worker: "readonly",
        self: "readonly",
        postMessage: "readonly",
        onmessage: "writable",
        performance: "readonly",
        URL: "readonly",
        Blob: "readonly",
        CompressionStream: "readonly",
        DecompressionStream: "readonly",
        Response: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        btoa: "readonly",
        atob: "readonly",
        requestAnimationFrame: "readonly",
        Chart: "readonly"
      },
    },
  },
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly"
      },
    },
  },
];
