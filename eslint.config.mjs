import next from "eslint-config-next";
import tseslint from "typescript-eslint";

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "overpass-db/**", ".data/**"] },
  ...next,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
];

export default config;
