import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";

const resolveFdPath = (): string | null => {
	const command = process.platform === "win32" ? "where" : "which";
	const result = spawnSync(command, ["fd"], { encoding: "utf-8" });
	if (result.status !== 0 || !result.stdout) {
		return null;
	}

	const firstLine = result.stdout.split(/\r?\n/).find(Boolean);
	return firstLine ? firstLine.trim() : null;
};

type FolderStructure = {
	dirs?: string[];
	files?: Record<string, string>;
};

const setupFolder = (baseDir: string, structure: FolderStructure = {}): void => {
	const dirs = structure.dirs ?? [];
	const files = structure.files ?? {};

	dirs.forEach((dir) => {
		mkdirSync(join(baseDir, dir), { recursive: true });
	});
	Object.entries(files).forEach(([filePath, contents]) => {
		const fullPath = join(baseDir, filePath);
		mkdirSync(dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, contents);
	});
};

const fdPath = resolveFdPath();
const isFdInstalled = Boolean(fdPath);

const requireFdPath = (): string => {
	if (!fdPath) {
		throw new Error("fd is not available");
	}
	return fdPath;
};

const getSuggestions = (
	provider: CombinedAutocompleteProvider,
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	force: boolean = false,
) => provider.getSuggestions(lines, cursorLine, cursorCol, { signal: new AbortController().signal, force });

