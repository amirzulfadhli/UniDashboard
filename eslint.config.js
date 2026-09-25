import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "generated/**", ".npm-cache/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
