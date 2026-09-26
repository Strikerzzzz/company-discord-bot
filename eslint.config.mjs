// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
	{ ignores: ["build/", "build-test/", "node_modules/"] },
	eslint.configs.recommended,
	{
		// Lint có dùng thông tin type cho source TypeScript.
		files: ["**/*.ts"],
		extends: [tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// Promise không được await từng làm sập bot (LL-001). test()/describe() của node:test là an toàn.
			"@typescript-eslint/no-floating-promises": ["error", {
				allowForKnownSafeCalls: [{ from: "package", name: ["test", "it", "describe", "suite"], package: "node:test" }],
			}],
			"@typescript-eslint/no-misused-promises": "error",
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
			// Bản TypeScript hiểu constructor chỉ có parameter property không phải hàm rỗng.
			"no-empty-function": "off",
			"@typescript-eslint/no-empty-function": "error",
		},
	},
	{
		// Business module, database và shared không được phụ thuộc discord.js (DEC-007).
		files: ["src/modules/**/*.ts", "src/db/**/*.ts", "src/shared/**/*.ts"],
		rules: {
			"no-restricted-imports": ["error", {
				patterns: [{ group: ["discord.js", "@discordjs/*"], message: "Business module không được import discord.js (DEC-007)." }],
			}],
		},
	},
	{
		// File JS chạy trực tiếp bằng Node (CommonJS).
		files: ["ecosystem.config.js", "scripts/**/*.cjs"],
		languageOptions: { sourceType: "commonjs", globals: { process: "readonly" } },
	},
	{
		// Quy tắc style giữ nguyên từ .eslintrc.cjs trước đây.
		rules: {
			"arrow-spacing": ["warn", { "before": true, "after": true }],
			"brace-style": ["error", "allman", { "allowSingleLine": true }],
			"comma-dangle": ["error", "always-multiline"],
			"comma-spacing": "error",
			"comma-style": "error",
			"curly": ["error", "multi-line", "consistent"],
			"dot-location": ["error", "property"],
			"handle-callback-err": "off",
			"indent": ["error", "tab"],
			"keyword-spacing": "error",
			"max-nested-callbacks": ["error", { "max": 4 }],
			"max-statements-per-line": ["error", { "max": 2 }],
			"no-console": "off",
			"no-floating-decimal": "error",
			"no-inline-comments": "error",
			"no-lonely-if": "error",
			"no-multi-spaces": "error",
			"no-multiple-empty-lines": ["error", { "max": 2, "maxEOF": 1, "maxBOF": 0 }],
			"no-shadow": ["error", { "allow": ["err", "resolve", "reject"] }],
			"no-trailing-spaces": ["error"],
			"no-var": "error",
			"object-curly-spacing": ["error", "always"],
			"prefer-const": "error",
			"quotes": ["error", "double"],
			"space-before-blocks": "error",
			"space-before-function-paren": ["error", {
				"anonymous": "never",
				"named": "never",
				"asyncArrow": "always",
			}],
			"space-in-parens": "error",
			"space-infix-ops": "error",
			"space-unary-ops": "error",
			"spaced-comment": "error",
			"yoda": "error",
		},
	},
);