describe("CombinedAutocompleteProvider", () => {
	describe("extractPathPrefix", () => {
		it("extracts / from 'hey /' when forced", async () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["hey /"];
			const cursorLine = 0;
			const cursorCol = 5; // After the "/"

			const result = await getSuggestions(provider, lines, cursorLine, cursorCol, true);

			assert.notEqual(result, null, "Should return suggestions for root directory");
			if (result) {
				assert.strictEqual(result.prefix, "/", "Prefix should be '/'");
			}
		});

		it("extracts /A from '/A' when forced", async () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["/A"];
			const cursorLine = 0;
			const cursorCol = 2; // After the "A"

			const result = await getSuggestions(provider, lines, cursorLine, cursorCol, true);

			console.log("Result:", result);
			// This might return null if /A doesn't match anything, which is fine
			// We're mainly testing that the prefix extraction works
			if (result) {
				assert.strictEqual(result.prefix, "/A", "Prefix should be '/A'");
			}
		});

		it("does not trigger for slash commands", async () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["/model"];
			const cursorLine = 0;
			const cursorCol = 6; // After "model"

			const result = await getSuggestions(provider, lines, cursorLine, cursorCol, true);

			console.log("Result:", result);
			assert.strictEqual(result, null, "Should not trigger for slash commands");
		});

		it("triggers for absolute paths after slash command argument", async () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["/command /"];
			const cursorLine = 0;
			const cursorCol = 10; // After the second "/"

			const result = await getSuggestions(provider, lines, cursorLine, cursorCol, true);

			console.log("Result:", result);
			assert.notEqual(result, null, "Should trigger for absolute paths in command arguments");
			if (result) {
				assert.strictEqual(result.prefix, "/", "Prefix should be '/'");
			}
		});
	});

	describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
		let rootDir = "";
		let baseDir = "";
		let outsideDir = "";

		beforeEach(() => {
			rootDir = mkdtempSync(join(tmpdir(), "pi-autocomplete-root-"));
			baseDir = join(rootDir, "cwd");
			outsideDir = join(rootDir, "outside");
			mkdirSync(baseDir, { recursive: true });
			mkdirSync(outsideDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(rootDir, { recursive: true, force: true });
		});

		test("returns all files and folders for empty @ query", async () => {
			setupFolder(baseDir, {
				dirs: ["src"],
				files: {
					"README.md": "readme",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value).sort();
			assert.deepStrictEqual(values, ["@README.md", "@src/"].sort());
		});

		test("recognizes @ after CJK punctuation without consuming the preceding text", async () => {
			setupFolder(baseDir, { files: { "README.md": "readme" } });
			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			for (const before of ["\u67e5\u770b，", "\u3000", ..."，．：；！？（）［］｛｝“”‘’…—。、「」『』《》【】"]) {
				for (const force of [false, true]) {
					const line = `${before}@REA`;
					const result = await getSuggestions(provider, [line], 0, line.length, force);
					assert.ok(result, line);
					assert.strictEqual(result.prefix, "@REA");
					assert.deepStrictEqual(
						result.items.map((item) => item.value),
						["@README.md"],
					);
					const applied = provider.applyCompletion([line], 0, line.length, result.items[0]!, result.prefix);
					assert.strictEqual(applied.lines[0], `${before}@README.md `);
					assert.strictEqual(applied.cursorCol, applied.lines[0]!.length);
				}
			}
		});

		test("recognizes @ after opening wrappers like ( and backticks", async () => {
			setupFolder(baseDir, { files: { "README.md": "readme" } });
			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			for (const before of ["(", "see (", "[", "`", "<", "{"]) {
				const line = `${before}@REA`;
				const result = await getSuggestions(provider, [line], 0, line.length);
				assert.ok(result, line);
				assert.strictEqual(result.prefix, "@REA");
				const applied = provider.applyCompletion([line], 0, line.length, result.items[0]!, result.prefix);
				assert.strictEqual(applied.lines[0], `${before}@README.md `);
			}
			const embedded = "foo(@REA";
			assert.strictEqual(await getSuggestions(provider, [embedded], 0, embedded.length), null);
		});

		test("preserves CJK characters and embedded @ in attachment paths", async () => {
			setupFolder(baseDir, {
				files: { "\u6587\u6863/\u8bf4\u660e.md": "text", "\u6587\u6863@\u5907\u4efd/\u8bf4\u660e.md": "backup" },
			});
			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			for (const before of ["", "\u67e5\u770b，"]) {
				for (const directory of ["\u6587\u6863", "\u6587\u6863@\u5907\u4efd"]) {
					const prefix = `@${directory}/\u8bf4`;
					const line = before + prefix;
					const result = await getSuggestions(provider, [line], 0, line.length);
					assert.ok(result, line);
					assert.strictEqual(result.prefix, prefix);
					assert.deepStrictEqual(
						result.items.map((item) => item.value),
						[`@${directory}/\u8bf4\u660e.md`],
					);
				}
			}
		});

		test("completes quoted CJK attachments after prose without losing path segments or quotes", async () => {
			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			for (const separator of [" ", "\u3000", "，", "。"]) {
				const directory = `\u6211\u7684${separator}\u6587\u6863`;
				setupFolder(baseDir, {
					files: { [`${directory}/\u8bf4\u660e.md`]: "text", "\u6587\u6863/\u8bf4\u660e.md": "not the quoted path" },
				});
				const line = `\u67e5\u770b：@"${directory}/\u8bf4"\u540e\u6587`;
				const cursorCol = line.indexOf('"\u540e\u6587');
				const result = await getSuggestions(provider, [line], 0, cursorCol);
				assert.ok(result);
				assert.strictEqual(result.prefix, `@"${directory}/\u8bf4`);
				assert.deepStrictEqual(
					result.items.map((item) => item.value),
					[`@"${directory}/\u8bf4\u660e.md"`],
				);
				const applied = provider.applyCompletion([line], 0, cursorCol, result.items[0]!, result.prefix);
				assert.strictEqual(applied.lines[0], `\u67e5\u770b：@"${directory}/\u8bf4\u660e.md" \u540e\u6587`);
				assert.strictEqual(applied.cursorCol, `\u67e5\u770b：@"${directory}/\u8bf4\u660e.md" `.length);
			}
		});

		test("does not interpret email addresses or @ after ASCII or CJK letters as attachment prefixes", async () => {
			setupFolder(baseDir, { files: { "README.md": "readme", "example.com": "text" } });
			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			for (const before of ["user", "\u67e5\u770b", "あ", "カ", "한", "ㄅ", "\u{20bb7}", "か\u3099", "\u79b0\u{e0100}", "\\u3005", "Ａ"]) {
				for (const name of ["REA", "example.com"]) {
					const line = `${before}@${name}`;
					assert.strictEqual(await getSuggestions(provider, [line], 0, line.length), null, line);
				}
			}
		});

		test("matches file with extension in query", async () => {
			setupFolder(baseDir, {
				files: {
					"file.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@file.txt";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@file.txt"));
		});

		test("filters are case insensitive", async () => {
			setupFolder(baseDir, {
				dirs: ["src"],
				files: {
					"README.md": "readme",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@re";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value).sort();
			assert.deepStrictEqual(values, ["@README.md"]);
		});

		test("ranks directories before files", async () => {
			setupFolder(baseDir, {
				dirs: ["src"],
				files: {
					"src.txt": "text",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@src";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const firstValue = result?.items[0]?.value;
			const hasSrcFile = result?.items?.some((item) => item.value === "@src.txt");
			assert.strictEqual(firstValue, "@src/");
			assert.ok(hasSrcFile);
		});

		test("returns nested file paths", async () => {
			setupFolder(baseDir, {
				files: {
					"src/index.ts": "export {};\n",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@index";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@src/index.ts"));
		});

		test("matches deeply nested paths", async () => {
			setupFolder(baseDir, {
				files: {
					"packages/tui/src/autocomplete.ts": "export {};",
					"packages/ai/src/autocomplete.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@tui/src/auto";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@packages/tui/src/autocomplete.ts"));
			assert.ok(!values?.includes("@packages/ai/src/autocomplete.ts"));
		});

		test("searches additional base paths with fd for @ mentions", async () => {
			setupFolder(baseDir, {
				files: { "shared-cwd.ts": "export {};" },
			});
			setupFolder(outsideDir, {
				files: { "shared-extra.ts": "export {};" },
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath(), [outsideDir]);
			const result = await getSuggestions(provider, ["@shared"], 0, 7);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@shared-cwd.ts"));
			assert.ok(values.includes(`@${join(outsideDir, "shared-extra.ts").replace(/\\/g, "/")}`));
		});

		test("scopes @dir/ queries across every root", async () => {
			setupFolder(baseDir, {
				files: { "sub/cwd-file.ts": "export {};" },
			});
			setupFolder(outsideDir, {
				files: { "sub/extra-file.ts": "export {};" },
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath(), [outsideDir]);
			const result = await getSuggestions(provider, ["@sub/file"], 0, 9);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@sub/cwd-file.ts"));
			assert.ok(values.includes(`@${join(outsideDir, "sub", "extra-file.ts").replace(/\\/g, "/")}`));
		});

		test("deduplicates entries when an additional root is inside cwd", async () => {
			const nestedDir = join(baseDir, "extra");
			setupFolder(nestedDir, {
				files: { "Overlap.ts": "export {};" },
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath(), [nestedDir]);
			const result = await getSuggestions(provider, ["@overlap"], 0, 8);

			const values = result?.items.map((item) => item.value) ?? [];
			const absValue = `@${join(nestedDir, "Overlap.ts").replace(/\\/g, "/")}`;
			const relValue = "@extra/Overlap.ts";
			const overlapCount = values.filter((v) => v === absValue || v === relValue).length;
			assert.strictEqual(overlapCount, 1);
		});

		test("merges empty @ query across roots within the result cap", async () => {
			const cwdFiles: Record<string, string> = {};
			for (let i = 0; i < 15; i++) cwdFiles[`f${i}.ts`] = "export {};";
			setupFolder(baseDir, { files: cwdFiles });
			const extraFiles: Record<string, string> = {};
			for (let i = 0; i < 15; i++) extraFiles[`g${i}.ts`] = "export {};";
			setupFolder(outsideDir, { files: extraFiles });

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath(), [outsideDir]);
			const result = await getSuggestions(provider, ["@"], 0, 1);

			const count = result?.items.length ?? 0;
			assert.ok(count <= 20, `expected <= 20 items, got ${count}`);
			assert.ok(count > 0);
		});

		test("falls back to full-path per root when another root has the scoped directory", async () => {
			setupFolder(baseDir, {
				files: { "packages/tui/src/autocomplete.ts": "export {};" },
			});
			// outsideDir has a top-level src/ but no matching file; a global fallback
			// would skip cwd's full-path search entirely and hide the cwd match.
			setupFolder(outsideDir, {
				files: { "src/other.ts": "export {};" },
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath(), [outsideDir]);
			const result = await getSuggestions(provider, ["@src/auto"], 0, 9);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@packages/tui/src/autocomplete.ts"));
		});

		test("matches directory in middle of path with --full-path", async () => {
			setupFolder(baseDir, {
				files: {
					"src/components/Button.tsx": "export {};",
					"src/utils/helpers.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@components/";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@src/components/Button.tsx"));
			assert.ok(!values?.includes("@src/utils/helpers.ts"));
		});

		test("scopes fuzzy search to relative directories and searches recursively", async () => {
			setupFolder(outsideDir, {
				files: {
					"nested/alpha.ts": "export {};",
					"nested/deeper/also-alpha.ts": "export {};",
					"nested/deeper/zzz.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@../outside/a";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("@../outside/nested/alpha.ts"));
			assert.ok(values?.includes("@../outside/nested/deeper/also-alpha.ts"));
			assert.ok(!values?.includes("@../outside/nested/deeper/zzz.ts"));
		});

		test("ranks shallower same-score @ matches before deeper matches", async () => {
			setupFolder(baseDir, {
				dirs: ["scope/aaa/venv/lib/python3.12/site-packages/pkg/core/profile", "scope/projects"],
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@scope/pro";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.strictEqual(values[0], "@scope/projects/");
			assert.ok(values.includes("@scope/aaa/venv/lib/python3.12/site-packages/pkg/core/profile/"));
		});

		test("includes scoped direct children when recursive @ matches are flooded", async () => {
			const floodedDirs = Array.from(
				{ length: 250 },
				(_, index) =>
					`scope/a${String(index + 1).padStart(3, "0")}/venv/lib/python3.12/site-packages/pkg/core/profile`,
			);
			setupFolder(baseDir, {
				dirs: ["scope/projects", ...floodedDirs],
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@scope/pro";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.strictEqual(values[0], "@scope/projects/");
			assert.ok(
				values.some((value) => value.includes("/profile/")),
				"Should keep deep fuzzy matches after direct children",
			);
		});

		test("quotes paths containing whitespace or CJK punctuation for @ suggestions", async () => {
			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			for (const separator of [" ", "\u3000", "，", "。"]) {
				const directory = `my${separator}folder`;
				setupFolder(baseDir, { files: { [`${directory}/test.txt`]: "content" } });
				const line = "@my";
				const result = await getSuggestions(provider, [line], 0, line.length);
				assert.ok(result);
				const item = result.items.find((entry) => entry.value === `@"${directory}/"`);
				assert.ok(item, directory);
				const applied = provider.applyCompletion([line], 0, line.length, item, result.prefix);
				const continued = await getSuggestions(provider, applied.lines, 0, applied.cursorCol);
				assert.strictEqual(continued?.prefix, `@"${directory}/`);
				assert.ok(continued?.items.some((entry) => entry.value === `@"${directory}/test.txt"`));
			}
		});

		test("includes hidden paths but excludes .git", async () => {
			setupFolder(baseDir, {
				dirs: [".pi", ".github", ".git"],
				files: {
					".pi/config.json": "{}",
					".github/workflows/ci.yml": "name: ci",
					".git/config": "[core]",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@.pi/"));
			assert.ok(values.includes("@.github/"));
			assert.ok(!values.some((value) => value === "@.git" || value.startsWith("@.git/")));
		});

		test("follows symlinked directories for fuzzy @ search", async () => {
			setupFolder(baseDir, {
				files: {
					"dir/some_file.txt": "real",
				},
			});
			setupFolder(outsideDir, {
				files: {
					"some_file.txt": "symlinked",
				},
			});
			symlinkSync("../outside", join(baseDir, "symlinked_dir"));

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@some";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@dir/some_file.txt"));
			assert.ok(values.includes("@symlinked_dir/some_file.txt"));
		});

		test("returns symlinked directories when matching their name", async () => {
			setupFolder(outsideDir, {
				files: {
					"nested/file.txt": "symlinked",
				},
			});
			symlinkSync("../outside", join(baseDir, "symlinked_dir"));

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@symlinked";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@symlinked_dir/"));
		});

		test("returns symlinked files without requiring type l", async () => {
			setupFolder(baseDir, {
				files: {
					"original.txt": "content",
				},
			});
			const linkPath = join(baseDir, "link.txt");
			symlinkSync("original.txt", linkPath);

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = "@link";
			const result = await getSuggestions(provider, [line], 0, line.length);

			const values = result?.items.map((item) => item.value) ?? [];
			assert.ok(values.includes("@link.txt"));
		});

		test("returns the same @ suggestions when the cwd path contains the query", async () => {
			const normalBaseDir = join(rootDir, "cwd-normal");
			const queryInPathBaseDir = join(rootDir, "cwd-plan-repro");
			mkdirSync(normalBaseDir, { recursive: true });
			mkdirSync(queryInPathBaseDir, { recursive: true });

			const structure = {
				dirs: ["packages/coding-agent/examples/extensions/plan-mode"],
				files: {
					"packages/coding-agent/examples/extensions/plan-mode/README.md": "readme",
					"packages/tui/docs/plan.md": "plan",
				},
			};
			setupFolder(normalBaseDir, structure);
			setupFolder(queryInPathBaseDir, structure);

			const query = "@plan";
			const normalProvider = new CombinedAutocompleteProvider([], normalBaseDir, requireFdPath());
			const queryInPathProvider = new CombinedAutocompleteProvider([], queryInPathBaseDir, requireFdPath());

			const normalResult = await getSuggestions(normalProvider, [query], 0, query.length);
			const queryInPathResult = await getSuggestions(queryInPathProvider, [query], 0, query.length);

			const normalize = (result: Awaited<ReturnType<typeof getSuggestions>>) =>
				(result?.items ?? []).map((item) => `${item.label} :: ${item.description ?? ""}`).sort();

			assert.deepStrictEqual(normalize(queryInPathResult), normalize(normalResult));
			assert.ok(
				normalize(normalResult).includes("plan-mode/ :: packages/coding-agent/examples/extensions/plan-mode"),
			);
			assert.ok(normalize(normalResult).includes("plan.md :: packages/tui/docs/plan.md"));
		});

		test("continues autocomplete inside quoted @ paths", async () => {
			setupFolder(baseDir, {
				files: {
					"my folder/test.txt": "content",
					"my folder/other.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = '@"my folder/"';
			const result = await getSuggestions(provider, [line], 0, line.length - 1);

			assert.notEqual(result, null, "Should return suggestions for quoted folder path");
			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes('@"my folder/test.txt"'));
			assert.ok(values?.includes('@"my folder/other.txt"'));
		});

		test("applies quoted @ completion without duplicating closing quote", async () => {
			setupFolder(baseDir, {
				files: {
					"my folder/test.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
			const line = '@"my folder/te"';
			const cursorCol = line.length - 1;
			const result = await getSuggestions(provider, [line], 0, cursorCol);

			assert.notEqual(result, null, "Should return suggestions for quoted @ path");
			const item = result?.items.find((entry) => entry.value === '@"my folder/test.txt"');
			assert.ok(item, "Should find test.txt suggestion");

			const applied = provider.applyCompletion([line], 0, cursorCol, item!, result!.prefix);
			assert.strictEqual(applied.lines[0], '@"my folder/test.txt" ');
		});
	});

	describe("dot-slash path completion", () => {
		let baseDir = "";

		beforeEach(() => {
			baseDir = mkdtempSync(join(tmpdir(), "pi-autocomplete-"));
		});

		afterEach(() => {
			rmSync(baseDir, { recursive: true, force: true });
		});

		test("completes Chinese path prefixes after whitespace or CJK punctuation on Tab", async () => {
			setupFolder(baseDir, { files: { "\u8bf4\u660e.md": "file", "\u6587\u6863/\u8bf4\u660e.md": "nested file" } });
			const provider = new CombinedAutocompleteProvider([], baseDir);
			const completions = [
				{ prefix: "\u8bf4", value: "\u8bf4\u660e.md" },
				{ prefix: "\u6587", value: "\u6587\u6863/" },
				{ prefix: "\u6587\u6863/\u8bf4", value: "\u6587\u6863/\u8bf4\u660e.md" },
				{ prefix: "./\u6587\u6863/\u8bf4", value: "./\u6587\u6863/\u8bf4\u660e.md" },
			];
			if (process.platform !== "win32") {
				completions.push({ prefix: `${baseDir}/\u6587\u6863/\u8bf4`, value: `${baseDir}/\u6587\u6863/\u8bf4\u660e.md` });
			}
			for (const separator of " \t\u3000\u00a0，：；。！？（「《") {
				for (const { prefix, value } of completions) {
					const before = `\u67e5\u770b\u{20bb7}${separator}`;
					const line = `${before}${prefix} \u540e\u6587`;
					const cursorCol = before.length + prefix.length;
					const result = await getSuggestions(provider, [line], 0, cursorCol, true);
					assert.ok(result, line);
					assert.strictEqual(result.prefix, prefix);
					assert.deepStrictEqual(
						result.items.map((item) => item.value),
						[value],
					);
					const applied = provider.applyCompletion([line], 0, cursorCol, result.items[0]!, result.prefix);
					assert.strictEqual(applied.lines[0], `${before}${value} \u540e\u6587`);
					assert.strictEqual(applied.cursorCol, before.length + value.length);
				}
			}
		});

		test("treats unquoted separators as boundaries even when a matching literal path exists", async () => {
			setupFolder(baseDir, { files: { "\u5f52\u6863/\u8bf4\u660e.md": "other" } });
			const provider = new CombinedAutocompleteProvider([], baseDir);
			for (const separator of [" ", "\u3000", "，", "。"]) {
				const directory = `\u8d44\u6599${separator}\u5f52\u6863`;
				setupFolder(baseDir, { files: { [`${directory}/\u8bf4\u660e.md`]: "archive" } });
				for (const marker of ["", "@"]) {
					const line = `${marker}${directory}/\u8bf4`;
					const result = await getSuggestions(provider, [line], 0, line.length, true);
					assert.ok(result, line);
					assert.strictEqual(result.prefix, "\u5f52\u6863/\u8bf4");
					assert.deepStrictEqual(
						result.items.map((item) => item.value),
						["\u5f52\u6863/\u8bf4\u660e.md"],
					);
				}
				const quoted = `\u67e5\u770b，"${directory}/\u8bf4"\u540e\u6587`;
				const cursorCol = quoted.indexOf('"\u540e\u6587');
				const result = await getSuggestions(provider, [quoted], 0, cursorCol, true);
				assert.ok(result);
				assert.strictEqual(result.prefix, `"${directory}/\u8bf4`);
				assert.deepStrictEqual(
					result.items.map((item) => item.value),
					[`"${directory}/\u8bf4\u660e.md"`],
				);
				const applied = provider.applyCompletion([quoted], 0, cursorCol, result.items[0]!, result.prefix);
				assert.strictEqual(applied.lines[0], `\u67e5\u770b，"${directory}/\u8bf4\u660e.md"\u540e\u6587`);
				const missing = `\u67e5\u770b，"\u4e0d\u5b58\u5728${separator}\u5f52\u6863/\u8bf4`;
				assert.strictEqual(await getSuggestions(provider, [missing], 0, missing.length, true), null);
			}
		});

		test("handles an empty prefix after whitespace or CJK punctuation consistently", async () => {
			setupFolder(baseDir, { files: { "\u8bf4\u660e.md": "text" } });
			const provider = new CombinedAutocompleteProvider([], baseDir);
			for (const separator of [" ", "\t", "\u3000", "，", "。"]) {
				for (const force of [false, true]) {
					const line = `\u67e5\u770b${separator}`;
					const result = await getSuggestions(provider, [line], 0, line.length, force);
					assert.ok(result, line);
					assert.strictEqual(result.prefix, "");
					assert.deepStrictEqual(
						result.items.map((item) => item.value),
						["\u8bf4\u660e.md"],
					);
				}
			}
			assert.strictEqual(await getSuggestions(provider, [""], 0, 0), null);
		});

		test("completes paths after opening wrappers like ( [ { < and backticks", async () => {
			setupFolder(baseDir, { files: { "src/main.ts": "x" } });
			const provider = new CombinedAutocompleteProvider([], baseDir);
			for (const wrapper of ["(", "[", "{", "<", "`", "((", "(`"]) {
				for (const prefix of ["src/ma", "./src/ma"]) {
					const before = `see ${wrapper}`;
					const line = `${before}${prefix}`;
					const result = await getSuggestions(provider, [line], 0, line.length, true);
					assert.ok(result, line);
					assert.strictEqual(result.prefix, prefix);
					const value = prefix.replace("src/ma", "src/main.ts");
					assert.deepStrictEqual(
						result.items.map((item) => item.value),
						[value],
					);
					const applied = provider.applyCompletion([line], 0, line.length, result.items[0]!, result.prefix);
					assert.strictEqual(applied.lines[0], `${before}${value}`);
				}
			}
		});

		test("completes quoted paths after opening wrappers", async () => {
			setupFolder(baseDir, { files: { "my dir/main.ts": "x" } });
			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = 'see ("my dir/ma';
			const result = await getSuggestions(provider, [line], 0, line.length, true);
			assert.ok(result);
			assert.strictEqual(result.prefix, '"my dir/ma');
			assert.deepStrictEqual(
				result.items.map((item) => item.value),
				['"my dir/main.ts"'],
			);
		});

		test("keeps wrappers that are closed inside the path", async () => {
			setupFolder(baseDir, { files: { "[slug]/page.tsx": "x", "(group)/layout.tsx": "x" } });
			const provider = new CombinedAutocompleteProvider([], baseDir);
			for (const [prefix, value] of [
				["[slug]/pa", "[slug]/page.tsx"],
				["(group)/la", "(group)/layout.tsx"],
				["./[slug]/pa", "./[slug]/page.tsx"],
			]) {
				const line = `see ${prefix}`;
				const result = await getSuggestions(provider, [line], 0, line.length, true);
				assert.ok(result, line);
				assert.strictEqual(result.prefix, prefix);
				assert.deepStrictEqual(
					result.items.map((item) => item.value),
					[value],
				);
			}
		});

		test("preserves CJK characters in unprefixed Tab completions", async () => {
			setupFolder(baseDir, { files: { "\u6587\u6863/\u8bf4\u660e.md": "text" } });
			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = "\u6587\u6863/\u8bf4";
			const result = await getSuggestions(provider, [line], 0, line.length, true);
			assert.ok(result);
			assert.strictEqual(result.prefix, line);
			assert.deepStrictEqual(
				result.items.map((item) => item.value),
				["\u6587\u6863/\u8bf4\u660e.md"],
			);
		});

		test("preserves ./ prefix when completing paths", async () => {
			setupFolder(baseDir, {
				files: {
					"update.sh": "#!/bin/bash",
					"utils.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = "./up";
			const result = await getSuggestions(provider, [line], 0, line.length, true);

			assert.notEqual(result, null, "Should return suggestions for ./ path");
			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("./update.sh"), `Expected ./update.sh in ${JSON.stringify(values)}`);
		});

		test("preserves ./ prefix for directory completions", async () => {
			setupFolder(baseDir, {
				dirs: ["src"],
				files: {
					"src/index.ts": "export {};",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = "./sr";
			const result = await getSuggestions(provider, [line], 0, line.length, true);

			assert.notEqual(result, null, "Should return suggestions for ./ directory path");
			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes("./src/"), `Expected ./src/ in ${JSON.stringify(values)}`);
		});
	});

	describe("quoted path completion", () => {
		let baseDir = "";

		beforeEach(() => {
			baseDir = mkdtempSync(join(tmpdir(), "pi-autocomplete-"));
		});

		afterEach(() => {
			rmSync(baseDir, { recursive: true, force: true });
		});

		test("quotes paths containing whitespace or CJK punctuation for direct completion", async () => {
			const provider = new CombinedAutocompleteProvider([], baseDir);
			for (const separator of [" ", "\u3000", "，", "。"]) {
				const directory = `my${separator}folder`;
				setupFolder(baseDir, { files: { [`${directory}/test.txt`]: "content" } });
				const line = "my";
				const result = await getSuggestions(provider, [line], 0, line.length, true);
				assert.ok(result);
				const item = result.items.find((entry) => entry.value === `"${directory}/"`);
				assert.ok(item, directory);
				const applied = provider.applyCompletion([line], 0, line.length, item, result.prefix);
				const continued = await getSuggestions(provider, applied.lines, 0, applied.cursorCol, true);
				assert.strictEqual(continued?.prefix, `"${directory}/`);
				assert.deepStrictEqual(
					continued?.items.map((entry) => entry.value),
					[`"${directory}/test.txt"`],
				);
			}
		});

		test("keeps quoted directories before files", async () => {
			setupFolder(baseDir, { dirs: ["z folder", "z，folder"], files: { "a.txt": "text" } });
			const provider = new CombinedAutocompleteProvider([], baseDir);
			const result = await getSuggestions(provider, [""], 0, 0, true);
			assert.ok(result);
			assert.deepStrictEqual(
				result.items.map((item) => item.label.endsWith("/")),
				[true, true, false],
			);
		});

		test("continues completion inside quoted paths", async () => {
			setupFolder(baseDir, {
				files: {
					"my folder/test.txt": "content",
					"my folder/other.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = '"my folder/"';
			const result = await getSuggestions(provider, [line], 0, line.length - 1, true);

			assert.notEqual(result, null, "Should return suggestions for quoted folder path");
			const values = result?.items.map((item) => item.value);
			assert.ok(values?.includes('"my folder/test.txt"'));
			assert.ok(values?.includes('"my folder/other.txt"'));
		});

		test("applies quoted completion without duplicating closing quote", async () => {
			setupFolder(baseDir, {
				files: {
					"my folder/test.txt": "content",
				},
			});

			const provider = new CombinedAutocompleteProvider([], baseDir);
			const line = '"my folder/te"';
			const cursorCol = line.length - 1;
			const result = await getSuggestions(provider, [line], 0, cursorCol, true);

			assert.notEqual(result, null, "Should return suggestions for quoted path");
			const item = result?.items.find((entry) => entry.value === '"my folder/test.txt"');
			assert.ok(item, "Should find test.txt suggestion");

			const applied = provider.applyCompletion([line], 0, cursorCol, item!, result!.prefix);
			assert.strictEqual(applied.lines[0], '"my folder/test.txt"');
		});
	});
});
